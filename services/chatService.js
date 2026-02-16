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
const UserWarnings = require("../models/userWarningsModel");
const BannedWords = require("../models/bannedWordsModel");
const Notification = require("../models/notificationModel");

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
  let chatsWithUnread = await Promise.all(
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

  // استبعاد المحادثات التي حظرك فيها الطرف الآخر (لا تظهر في القائمة)
  const otherParticipantIds = chatsWithUnread
    .map((chat) => {
      const other = (chat.participants || []).find(
        (p) => (p._id || p).toString() !== req.user._id.toString()
      );
      return other ? (other._id || other) : null;
    })
    .filter(Boolean);

  if (otherParticipantIds.length > 0) {
    const usersWhoBlockedMe = await User.find(
      { _id: { $in: otherParticipantIds }, blockedUsers: req.user._id },
      { _id: 1 }
    )
      .lean()
      .then((list) => list.map((u) => u._id.toString()));

    chatsWithUnread = chatsWithUnread.filter((chat) => {
      const other = (chat.participants || []).find(
        (p) => (p._id || p).toString() !== req.user._id.toString()
      );
      if (!other) return true;
      const otherId = (other._id || other).toString();
      return !usersWhoBlockedMe.includes(otherId);
    });
  }

  // استبعاد المحادثات المباشرة عندما أُلغيت الصداقة (المحادثة تختفي من عند الاثنين)
  const currentUser = await User.findById(req.user._id).select("friends").lean();
  const friendIds = (currentUser?.friends || []).map((id) => id.toString());

  chatsWithUnread = chatsWithUnread.filter((chat) => {
    const participants = chat.participants || [];
    if (participants.length !== 2) return true; // محادثة جماعية: نبقّيها
    const other = participants.find(
      (p) => (p._id || p).toString() !== req.user._id.toString()
    );
    if (!other) return true;
    const otherId = (other._id || other).toString();
    return friendIds.includes(otherId);
  });

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

  // التحقق: الطرف الآخر لم يحظرك وأنكما لا تزالان صديقين
  const otherParticipantId = chat.participants.find(
    (p) => p._id.toString() !== req.user._id.toString()
  );
  if (otherParticipantId) {
    const otherId = (otherParticipantId._id || otherParticipantId).toString();
    const otherUser = await User.findById(otherId)
      .select("blockedUsers friends")
      .lean();
    if (otherUser) {
      const blockedIds = (otherUser.blockedUsers || []).map((id) => id.toString());
      if (blockedIds.includes(req.user._id.toString())) {
        return next(new ApiError("لا يمكنك فتح هذه المحادثة", 403));
      }
      const myFriends = await User.findById(req.user._id).select("friends").lean();
      const myFriendIds = (myFriends?.friends || []).map((id) => id.toString());
      const otherFriendIds = (otherUser.friends || []).map((id) => id.toString());
      if (
        !myFriendIds.includes(otherId) ||
        !otherFriendIds.includes(req.user._id.toString())
      ) {
        return next(new ApiError("يجب أن تكونا أصدقاء لفتح المحادثة", 403));
      }
    }
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
  const participant = await User.findById(participantId).select(
    "friends blockedUsers"
  );
  if (!participant) {
    return next(new ApiError("Participant not found", 404));
  }

  const currentUser = await User.findById(req.user._id).select(
    "friends blockedUsers"
  );
  if (!currentUser) {
    return next(new ApiError("User not found", 404));
  }

  // يجب أن تكونا أصدقاء لبدء المحادثة
  const currentFriends = (currentUser.friends || []).map((id) => id.toString());
  const participantFriends = (participant.friends || []).map((id) =>
    id.toString()
  );
  if (
    !currentFriends.includes(participantId) ||
    !participantFriends.includes(req.user._id.toString())
  ) {
    return next(
      new ApiError("يجب أن تكونا أصدقاء لبدء المحادثة", 403)
    );
  }

  // لا يمكن المراسلة إذا حظر أحد الطرفين الآخر
  const participantBlocked = (participant.blockedUsers || []).map((id) =>
    id.toString()
  );
  const currentBlocked = (currentUser.blockedUsers || []).map((id) =>
    id.toString()
  );
  if (participantBlocked.includes(req.user._id.toString())) {
    return next(new ApiError("لا يمكنك مراسلة هذا المستخدم", 403));
  }
  if (currentBlocked.includes(participantId)) {
    return next(new ApiError("لا يمكنك مراسلة هذا المستخدم", 403));
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

  // التحقق من أن الطرف الآخر لا يزال صديقاً ولم يحظر المرسل
  const otherId = chat.participants.find(
    (p) => (p._id ? p._id.toString() : p.toString()) !== req.user._id.toString()
  );
  if (otherId) {
    const otherUserId = otherId._id ? otherId._id.toString() : otherId.toString();
    const otherUser = await User.findById(otherUserId)
      .select("friends blockedUsers")
      .lean();
    if (otherUser) {
      const otherBlocked = (otherUser.blockedUsers || []).map((id) => id.toString());
      if (otherBlocked.includes(req.user._id.toString())) {
        return next(new ApiError("تم حظرك من قبل هذا المستخدم", 403));
      }
      const otherFriends = (otherUser.friends || []).map((id) => id.toString());
      if (!otherFriends.includes(req.user._id.toString())) {
        return next(new ApiError("لا يمكنك إرسال رسائل بعد إلغاء الصداقة", 403));
      }
    }
  }

  // استبدال الكلمات المحظورة بـ **** حتى لا تظهر في المحادثة
  let contentToStore = content;
  if (content && typeof content === "string") {
    contentToStore = await BannedWords.maskMessage(content);
  }

  // Create message
  const messageData = {
    chat: id,
    sender: req.user._id,
    messageType,
  };

  if (contentToStore) messageData.content = contentToStore;
  if (mediaUrl) messageData.mediaUrl = mediaUrl;
  if (mediaName) messageData.mediaName = mediaName;
  if (mediaSize) messageData.mediaSize = mediaSize;

  const message = await Message.create(messageData);

  await message.populate({
    path: "sender",
    select: "name profileImg isOnline",
  });

  // فحص الكلمات الممنوعة للتحذير (بعد الرد حتى لا نؤخر الاستجابة)
  if (content && typeof content === "string") {
    setImmediate(() => {
      const { checkMessageAndWarn } = require("./userWarningsService");
      const mockReq = {
        body: {
          message: content,
          userId: req.user._id.toString(),
          chatId: id,
          messageId: message._id.toString(),
        },
      };
      const mockRes = {
        status: () => ({ json: () => ({}) }),
      };
      checkMessageAndWarn(mockReq, mockRes, () => {}).catch(() => {});
    });
  }

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

  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  })
    .populate({ path: "participants", select: "_id" });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  const otherParticipant = (chat.participants || []).find(
    (p) => (p._id || p).toString() !== req.user._id.toString()
  );
  if (otherParticipant) {
    const otherId = (otherParticipant._id || otherParticipant).toString();
    const otherUser = await User.findById(otherId)
      .select("blockedUsers friends")
      .lean();
    if (otherUser) {
      const blockedIds = (otherUser.blockedUsers || []).map((id) => id.toString());
      if (blockedIds.includes(req.user._id.toString())) {
        return next(new ApiError("لا يمكنك فتح هذه المحادثة", 403));
      }
      const myFriends = await User.findById(req.user._id).select("friends").lean();
      const myFriendIds = (myFriends?.friends || []).map((id) => id.toString());
      const otherFriendIds = (otherUser.friends || []).map((id) => id.toString());
      if (
        !myFriendIds.includes(otherId) ||
        !otherFriendIds.includes(req.user._id.toString())
      ) {
        return next(new ApiError("يجب أن تكونا أصدقاء لفتح المحادثة", 403));
      }
    }
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

  const chat = await Chat.findOne({
    _id: id,
    isActive: true,
    $or: [
      { participants: req.user._id },
      { guardians: req.user._id },
    ],
  })
    .populate({ path: "participants", select: "_id" });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  const otherParticipant = (chat.participants || []).find(
    (p) => (p._id || p).toString() !== req.user._id.toString()
  );
  if (otherParticipant) {
    const otherId = (otherParticipant._id || otherParticipant).toString();
    const otherUser = await User.findById(otherId)
      .select("blockedUsers friends")
      .lean();
    if (otherUser) {
      const blockedIds = (otherUser.blockedUsers || []).map((id) => id.toString());
      if (blockedIds.includes(req.user._id.toString())) {
        return next(new ApiError("لا يمكنك فتح هذه المحادثة", 403));
      }
      const myFriends = await User.findById(req.user._id).select("friends").lean();
      const myFriendIds = (myFriends?.friends || []).map((id) => id.toString());
      const otherFriendIds = (otherUser.friends || []).map((id) => id.toString());
      if (
        !myFriendIds.includes(otherId) ||
        !otherFriendIds.includes(req.user._id.toString())
      ) {
        return next(new ApiError("يجب أن تكونا أصدقاء لفتح المحادثة", 403));
      }
    }
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

// @desc    Get all chats for admin monitoring — جميع المحادثات بدون فلتر جنس
// @route   GET /api/v1/admins/chats
// @access  Private/Admin
exports.getAllChats = asyncHandler(async (req, res) => {
  const filter = { isActive: true };

  const documentsCounts = await Chat.countDocuments(filter);

  const apiFeatures = new ApiFeatures(
    Chat.find(filter)
      .populate({
        path: "participants",
        select: "name profileImg isOnline lastSeen email gender",
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
  ).paginate(documentsCounts);

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

// @desc    Get chat messages for admin monitoring
// @route   GET /api/v1/admins/chats/:id/messages
// @access  Private/Admin
exports.getChatMessagesForAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Get chat
  const chat = await Chat.findById(id);
  if (!chat) {
    return next(new ApiError("Chat not found", 404));
  }

  const apiFeatures = new ApiFeatures(
    Message.find({ chat: id })
      .populate({
        path: "sender",
        select: "name profileImg isOnline email gender",
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

// @desc    Get single chat for admin monitoring — يمكن فتح أي محادثة بين أي اثنين
// @route   GET /api/v1/admins/chats/:id
// @access  Private/Admin
exports.getChatForAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const chat = await Chat.findById(id)
    .populate({
      path: "participants",
      select: "name profileImg isOnline lastSeen email gender",
    })
    .populate({
      path: "lastMessage",
      select: "content sender messageType createdAt isRead",
      populate: {
        path: "sender",
        select: "name",
      },
    });

  if (!chat) {
    return next(new ApiError("Chat not found", 404));
  }

  // Get message counts
  const totalMessages = await Message.countDocuments({ chat: id });
  const unreadMessages = await Message.countDocuments({
    chat: id,
    isRead: false,
  });

  res.status(200).json({
    data: {
      ...chat.toObject(),
      totalMessages,
      unreadMessages,
    },
  });
});

// @desc    Get chats with banned words violations — جميع المحادثات المخالفة
// @route   GET /api/v1/admins/chats/violations
// @access  Private/Admin
exports.getChatViolations = asyncHandler(async (req, res) => {
  const filter = { isActive: true };

  // Get all warnings related to chats
  const warnings = await UserWarnings.find({
    chat: { $exists: true },
    warningType: "banned_word",
  })
    .populate({
      path: "user",
      select: "name profileImg email gender",
    })
    .populate({
      path: "chat",
      select: "participants lastMessage lastMessageTime",
      populate: {
        path: "participants",
        select: "name profileImg email gender",
      },
    })
    .populate({
      path: "bannedWord",
      select: "word category severity",
    })
    .sort({ createdAt: -1 });

  // Get unique chat IDs from warnings
  const chatIds = [...new Set(warnings.map(w => w.chat?._id?.toString()).filter(Boolean))];

  // Get chats with violations
  const chatsWithViolations = await Chat.find({
    _id: { $in: chatIds },
    ...filter,
  })
    .populate({
      path: "participants",
      select: "name profileImg isOnline lastSeen email gender",
    })
    .populate({
      path: "lastMessage",
      select: "content sender messageType createdAt isRead",
      populate: {
        path: "sender",
        select: "name",
      },
    })
    .sort({ lastMessageTime: -1 });

  // Add violation details to each chat
  const chatsWithDetails = chatsWithViolations.map(chat => {
    const chatWarnings = warnings.filter(
      w => w.chat?._id?.toString() === chat._id.toString()
    );
    
    const violationMessages = chatWarnings.map(w => ({
      id: w._id,
      userId: w.user?._id,
      userName: w.user?.name,
      bannedWord: w.bannedWord?.word,
      category: w.bannedWord?.category,
      severity: w.bannedWord?.severity,
      createdAt: w.createdAt,
    }));

    return {
      ...chat.toObject(),
      violations: violationMessages,
      violationCount: chatWarnings.length,
    };
  });

  res.status(200).json({
    results: chatsWithDetails.length,
    data: chatsWithDetails,
  });
});

// @desc    Block a participant from a chat permanently
// @route   PUT /api/v1/admins/chats/:id/block-participant/:userId
// @access  Private/Admin
exports.blockChatParticipant = asyncHandler(async (req, res, next) => {
  const { id, userId } = req.params;
  const { blockReason } = req.body;
  const adminId = req.admin._id;
  const { adminType } = req.admin;

  // Get chat
  const chat = await Chat.findById(id);
  if (!chat) {
    return next(new ApiError("Chat not found", 404));
  }

  // Get user
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to block this user", 403)
    );
  }

  // Check if user is participant in chat
  if (!chat.participants.includes(userId)) {
    return next(new ApiError("User is not a participant in this chat", 400));
  }

  // Block user permanently (set blockedUntil to far future)
  const blockedUntil = new Date();
  blockedUntil.setFullYear(blockedUntil.getFullYear() + 100); // 100 years = permanent

  user.isBlocked = true;
  user.blockedUntil = blockedUntil;
  user.blockReason = blockReason || "Permanent block from chat monitoring";
  user.blockedBy = adminId;
  await user.save();

  // Deactivate all chats for this user
  await Chat.updateMany(
    { participants: userId, isActive: true },
    { isActive: false }
  );

  res.status(200).json({
    message: "User blocked permanently and removed from all chats",
    data: {
      userId: user._id,
      userName: user.name,
      chatId: chat._id,
    },
  });
});

// @desc    Block both participants from a chat permanently
// @route   PUT /api/v1/admins/chats/:id/block-both
// @access  Private/Admin
exports.blockBothParticipants = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { blockReason } = req.body;
  const adminId = req.admin._id;
  const { adminType } = req.admin;

  // Get chat
  const chat = await Chat.findById(id);
  if (!chat) {
    return next(new ApiError("Chat not found", 404));
  }

  if (chat.participants.length !== 2) {
    return next(new ApiError("This endpoint is only for direct chats with 2 participants", 400));
  }

  // Get both participants
  const [user1, user2] = await Promise.all([
    User.findById(chat.participants[0]),
    User.findById(chat.participants[1]),
  ]);

  if (!user1 || !user2) {
    return next(new ApiError("One or both participants not found", 404));
  }

  // Check admin permissions
  if (adminType !== "super") {
    // Admin can only block users of their gender type
    const canBlockUser1 = user1.gender === adminType;
    const canBlockUser2 = user2.gender === adminType;
    
    if (!canBlockUser1 && !canBlockUser2) {
      return next(
        new ApiError("You do not have permission to block these users", 403)
      );
    }
  }

  // Block both users permanently
  const blockedUntil = new Date();
  blockedUntil.setFullYear(blockedUntil.getFullYear() + 100); // 100 years = permanent

  const blockReasonFinal = blockReason || "Permanent block from chat monitoring";

  // Block user1 if admin has permission
  if (adminType === "super" || user1.gender === adminType) {
    user1.isBlocked = true;
    user1.blockedUntil = blockedUntil;
    user1.blockReason = blockReasonFinal;
    user1.blockedBy = adminId;
    await user1.save();

    // Deactivate all chats for user1
    await Chat.updateMany(
      { participants: user1._id, isActive: true },
      { isActive: false }
    );
  }

  // Block user2 if admin has permission
  if (adminType === "super" || user2.gender === adminType) {
    user2.isBlocked = true;
    user2.blockedUntil = blockedUntil;
    user2.blockReason = blockReasonFinal;
    user2.blockedBy = adminId;
    await user2.save();

    // Deactivate all chats for user2
    await Chat.updateMany(
      { participants: user2._id, isActive: true },
      { isActive: false }
    );
  }

  // Deactivate this specific chat
  chat.isActive = false;
  await chat.save();

  res.status(200).json({
    message: "Both participants blocked permanently and chat deactivated",
    data: {
      chatId: chat._id,
      blockedUsers: [
        {
          userId: user1._id,
          userName: user1.name,
          blocked: adminType === "super" || user1.gender === adminType,
        },
        {
          userId: user2._id,
          userName: user2.name,
          blocked: adminType === "super" || user2.gender === adminType,
        },
      ],
    },
  });
});

// @desc    Send a warning to all participants in a chat (from chat monitoring)
// @route   POST /api/v1/admins/chats/:id/warn-participants
// @access  Private/Admin
exports.warnChatParticipants = asyncHandler(async (req, res, next) => {
  const { id: chatId } = req.params;
  const warningMessage =
    (req.body.warningMessage && String(req.body.warningMessage).trim()) ||
    "تنبيه: يرجى الالتزام بسياسة التطبيق والحفاظ على المحادثة محترمة واحترام الخصوصية.";

  const chat = await Chat.findById(chatId).populate({
    path: "participants",
    select: "name _id",
  });
  if (!chat) {
    return next(new ApiError("Chat not found", 404));
  }

  const adminId = req.admin._id;
  const participantIds = chat.participants
    .map((p) => (p._id ? p._id.toString() : p.toString()))
    .filter(Boolean);

  if (participantIds.length === 0) {
    return res.status(200).json({
      message: "No participants to warn",
      data: { warnedCount: 0 },
    });
  }

  const results = { warned: [], notificationsSent: 0 };

  for (const userId of participantIds) {
    const currentCount = await UserWarnings.getWarningCount(userId, 30);
    const warning = await UserWarnings.create({
      user: userId,
      warningType: "inappropriate_content",
      severity: "medium",
      chat: chatId,
      warningMessage,
      issuedBy: adminId,
      isAutomatic: false,
      userWarningCount: currentCount + 1,
    });
    results.warned.push({ userId, warningId: warning._id });

    const notif = await Notification.createNotification({
      user: userId,
      type: "security",
      title: "تنبيه بخصوص انتهاك الخصوصية",
      message: warningMessage,
      relatedChat: chatId,
    });
    if (notif) results.notificationsSent += 1;
  }

  res.status(200).json({
    message: "تم إرسال التنبيه لجميع المشاركين في المحادثة",
    data: {
      warnedCount: results.warned.length,
      notificationsSent: results.notificationsSent,
      warned: results.warned,
    },
  });
});