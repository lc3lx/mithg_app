const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const MessagingRequest = require("../models/messagingRequestModel");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const Notification = require("../models/notificationModel");

// @desc    Get messaging requests (sent and received)
// @route   GET /api/v1/messaging-requests
// @access  Private/Protect
exports.getMessagingRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Get sent requests
  const sentRequests = await MessagingRequest.find({ sender: userId })
    .populate({
      path: "receiver",
      select:
        "name profileImg isOnline lastSeen age location gender bio about gallery",
    })
    .sort({ createdAt: -1 });

  // Get received requests
  const receivedRequests = await MessagingRequest.find({
    receiver: userId,
    status: "pending",
  })
    .populate({
      path: "sender",
      select:
        "name profileImg isOnline lastSeen age location gender bio about gallery",
    })
    .sort({ createdAt: -1 });

  res.status(200).json({
    data: {
      sent: sentRequests,
      received: receivedRequests,
    },
  });
});

// @desc    Send messaging request
// @route   POST /api/v1/messaging-requests
// @access  Private/Protect
exports.sendMessagingRequest = asyncHandler(async (req, res, next) => {
  const { receiverId, message } = req.body;
  const senderId = req.user._id;

  if (!receiverId) {
    return next(new ApiError("رقم المستقبل مطلوب", 400));
  }

  if (receiverId === senderId.toString()) {
    return next(new ApiError("لا يمكنك إرسال طلب المراسلة لنفسك", 400));
  }

  // Check if receiver exists and is subscribed
  const receiver = await User.findById(receiverId);
  if (!receiver) {
    return next(new ApiError("المستخدم غير موجود", 404));
  }

  // Check if user is subscribed (required to send messaging requests)
  const sender = await User.findById(senderId);
  if (!sender.isSubscribed) {
    return next(new ApiError("يجب أن تكون مشتركاً لإرسال طلبات المراسلة", 403));
  }

  // Check if receiver is subscribed (required to receive messaging requests)
  if (!receiver.isSubscribed) {
    return next(new ApiError("المستخدم غير مشترك", 403));
  }

  const isFriend = sender.friends
    .map((friend) => friend.toString())
    .includes(receiverId.toString());

  if (!isFriend) {
    return next(new ApiError("يمكنك فقط المراسلة بين صديقين", 403));
  }

  // Check if request already exists
  const existingRequest = await MessagingRequest.findOne({
    $or: [
      { sender: senderId, receiver: receiverId },
      { sender: receiverId, receiver: senderId },
    ],
  });

  if (existingRequest) {
    if (existingRequest.status === "pending") {
      return next(new ApiError("طلب المراسلة موجود بالفعل", 400));
    }
    if (existingRequest.status === "accepted") {
      return next(new ApiError("لديك محادثة نشطة مع هذا المستخدم", 400));
    }
    // If rejected, allow sending new request
  }

  // Create messaging request
  const messagingRequest = await MessagingRequest.create({
    sender: senderId,
    receiver: receiverId,
    message: message || "",
  });

  await messagingRequest.populate([
    {
      path: "sender",
      select: "name profileImg",
    },
    {
      path: "receiver",
      select: "name profileImg",
    },
  ]);

  // إشعار طلب التواصل أو عرض الصورة للمستقبل
  const senderName = req.user.name || "شخص";
  await Notification.createNotification({
    user: receiverId,
    type: "messaging_request",
    title: "طلب تواصل جديد",
    message: `${senderName} يريد بدء محادثة معك`,
    relatedUser: senderId,
    data: { requestId: messagingRequest._id },
  });

  // إرسال إشعار فوري عبر Socket.io إذا كان متاح
  if (req.app && req.app.get("io")) {
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers") || new Map();
    const socketId = onlineUsers.get(receiverId.toString());

    if (socketId) {
      io.to(socketId).emit("notification", {
        type: "messaging_request",
        title: "طلب تواصل جديد",
        message: `${req.user.name} يريد بدء محادثة معك`,
        relatedUser: senderId,
        requestId: messagingRequest._id,
      });
    }
  }

  res.status(201).json({
    message: "تم إرسال طلب المراسلة بنجاح",
    data: messagingRequest,
  });
});

