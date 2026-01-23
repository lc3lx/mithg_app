const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");

const SupportMessage = require("../models/supportMessageModel");
const User = require("../models/userModel");

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

// @desc    Get admin support threads (latest message per user)
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

  const threads = Array.from(threadsMap.values());

  res.status(200).json({
    results: threads.length,
    data: threads,
  });
});

// @desc    Get support messages for a user (admin)
// @route   GET /api/v1/support/admin/messages/:userId
// @access  Private/Admin
exports.getAdminMessages = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
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

// @desc    Send support message from admin to user
// @route   POST /api/v1/support/admin/messages/:userId
// @access  Private/Admin
exports.sendAdminMessage = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return next(new ApiError("Message is required", 400));
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

