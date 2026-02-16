const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const {
  getAll,
  getOne,
  deleteOne,
  updateOne,
} = require("./handlersFactory");

const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const { sendPushToUser } = require("../utils/pushNotification");

// إشعارات لوحة التحكم فقط (البث من الأدمن)، وليس كل إشعارات التطبيق
const ADMIN_BROADCAST_TYPES = [
  "update",
  "promotion",
  "security",
  "welcome",
  "maintenance",
  "general",
];

// @desc    Get user notifications
// @route   GET /api/v1/notifications
// @access  Private/Protect
exports.getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  // Set filter for current user
  req.filterObj = { user: userId };

  const documentsCounts = await Notification.countDocuments({ user: userId });
  const apiFeatures = new ApiFeatures(
    Notification.find({ user: userId }),
    req.query
  )
    .paginate(documentsCounts)
    .filter()
    .limitFields()
    .sort("-createdAt");

  // Execute query
  const { mongooseQuery, paginationResult } = apiFeatures;
  const notifications = await mongooseQuery;

  // Count unread notifications
  const unreadCount = await Notification.countDocuments({
    user: userId,
    isRead: false,
  });

  res.status(200).json({
    results: notifications.length,
    unreadCount,
    paginationResult,
    data: notifications,
  });
});

// @desc    Get specific notification
// @route   GET /api/v1/notifications/:id
// @access  Private/Protect
exports.getNotification = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const notification = await Notification.findOne({
    _id: id,
    user: userId,
  });

  if (!notification) {
    return next(new ApiError(`No notification found with this id ${id}`, 404));
  }

  res.status(200).json({ data: notification });
});

// @desc    Mark notification as read
// @route   PUT /api/v1/notifications/:id/read
// @access  Private/Protect
exports.markAsRead = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const notification = await Notification.findOneAndUpdate(
    { _id: id, user: userId },
    {
      isRead: true,
      readAt: new Date(),
    },
    { new: true }
  );

  if (!notification) {
    return next(new ApiError(`No notification found with this id ${id}`, 404));
  }

  res.status(200).json({
    message: "Notification marked as read",
    data: notification,
  });
});

// @desc    Mark all notifications as read
// @route   PUT /api/v1/notifications/mark-all-read
// @access  Private/Protect
exports.markAllAsRead = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  await Notification.updateMany(
    { user: userId, isRead: false },
    {
      isRead: true,
      readAt: new Date(),
    }
  );

  res.status(200).json({
    message: "All notifications marked as read",
  });
});

// @desc    Delete notification
// @route   DELETE /api/v1/notifications/:id
// @access  Private/Protect
exports.deleteNotification = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const notification = await Notification.findOneAndDelete({
    _id: id,
    user: userId,
  });

  if (!notification) {
    return next(new ApiError(`No notification found with this id ${id}`, 404));
  }

  res.status(204).send();
});

// @desc    Delete all read notifications
// @route   DELETE /api/v1/notifications/delete-read
// @access  Private/Protect
exports.deleteReadNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  await Notification.deleteMany({
    user: userId,
    isRead: true,
  });

  res.status(200).json({
    message: "All read notifications deleted",
  });
});

// @desc    Get notification statistics
// @route   GET /api/v1/notifications/stats
// @access  Private/Protect
exports.getNotificationStats = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const stats = await Notification.aggregate([
    { $match: { user: userId } },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        unreadCount: {
          $sum: { $cond: [{ $eq: ["$isRead", false] }, 1, 0] },
        },
      },
    },
  ]);

  const totalNotifications = await Notification.countDocuments({
    user: userId,
  });
  const unreadNotifications = await Notification.countDocuments({
    user: userId,
    isRead: false,
  });

  res.status(200).json({
    data: {
      total: totalNotifications,
      unread: unreadNotifications,
      byType: stats,
    },
  });
});

// @desc    Create notification (for internal use)
// @route   POST /api/v1/notifications
// @access  Private/Admin (or internal use)
exports.createNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.create(req.body);

  res.status(201).json({
    message: "Notification created successfully",
    data: notification,
  });
});