// @desc    Respond to messaging request (accept/reject)
// @route   PUT /api/v1/messaging-requests/:id/respond
// @access  Private/Protect
exports.respondToMessagingRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, includeGuardians = false } = req.body; // 'accept' or 'reject'
  const userId = req.user._id;

  if (!["accept", "reject"].includes(action)) {
    return next(new ApiError("يجب أن يكون الإجراء إما موافقة أو رفض", 400));
  }

  const messagingRequest = await MessagingRequest.findById(id);

  if (!messagingRequest) {
    return next(new ApiError("طلب المراسلة غير موجود", 404));
  }

  if (messagingRequest.receiver.toString() !== userId.toString()) {
    return next(new ApiError("يمكنك فقط الرد على طلبات تم إرسالها إليك", 403));
  }

  if (messagingRequest.status !== "pending") {
    return next(new ApiError("طلب المراسلة تم مراجعته بالفعل", 400));
  }

  const senderId = messagingRequest.sender;

  if (action === "accept") {
    // Update request status
    messagingRequest.status = "accepted";

    // Get guardians for both users if requested
    let participants = [senderId, userId];
    let guardians = [];

    if (includeGuardians) {
      // Get verified guardians for both users
      const [senderGuardians, receiverGuardians] = await Promise.all([
        User.findById(senderId)
          .select("guardians")
          .populate({
            path: "guardians",
            match: {
              isActive: true,
              identityVerified: true,
              canAccessChats: true,
            },
            select: "_id",
          }),
        User.findById(userId)
          .select("guardians")
          .populate({
            path: "guardians",
            match: {
              isActive: true,
              identityVerified: true,
              canAccessChats: true,
            },
            select: "_id",
          }),
      ]);

      const senderGuardianIds = senderGuardians.guardians.map((g) => g._id);
      const receiverGuardianIds = receiverGuardians.guardians.map((g) => g._id);

      guardians = [...senderGuardianIds, ...receiverGuardianIds];
      participants = [...participants, ...guardians];
    }

    // Create chat (dating chat if guardians are included)
    const chat = await Chat.create({
      participants,
      chatType: includeGuardians ? "dating" : "direct",
      primaryUsers: [senderId, userId],
      guardians: includeGuardians ? guardians : [],
      isActive: true,
    });

    messagingRequest.chat = chat._id;
    messagingRequest.chatCreated = true;
    await messagingRequest.save();

    // Create notification for sender
    await Notification.createNotification({
      user: senderId,
      type: "messaging_request_accepted",
      title: "تم قبول طلب المراسلة",
      message: includeGuardians
        ? `${req.user.name} قبل طلب المراسلة الخاص بك. تم إنشاء محادثة عائلية!`
        : `${req.user.name} قبل طلب المراسلة الخاص بك. يمكنك الآن المراسلة!`,
      relatedUser: userId,
      data: { requestId: id, chatId: chat._id, includeGuardians },
    });

    // إرسال إشعار فوري عبر Socket.io إذا كان متاح
    if (req.app && req.app.get("io")) {
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers") || new Map();
      const socketId = onlineUsers.get(senderId.toString());

      if (socketId) {
        io.to(socketId).emit("notification", {
          type: "messaging_request_accepted",
          title: "تم قبول طلب المراسلة",
          message: includeGuardians
            ? `${req.user.name} قبل طلب المراسلة الخاص بك. تم إنشاء محادثة عائلية!`
            : `${req.user.name} قبل طلب المراسلة الخاص بك. يمكنك الآن المراسلة!`,
          relatedUser: userId,
          requestId: id,
          chatId: chat._id,
          includeGuardians,
        });
      }
    }

    res.status(200).json({
      message: includeGuardians
        ? "تم قبول طلب المراسلة بنجاح. تم إنشاء محادثة عائلية!"
        : "تم قبول طلب المراسلة بنجاح. تم إنشاء محادثة!",
      status: "accepted",
      chatId: chat._id,
      includeGuardians,
      participantCount: participants.length,
    });
  } else {
    // Reject request
    messagingRequest.status = "rejected";
    await messagingRequest.save();

    // Create notification for sender
    await Notification.createNotification({
      user: senderId,
      type: "messaging_request_rejected",
      title: "تم رفض طلب المراسلة",
      message: `${req.user.name} رفض طلب المراسلة الخاص بك`,
      relatedUser: userId,
      data: { requestId: id },
    });

    // إرسال إشعار فوري عبر Socket.io إذا كان متاح
    if (req.app && req.app.get("io")) {
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers") || new Map();
      const socketId = onlineUsers.get(senderId.toString());

      if (socketId) {
        io.to(socketId).emit("notification", {
          type: "messaging_request_rejected",
          title: "تم رفض طلب المراسلة",
          message: `${req.user.name} رفض طلب المراسلة الخاص بك`,
          relatedUser: userId,
          requestId: id,
        });
      }
    }

    res.status(200).json({
      message: "Messaging request rejected",
      status: "rejected",
    });
  }
});

// @desc    Cancel sent messaging request
// @route   DELETE /api/v1/messaging-requests/:id/cancel
// @access  Private/Protect
exports.cancelMessagingRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const messagingRequest = await MessagingRequest.findById(id);

  if (!messagingRequest) {
    return next(new ApiError("طلب المراسلة غير موجود", 404));
  }

  if (messagingRequest.sender.toString() !== userId.toString()) {
    return next(new ApiError("يمكنك فقط الإلغاء لطلباتك الخاصة", 403));
  }

  if (messagingRequest.status !== "pending") {
    return next(new ApiError("لا يمكنك الإلغاء لطلب تم مراجعته بالفعل", 400));
  }

  await MessagingRequest.findByIdAndDelete(id);

  res.status(200).json({
    message: "تم إلغاء طلب المراسلة بنجاح",
  });
});

// @desc    Get user's active chats (from accepted messaging requests)
// @route   GET /api/v1/messaging-requests/chats
// @access  Private/Protect
exports.getUserChats = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Find all accepted messaging requests where user is sender or receiver
  const acceptedRequests = await MessagingRequest.find({
    $or: [{ sender: userId }, { receiver: userId }],
    status: "accepted",
    chatCreated: true,
  })
    .populate({
      path: "chat",
      populate: {
        path: "participants",
        select: "name profileImg isOnline lastSeen",
        match: { _id: { $ne: userId } }, // Exclude current user
      },
    })
    .populate({
      path: "sender",
      select: "name profileImg",
    })
    .populate({
      path: "receiver",
      select: "name profileImg",
    })
    .sort({ updatedAt: -1 });

  // Extract chats with other participant info
  const chats = acceptedRequests
    .map((request) => {
      if (request.chat) {
        const otherParticipant = request.chat.participants[0]; // Only one participant since we excluded current user
        return {
          chatId: request.chat._id,
          otherUser: otherParticipant,
          lastMessage: request.chat.lastMessage,
          lastMessageTime: request.chat.lastMessageTime,
          unreadCount:
            request.chat.unreadCount?.find(
              (uc) => uc.user.toString() === userId.toString(),
            )?.count || 0,
          isActive: request.chat.isActive,
        };
      }
      return null;
    })
    .filter(Boolean);

  res.status(200).json({
    results: chats.length,
    data: chats,
  });
});
