const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const SupportMessage = require("../models/supportMessageModel");
const User = require("../models/userModel");
const GuestSupportConversation = require("../models/guestSupportModel");

const emitSupportMessage = (req, messageDoc) => {
  if (!req.app || !req.app.get("io")) return;
  const io = req.app.get("io");
  const payload = messageDoc.toObject();
  const supportNamespace = io.of("/support");
  supportNamespace.to(`user:${messageDoc.user.toString()}`).emit(
    "support_message",
    payload
  );
  supportNamespace.to("admins").emit("support_message", payload);
};

const emitGuestSupport = (req, event, payload) => {
  if (!req.app || !req.app.get("io")) return;
  const io = req.app.get("io");
  const supportNamespace = io.of("/support");
  supportNamespace.to("admins").emit(event, payload);
  const guestNamespace = io.of("/support-guest");
  if (payload.conversationId) {
    guestNamespace.to(`guest:${payload.conversationId}`).emit(event, payload);
  }
};

// @desc    Get current user's support messages
// @route   GET /api/v1/support/messages
// @access  Private/Protect
exports.getUserMessages = asyncHandler(async (req, res) => {
  const messages = await SupportMessage.find({ user: req.user._id }).sort({
    createdAt: 1,
  });

  res.status(200).json({
    results: messages.length,
    data: messages,
  });
});

// @desc    Send support message from user
// @route   POST /api/v1/support/messages
// @access  Private/Protect
exports.sendUserMessage = asyncHandler(async (req, res, next) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return next(new ApiError("Message is required", 400));
  }

  const supportMessage = await SupportMessage.create({
    user: req.user._id,
    senderType: "user",
    message: message.trim(),
  });

  emitSupportMessage(req, supportMessage);

  res.status(201).json({
    message: "Support message sent",
    data: supportMessage,
  });
});

// @desc    Guest contact support (no auth) - من صفحة اللوق إن
// @route   POST /api/v1/support/guest/contact
// @access  Public
exports.createGuestConversation = asyncHandler(async (req, res, next) => {
  const { name, phone, message } = req.body;
  if (!name || !name.trim()) {
    return next(new ApiError("الاسم مطلوب", 400));
  }
  if (!phone || !phone.trim()) {
    return next(new ApiError("رقم الهاتف مطلوب", 400));
  }

  const firstMessage = {
    senderType: "guest",
    message: (message && message.trim()) || "أريد التواصل مع الدعم",
  };

  const conversation = await GuestSupportConversation.create({
    guestName: name.trim(),
    guestPhone: phone.trim(),
    messages: [firstMessage],
  });

  const payload = {
    conversationId: conversation._id.toString(),
    guestName: conversation.guestName,
    guestPhone: conversation.guestPhone,
    lastMessage: firstMessage.message,
    lastMessageAt: conversation.createdAt,
    messages: conversation.messages,
  };
  emitGuestSupport(req, "guest_new_thread", payload);

  res.status(201).json({
    message: "تم إرسال رسالتك، سنتواصل معك قريباً",
    data: {
      conversationId: conversation._id.toString(),
      guestName: conversation.guestName,
      guestPhone: conversation.guestPhone,
    },
  });
});

// @desc    Get guest conversation messages (لا يحتاج تسجيل دخول)
// @route   GET /api/v1/support/guest/messages/:conversationId
// @access  Public
exports.getGuestMessages = asyncHandler(async (req, res, next) => {
  const { conversationId } = req.params;
  const conversation = await GuestSupportConversation.findById(
    conversationId
  ).lean();
  if (!conversation) {
    return next(new ApiError("المحادثة غير موجودة", 404));
  }
  const messages = (conversation.messages || []).map((m, i) => ({
    _id: `${conversationId}_${i}`,
    senderType: m.senderType,
    message: m.message,
    createdAt: m.createdAt,
  }));

  res.status(200).json({
    results: messages.length,
    data: messages,
    guestName: conversation.guestName,
    guestPhone: conversation.guestPhone,
  });
});