// ===============================
// Admin specific handlers
// ===============================

// @desc    Get all notifications (admin) — فقط إشعارات البث من لوحة التحكم
// @route   GET /api/v1/notifications/admin
// @access  Private/Admin
exports.getAllNotificationsAdmin = asyncHandler(async (req, res) => {
  const filter = { type: { $in: ADMIN_BROADCAST_TYPES } };
  const documentsCounts = await Notification.countDocuments(filter);
  const apiFeatures = new ApiFeatures(
    Notification.find(filter),
    req.query
  )
    .paginate(documentsCounts)
    .filter()
    .search("Notification")
    .limitFields()
    .sort();

  const { mongooseQuery, paginationResult } = apiFeatures;
  const documents = await mongooseQuery;

  res
    .status(200)
    .json({ results: documents.length, paginationResult, data: documents });
});

// @desc    Get single notification (admin)
// @route   GET /api/v1/notifications/admin/:id
// @access  Private/Admin
exports.getNotificationAdmin = getOne(Notification);

// @desc    Update notification (admin)
// @route   PUT /api/v1/notifications/admin/:id
// @access  Private/Admin
exports.updateNotificationAdmin = updateOne(Notification);

// @desc    Delete notification (admin)
// @route   DELETE /api/v1/notifications/admin/:id
// @access  Private/Admin
exports.deleteNotificationAdmin = deleteOne(Notification);

// @desc    Get notification stats (admin)
// @route   GET /api/v1/notifications/admin/stats
// @access  Private/Admin
exports.getNotificationStatsAdmin = asyncHandler(async (req, res) => {
  const filter = { type: { $in: ADMIN_BROADCAST_TYPES } };
  const totalNotifications = await Notification.countDocuments(filter);
  const scheduledNotifications = await Notification.countDocuments({
    ...filter,
    status: "scheduled",
  });
  const draftedNotifications = await Notification.countDocuments({
    ...filter,
    status: "draft",
  });
  const sentNotifications = await Notification.countDocuments({
    ...filter,
    status: "sent",
  });

  const statsByType = await Notification.aggregate([
    { $match: { type: { $in: ADMIN_BROADCAST_TYPES } } },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        opened: { $sum: "$openedCount" },
        recipients: { $sum: "$recipientsCount" },
      },
    },
  ]);

  res.status(200).json({
    data: {
      total: totalNotifications,
      scheduled: scheduledNotifications,
      draft: draftedNotifications,
      sent: sentNotifications,
      byType: statsByType,
    },
  });
});

// @desc    Create admin broadcast notifications
// @route   POST /api/v1/notifications/admin
// @access  Private/Admin
exports.createAdminBroadcastNotification = asyncHandler(async (req, res, next) => {
  const {
    recipientType = "all",
    type,
    title,
    message,
    status,
    scheduledAt,
    userIds,
  } = req.body;

  // Build recipients query
  let recipients = [];
  if (recipientType === "specific") {
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return next(
        new ApiError("userIds must be provided when recipientType is specific", 400)
      );
    }
    // Ensure unique IDs
    const uniqueIds = [...new Set(userIds.map(String))];
    recipients = uniqueIds.map((id) => ({ _id: id }));
  } else {
    const query = {};
    if (recipientType === "premium") {
      query.isSubscribed = true;
    } else if (recipientType === "new_users") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      query.createdAt = { $gte: thirtyDaysAgo };
    } else if (recipientType === "inactive") {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // Basic heuristic: accounts older than 30 days (no activity tracking field is guaranteed)
      query.createdAt = { $lte: thirtyDaysAgo };
    }
    const users = await User.find(query).select("_id");
    recipients = users.map((u) => ({ _id: u._id }));
  }

  if (!recipients || recipients.length === 0) {
    return next(new ApiError("No recipients found for the selected criteria", 404));
  }

  const computedStatus = status || (scheduledAt ? "scheduled" : "sent");
  const parsedScheduledAt = scheduledAt ? new Date(scheduledAt) : undefined;

  const docs = recipients.map((r) => ({
    user: r._id,
    type,
    title,
    message,
    recipientType,
    status: computedStatus,
    ...(parsedScheduledAt ? { scheduledAt: parsedScheduledAt } : {}),
    ...(computedStatus === "sent" ? { sentAt: new Date() } : {}),
    recipientsCount: 1,
    openedCount: 0,
  }));

  const inserted = await Notification.insertMany(docs, { ordered: false });

  // إرسال push فوراً للمرسلة فقط؛ المجدولة تُرسل لاحقاً عبر المهمة الدورية
  const toSendNow = inserted.filter((doc) => doc.status === "sent");
  const pushPromises = toSendNow.map(async (doc) => {
    try {
      const sent = await sendPushToUser(doc.user, doc, null);
      if (sent) {
        await Notification.updateOne(
          { _id: doc._id },
          { pushSent: true, pushSentAt: new Date() }
        );
      }
    } catch (err) {
      console.error(`[Push] Admin broadcast to user ${doc.user}:`, err.message);
    }
  });
  await Promise.allSettled(pushPromises);

  res.status(201).json({
    message: "Broadcast notifications created",
    results: inserted.length,
    data: inserted,
  });
});

