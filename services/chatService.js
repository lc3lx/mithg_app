const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const {
  getAllPopulated,
  createOnePopulated,
  updateOnePopulated,
  getOneMultiplePop,
  deleteOne,
  addToArray,
  removeFromArray,
  incrementField,
} = require("./handlersFactory");

const Chat = require("../models/chatModel");
const User = require("../models/userModel");
const Message = require("../models/messageModel");

// @desc    Get all chats for logged user
// @route   GET /api/v1/chats
// @access  Private
exports.getChats = asyncHandler(async (req, res) => {
  const documentsCounts = await Chat.countDocuments({
    participants: req.user._id,
    isActive: true,
  });

  const apiFeatures = new ApiFeatures(
    Chat.find({
      participants: req.user._id,
      isActive: true,
    })
      .populate({
        path: "participants",
        select: "name profileImg isOnline lastSeen",
      })
      .populate({
        path: "lastMessage",
        select: "content sender messageType createdAt isRead",
        populate: {
          path: "sender",
          select: "name",
        },
      })
      .sort({ lastMessageTime: -1 }),
    req.query
  );

  const { mongooseQuery, paginationResult } = apiFeatures;
  const chats = await mongooseQuery;

  // Add unread count for each chat
  const chatsWithUnread = await Promise.all(
    chats.map(async (chat) => {
      const unreadCount = chat.unreadCount.find(
        (count) => count.user.toString() === req.user._id.toString()
      );

      return {
        ...chat.toObject(),
        unreadCount: unreadCount ? unreadCount.count : 0,
      };
    })
  );

  res.status(200).json({
    results: chatsWithUnread.length,
    paginationResult,
    data: chatsWithUnread,
  });
});

// @desc    Get single chat with messages
// @route   GET /api/v1/chats/:id
// @access  Private
exports.getChat = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Check if user is participant in chat
  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  })
    .populate({
      path: "participants",
      select: "name profileImg isOnline lastSeen",
    })
    .populate({
      path: "lastMessage",
      select: "content sender messageType createdAt",
    });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  // Get messages with pagination
  const messagesQuery = Message.find({ chat: id })
    .populate({
      path: "sender",
      select: "name profileImg isOnline",
    })
    .populate({
      path: "replyTo",
      select: "content sender messageType",
    })
    .sort({ createdAt: -1 });

  const apiFeatures = new ApiFeatures(messagesQuery, req.query).paginate();
  const { mongooseQuery, paginationResult } = apiFeatures;
  const messages = await mongooseQuery;

  // Mark messages as read
  await Message.updateMany(
    {
      chat: id,
      sender: { $ne: req.user._id },
      isRead: false,
    },
    { isRead: true, readAt: new Date() }
  );

  // Reset unread count for user
  await Chat.findByIdAndUpdate(id, {
    $pull: { unreadCount: { user: req.user._id } },
  });

  res.status(200).json({
    data: {
      chat,
      messages: messages.reverse(), // Return in chronological order
      paginationResult,
    },
  });
});

// @desc    Create new chat
// @route   POST /api/v1/chats
// @access  Private
exports.createChat = asyncHandler(async (req, res, next) => {
  const { participantId, chatType = "direct" } = req.body;

  // Check if participant exists
  const participant = await User.findById(participantId);
  if (!participant) {
    return next(new ApiError("Participant not found", 404));
  }

  // Check if chat already exists for direct chats
  if (chatType === "direct") {
    const existingChat = await Chat.findOne({
      chatType: "direct",
      participants: { $all: [req.user._id, participantId] },
      isActive: true,
    });

    if (existingChat) {
      return res.status(200).json({
        message: "Chat already exists",
        data: existingChat,
      });
    }
  }

  // Create new chat
  const chat = await Chat.create({
    participants: [req.user._id, participantId],
    chatType,
  });

  await chat.populate({
    path: "participants",
    select: "name profileImg isOnline lastSeen",
  });

  res.status(201).json({
    message: "Chat created successfully",
    data: chat,
  });
});