// @desc    Get admin support threads (latest message per user) + guest threads
// @route   GET /api/v1/support/admin/threads
// @access  Private/Admin
exports.getAdminThreads = asyncHandler(async (req, res) => {
  const messages = await SupportMessage.find()
    .sort({ createdAt: -1 })
    .populate({
      path: "user",
      select: "name email profileImg",
    });

  const threadsMap = new Map();
  messages.forEach((msg) => {
    const userId = msg.user?._id?.toString();
    if (!userId || threadsMap.has(userId)) return;
    threadsMap.set(userId, {
      user: msg.user,
      lastMessage: msg.message,
      lastMessageAt: msg.createdAt,
    });
  });

  const guestConvos = await GuestSupportConversation.find()
    .sort({ updatedAt: -1 })
    .lean();
  const guestThreads = guestConvos.map((g) => {
    const lastMsg = g.messages && g.messages.length > 0 ? g.messages[g.messages.length - 1] : null;
    return {
      isGuest: true,
      userId: `guest:${g._id}`,
      user: {
        _id: `guest:${g._id}`,
        name: g.guestName,
        email: g.guestPhone,
        profileImg: null,
      },
      lastMessage: lastMsg ? lastMsg.message : "",
      lastMessageAt: lastMsg ? lastMsg.createdAt : g.createdAt,
    };
  });

  const threads = [
    ...guestThreads,
    ...Array.from(threadsMap.entries()).map(([userId, t]) => ({
      isGuest: false,
      userId,
      user: t.user,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
    })),
  ].sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  res.status(200).json({
    results: threads.length,
    data: threads,
  });
});

// @desc    Get support messages for a user or guest (admin)
// @route   GET /api/v1/support/admin/messages/:userId
// @access  Private/Admin
exports.getAdminMessages = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  if (userId.startsWith("guest:")) {
    const conversationId = userId.replace("guest:", "");
    const conversation = await GuestSupportConversation.findById(
      conversationId
    ).lean();
    if (!conversation) {
      return next(new ApiError("محادثة الضيف غير موجودة", 404));
    }
    const messages = (conversation.messages || []).map((m, i) => ({
      _id: `${conversationId}_${i}`,
      user: null,
      senderType: m.senderType,
      message: m.message,
      admin: m.admin,
      createdAt: m.createdAt,
    }));
    return res.status(200).json({
      results: messages.length,
      data: messages,
      guestName: conversation.guestName,
      guestPhone: conversation.guestPhone,
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const messages = await SupportMessage.find({ user: userId }).sort({
    createdAt: 1,
  });

  res.status(200).json({
    results: messages.length,
    data: messages,
  });
});

// @desc    Send support message from admin to user or guest
// @route   POST /api/v1/support/admin/messages/:userId
// @access  Private/Admin
exports.sendAdminMessage = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return next(new ApiError("Message is required", 400));
  }

  if (userId.startsWith("guest:")) {
    const conversationId = userId.replace("guest:", "");
    const conversation = await GuestSupportConversation.findById(
      conversationId
    );
    if (!conversation) {
      return next(new ApiError("محادثة الضيف غير موجودة", 404));
    }
    conversation.messages.push({
      senderType: "admin",
      message: message.trim(),
      admin: req.admin._id,
    });
    await conversation.save();

    const payload = {
      conversationId,
      senderType: "admin",
      message: message.trim(),
      createdAt: conversation.messages[conversation.messages.length - 1].createdAt,
    };
    emitGuestSupport(req, "support_message", payload);

    return res.status(201).json({
      message: "Support message sent",
      data: {
        _id: conversation.messages[conversation.messages.length - 1]._id,
        senderType: "admin",
        message: message.trim(),
        createdAt: payload.createdAt,
      },
    });
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const supportMessage = await SupportMessage.create({
    user: userId,
    admin: req.admin._id,
    senderType: "admin",
    message: message.trim(),
  });

  emitSupportMessage(req, supportMessage);

  res.status(201).json({
    message: "Support message sent",
    data: supportMessage,
  });
});