/**
 * معالجة الإشعارات المجدولة التي حان موعدها: إرسال push وتحديث الحالة إلى sent
 * يُستدعى من مهمة دورية (كل دقيقة) في server.js
 */
exports.processScheduledNotifications = async () => {
  const now = new Date();
  const due = await Notification.find({
    status: "scheduled",
    scheduledAt: { $lte: now },
  }).lean();

  if (due.length === 0) return;

  for (const doc of due) {
    try {
      await sendPushToUser(doc.user, doc, null);
      await Notification.updateOne(
        { _id: doc._id },
        {
          status: "sent",
          sentAt: new Date(),
          pushSent: true,
          pushSentAt: new Date(),
        }
      );
    } catch (err) {
      console.error(
        `[Scheduled notification] Failed for ${doc._id}:`,
        err.message
      );
    }
  }
};

// Helper functions for creating notifications
exports.createFriendRequestNotification = async (senderId, receiverId) => {
  try {
    const notification = await Notification.create({
      user: receiverId,
      type: 'friend_request',
      title: 'طلب صداقة جديد',
      message: 'لديك طلب صداقة جديد',
      relatedUser: senderId,
    });
    return notification;
  } catch (error) {
    console.error('Error creating friend request notification:', error);
  }
};

exports.createFriendRequestAcceptedNotification = async (senderId, receiverId) => {
  try {
    const notification = await Notification.create({
      user: senderId,
      type: 'friend_request_accepted',
      title: 'تم قبول طلب الصداقة',
      message: 'تم قبول طلب صداقتك',
      relatedUser: receiverId,
    });
    return notification;
  } catch (error) {
    console.error('Error creating friend request accepted notification:', error);
  }
};

exports.createMessageNotification = async (senderId, receiverId, chatId, messageContent) => {
  try {
    const notification = await Notification.create({
      user: receiverId,
      type: 'new_message',
      title: 'رسالة جديدة',
      message: messageContent.length > 50 ? messageContent.substring(0, 50) + '...' : messageContent,
      relatedUser: senderId,
      relatedChat: chatId,
      data: { messageContent },
    });
    return notification;
  } catch (error) {
    console.error('Error creating message notification:', error);
  }
};

exports.createLikeNotification = async (likerId, postOwnerId, postId) => {
  try {
    const notification = await Notification.create({
      user: postOwnerId,
      type: 'post_like',
      title: 'إعجاب جديد',
      message: 'أعجب شخص بمنشورك',
      relatedUser: likerId,
      relatedPost: postId,
    });
    return notification;
  } catch (error) {
    console.error('Error creating like notification:', error);
  }
};