// @desc    Send message to chat
// @route   POST /api/v1/chats/:id/messages
// @access  Private
exports.sendMessage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { content, messageType = "text", mediaUrl, mediaName, mediaSize } = req.body;

  // Check if user is participant in chat
  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  // Check user subscription and block status
  if (!req.user.isSubscribed) {
    return next(new ApiError("You must be subscribed to send messages", 403));
  }

  if (req.user.isBlocked && req.user.blockedUntil > new Date()) {
    return next(
      new ApiError(
        `You are blocked until ${req.user.blockedUntil.toLocaleString()}`,
        403
      )
    );
  }

  // Create message
  const messageData = {
    chat: id,
    sender: req.user._id,
    messageType,
  };

  if (content) messageData.content = content;
  if (mediaUrl) messageData.mediaUrl = mediaUrl;
  if (mediaName) messageData.mediaName = mediaName;
  if (mediaSize) messageData.mediaSize = mediaSize;

  const message = await Message.create(messageData);

  await message.populate({
    path: "sender",
    select: "name profileImg isOnline",
  });

  res.status(201).json({
    message: "Message sent successfully",
    data: message,
  });
});

// @desc    Get chat messages
// @route   GET /api/v1/chats/:id/messages
// @access  Private
exports.getChatMessages = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Check if user is participant in chat
  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  const apiFeatures = new ApiFeatures(
    Message.find({ chat: id })
      .populate({
        path: "sender",
        select: "name profileImg isOnline",
      })
      .populate({
        path: "replyTo",
        select: "content sender messageType",
      })
      .sort({ createdAt: -1 }),
    req.query
  ).paginate();

  const { mongooseQuery, paginationResult } = apiFeatures;
  const messages = await mongooseQuery;

  res.status(200).json({
    results: messages.length,
    paginationResult,
    data: messages.reverse(), // Return in chronological order
  });
});

// @desc    Mark messages as read
// @route   PUT /api/v1/chats/:id/read
// @access  Private
exports.markAsRead = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Check if user is participant in chat
  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  // Mark messages as read
  await Message.updateMany(
    {
      chat: id,
      sender: { $ne: req.user._id },
      isRead: false,
    },
    { isRead: true, readAt: new Date() }
  );

  // Reset unread count for user
  await Chat.findByIdAndUpdate(id, {
    $pull: { unreadCount: { user: req.user._id } },
  });

  res.status(200).json({
    message: "Messages marked as read",
  });
});

// @desc    Check for new messages (polling)
// @route   GET /api/v1/chats/poll
// @access  Private
exports.pollMessages = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { since } = req.query; // timestamp in milliseconds

  const sinceDate = since ? new Date(parseInt(since)) : new Date(Date.now() - 30000); // Default to last 30 seconds

  // Get new messages for user's chats
  const userChats = await Chat.find({
    participants: userId,
    isActive: true,
  }).select('_id');

  const chatIds = userChats.map(chat => chat._id);

  const newMessages = await Message.find({
    chat: { $in: chatIds },
    sender: { $ne: userId }, // Messages from other users
    createdAt: { $gt: sinceDate },
    isRead: false
  })
  .populate('chat', 'participants')
  .populate('sender', 'name profileImg')
  .sort({ createdAt: 1 });

  // Get unread counts for each chat
  const unreadCounts = {};
  for (const chatId of chatIds) {
    const count = await Message.countDocuments({
      chat: chatId,
      sender: { $ne: userId },
      isRead: false
    });
    unreadCounts[chatId] = count;
  }

  res.status(200).json({
    success: true,
    data: {
      newMessages,
      unreadCounts,
      timestamp: Date.now()
    }
  });
});

// @desc    Get user friends with online status
// @route   GET /api/v1/chats/friends/list
// @access  Private
exports.getFriends = asyncHandler(async (req, res) => {
  // Get current user with friends populated
  const currentUser = await User.findById(req.user._id).select("friends").lean();

  if (!currentUser.friends || currentUser.friends.length === 0) {
    return res.status(200).json({
      results: 0,
      data: [],
    });
  }

  // Get friends with online status
  const friends = await User.find({
    _id: { $in: currentUser.friends },
    isActive: true,
  })
    .select("name profileImg isOnline lastSeen")
    .sort({ isOnline: -1, name: 1 });

  res.status(200).json({
    results: friends.length,
    data: friends,
  });
});

// @desc    Delete chat
// @route   DELETE /api/v1/chats/:id
// @access  Private
exports.deleteChat = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Check if user is participant in chat
  const chat = await Chat.findOne({
    _id: id,
    participants: req.user._id,
    isActive: true,
  });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  // Soft delete chat
  await Chat.findByIdAndUpdate(id, { isActive: false });

  // Soft delete messages
  await Message.updateMany({ chat: id }, { isArchived: true });

  res.status(200).json({
    message: "Chat deleted successfully",
  });
});

// @desc    Get all chats for admin monitoring
// @route   GET /api/v1/admins/chats
// @access  Private/Admin
exports.getAllChats = asyncHandler(async (req, res) => {
  const documentsCounts = await Chat.countDocuments();

  const apiFeatures = new ApiFeatures(
    Chat.find({ isActive: true })
      .populate({
        path: "participants",
        select: "name profileImg isOnline lastSeen email",
      })
      .populate({
        path: "lastMessage",
        select: "content sender messageType createdAt isRead",
        populate: {
          path: "sender",
          select: "name",
        },
      })
      .sort({ lastMessageTime: -1 }),
    req.query
  ).paginate();

  const { mongooseQuery, paginationResult } = apiFeatures;
  const chats = await mongooseQuery;

  // Add message counts for each chat
  const chatsWithStats = await Promise.all(
    chats.map(async (chat) => {
      const totalMessages = await Message.countDocuments({ chat: chat._id });
      const unreadMessages = await Message.countDocuments({
        chat: chat._id,
        isRead: false,
      });

      return {
        ...chat.toObject(),
        totalMessages,
        unreadMessages,
      };
    })
  );

  res.status(200).json({
    results: chatsWithStats.length,
    paginationResult,
    data: chatsWithStats,
  });
});

// @desc    Archive old messages (admin function)
// @route   POST /api/v1/admins/chats/archive-old
// @access  Private/Admin
exports.archiveOldMessages = asyncHandler(async (req, res) => {
  const { daysOld = 30 } = req.body;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await Message.updateMany(
    {
      createdAt: { $lt: cutoffDate },
      isArchived: false,
    },
    { isArchived: true, archivedAt: new Date() }
  );

  res.status(200).json({
    message: `Archived ${result.modifiedCount} old messages`,
  });
});

// @desc    Get message statistics
// @route   GET /api/v1/admins/chats/stats
// @access  Private/Admin
exports.getMessageStats = asyncHandler(async (req, res) => {
  const totalChats = await Chat.countDocuments({ isActive: true });
  const totalMessages = await Message.countDocuments();
  const totalUnreadMessages = await Message.countDocuments({ isRead: false });
  const totalArchivedMessages = await Message.countDocuments({ isArchived: true });

  // Get messages by type
  const messagesByType = await Message.aggregate([
    {
      $group: {
        _id: "$messageType",
        count: { $sum: 1 },
      },
    },
  ]);

  // Get messages by date (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const messagesByDate = await Message.aggregate([
    {
      $match: {
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
          },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id": 1 },
    },
  ]);

  res.status(200).json({
    data: {
      totalChats,
      totalMessages,
      totalUnreadMessages,
      totalArchivedMessages,
      messagesByType,
      messagesByDate,
    },
  });
});

// @desc    Cleanup chat messages (admin function)
// @route   DELETE /api/v1/admins/chats/cleanup
// @access  Private/Admin
exports.cleanupChatMessages = asyncHandler(async (req, res) => {
  const { daysOld = 90 } = req.body;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await Message.deleteMany({
    createdAt: { $lt: cutoffDate },
    isArchived: true,
  });

  res.status(200).json({
    message: `Deleted ${result.deletedCount} archived messages older than ${daysOld} days`,
  });
});