exports.createCommentNotification = async (commenterId, postOwnerId, postId, commentContent) => {
  try {
    const notification = await Notification.create({
      user: postOwnerId,
      type: 'post_comment',
      title: 'تعليق جديد',
      message: commentContent.length > 50 ? commentContent.substring(0, 50) + '...' : commentContent,
      relatedUser: commenterId,
      relatedPost: postId,
      data: { commentContent },
    });
    return notification;
  } catch (error) {
    console.error('Error creating comment notification:', error);
  }
};

exports.createProfileViewNotification = async (viewerId, profileOwnerId) => {
  try {
    // Check if notification already exists for this viewer in the last 24 hours
    const existingNotification = await Notification.findOne({
      user: profileOwnerId,
      type: 'profile_view',
      relatedUser: viewerId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    });

    if (!existingNotification) {
      const notification = await Notification.create({
        user: profileOwnerId,
        type: 'profile_view',
        title: 'زيارة ملف شخصي',
        message: 'شخص زار ملفك الشخصي',
        relatedUser: viewerId,
      });
      return notification;
    }
  } catch (error) {
    console.error('Error creating profile view notification:', error);
  }
};

exports.createMatchNotification = async (userId1, userId2, matchData) => {
  try {
    // Create notification for both users
    const notifications = await Promise.all([
      Notification.create({
        user: userId1,
        type: 'match_suggestion',
        title: 'تطابق جديد!',
        message: 'تم العثور على تطابق مناسب لك',
        relatedUser: userId2,
        data: matchData,
      }),
      Notification.create({
        user: userId2,
        type: 'match_suggestion',
        title: 'تطابق جديد!',
        message: 'تم العثور على تطابق مناسب لك',
        relatedUser: userId1,
        data: matchData,
      })
    ]);
    return notifications;
  } catch (error) {
    console.error('Error creating match notifications:', error);
  }
};

exports.createSecurityNotification = async (userId, title, message) => {
  try {
    const notification = await Notification.create({
      user: userId,
      type: 'security_update',
      title: title,
      message: message,
    });
    return notification;
  } catch (error) {
    console.error('Error creating security notification:', error);
  }
};

// إشعار أشخاص بالقرب منك أو لديهم نفس الاهتمامات
exports.createPeopleNearbyNotification = async (userId, matchCount) => {
  try {
    const existing = await Notification.findOne({
      user: userId,
      type: 'people_nearby',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (existing) return null;
    const notification = await Notification.createNotification({
      user: userId,
      type: 'people_nearby',
      title: 'أشخاص قد يهمك التعرف عليهم',
      message:
        matchCount > 1
          ? `لديك ${matchCount} أشخاص بالقرب منك أو يشتركون معك في الاهتمامات`
          : 'شخص واحد بالقرب منك أو لديه نفس اهتماماتك',
    });
    return notification;
  } catch (error) {
    console.error('Error creating people nearby notification:', error);
    return null;
  }
};

// @desc    Create test notifications for development
// @route   POST /api/v1/notifications/test
// @access  Private/Admin
exports.createTestNotifications = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const testNotifications = [
    {
      user: userId,
      type: 'friend_request',
      title: 'طلب صداقة جديد',
      message: 'لديك طلب صداقة جديد من أحمد',
      isRead: false,
    },
    {
      user: userId,
      type: 'new_message',
      title: 'رسالة جديدة',
      message: 'مرحبا! كيف حالك اليوم؟',
      isRead: false,
    },
    {
      user: userId,
      type: 'post_like',
      title: 'إعجاب جديد',
      message: 'أعجب شخص بمنشورك',
      isRead: false,
    },
    {
      user: userId,
      type: 'security_update',
      title: 'تحديث أمني',
      message: 'تم تحديث إعدادات الأمان لحسابك',
      isRead: true,
    },
    {
      user: userId,
      type: 'match_suggestion',
      title: 'تطابق جديد!',
      message: 'تم العثور على تطابق مناسب لك',
      isRead: false,
    },
  ];

  const notifications = await Notification.insertMany(testNotifications);

  res.status(201).json({
    message: "Test notifications created successfully",
    data: notifications,
  });
});