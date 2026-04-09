const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const { getAll, getOne, deleteOne, updateOne } = require("./handlersFactory");

const Notification = require("../models/notificationModel");
const User = require("../models/userModel");
const { sendPushToUser } = require("../utils/pushNotification");

// ط¥ط´ط¹ط§ط±ط§طھ ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ… ظپظ‚ط· (ط§ظ„ط¨ط« ظ…ظ† ط§ظ„ط£ط¯ظ…ظ†)طŒ ظˆظ„ظٹط³ ظƒظ„ ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„طھط·ط¨ظٹظ‚
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
    req.query,
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
    return next(new ApiError(`ظ„ط§ ظٹظˆط¬ط¯ ط¥ط´ط¹ط§ط± ط¨ظ‡ط°ط§ ط§ظ„ظ…ط¹ط±ظپ ${id}`, 404));
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
    { new: true },
  );

  if (!notification) {
    return next(new ApiError(`ظ„ط§ ظٹظˆط¬ط¯ ط¥ط´ط¹ط§ط± ط¨ظ‡ط°ط§ ط§ظ„ظ…ط¹ط±ظپ ${id}`, 404));
  }

  res.status(200).json({
    message: "طھظ… طھط­ط¯ظٹط« ط§ظ„ط¥ط´ط¹ط§ط± ط¨ظ†ط¬ط§ط­",
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
    },
  );

  res.status(200).json({
    message: "طھظ… طھط­ط¯ظٹط« ط¬ظ…ظٹط¹ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط¨ظ†ط¬ط§ط­",
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
    return next(new ApiError(`ظ„ط§ ظٹظˆط¬ط¯ ط¥ط´ط¹ط§ط± ط¨ظ‡ط°ط§ ط§ظ„ظ…ط¹ط±ظپ ${id}`, 404));
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
    message: "طھظ… ط­ط°ظپ ط¬ظ…ظٹط¹ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ظ‚ط±ظˆط،ط© ط¨ظ†ط¬ط§ط­",
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
    message: "طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط± ط¨ظ†ط¬ط§ط­",
    data: notification,
  });
});

// ===============================
// Admin specific handlers
// ===============================

// @desc    Get all notifications (admin) â€” ظپظ‚ط· ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ط¨ط« ظ…ظ† ظ„ظˆط­ط© ط§ظ„طھط­ظƒظ…
// @route   GET /api/v1/notifications/admin
// @access  Private/Admin
exports.getAllNotificationsAdmin = asyncHandler(async (req, res) => {
  const filter = { type: { $in: ADMIN_BROADCAST_TYPES } };
  const documentsCounts = await Notification.countDocuments(filter);
  const apiFeatures = new ApiFeatures(Notification.find(filter), req.query)
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
exports.createAdminBroadcastNotification = asyncHandler(
  async (req, res, next) => {
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
          new ApiError(
            "ظٹط¬ط¨ ط£ظ† ظٹطھظ… طھظˆظپظٹط± userIds ط¹ظ†ط¯ظ…ط§ ظٹظƒظˆظ† recipientType ط®ط§طµ",
            400,
          ),
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
      return next(new ApiError("ظ„ط§ ظٹظˆط¬ط¯ ظ…ط³طھط®ط¯ظ…ظˆظ† ظ„ظ„طھظˆطµظٹظ„ ط¨ظ‡ط°ط§ ط§ظ„ظ…ط¹ظٹط§ط±", 404));
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
    // ظ…ظ„ط§ط­ط¸ط©: ط¥ط±ط³ط§ظ„ ط§ظ„ظ€ push ظٹطھظ… ط¹ط¨ط± hook ظپظٹ `notificationModel.js` ظپظ‚ط· ط¹ظ†ط¯ظ…ط§ طھظƒظˆظ† ط§ظ„ط­ط§ظ„ط© "sent".
    // ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ "scheduled" طھظڈط±ط³ظ„ ظ„ط§ط­ظ‚ط§ظ‹ ط¹ط¨ط± `processScheduledNotifications`.

    res.status(201).json({
      message: "طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ط¨ط«ظˆط«ط© ط¨ظ†ط¬ط§ط­",
      results: inserted.length,
      data: inserted,
    });
  },
);

/**
 * ظ…ط¹ط§ظ„ط¬ط© ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„ظ…ط¬ط¯ظˆظ„ط© ط§ظ„طھظٹ ط­ط§ظ† ظ…ظˆط¹ط¯ظ‡ط§: ط¥ط±ط³ط§ظ„ push ظˆطھط­ط¯ظٹط« ط§ظ„ط­ط§ظ„ط© ط¥ظ„ظ‰ sent
 * ظٹظڈط³طھط¯ط¹ظ‰ ظ…ظ† ظ…ظ‡ظ…ط© ط¯ظˆط±ظٹط© (ظƒظ„ ط¯ظ‚ظٹظ‚ط©) ظپظٹ server.js
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
        },
      );
    } catch (err) {
      console.error(`[ط§ظ„ط¥ط´ط¹ط§ط± ط§ظ„ظ…ط¬ط¯ظˆظ„] ظپط´ظ„ ظ„ ${doc._id}:`, err.message);
    }
  }
};

// Helper functions for creating notifications
exports.createFriendRequestNotification = async (senderId, receiverId) => {
  try {
    const notification = await Notification.createNotification({
      user: receiverId,
      type: "friend_request",
      title: "طلب تعارف جديد",
      message: "لديك طلب تعارف جديد",
      relatedUser: senderId,
      status: "sent",
    });
    return notification;
  } catch (error) {
    console.error("فشل إنشاء إشعار طلب التعارف:", error);
    return null;
  }
};

exports.createFriendRequestAcceptedNotification = async (
  senderId,
  receiverId,
) => {
  try {
    const notification = await Notification.createNotification({
      user: senderId,
      type: "friend_request_accepted",
      title: "تمت الموافقة على طلب التعارف",
      message: "تمت الموافقة على طلب التعارف الخاص بك",
      relatedUser: receiverId,
      status: "sent",
    });
    return notification;
  } catch (error) {
    console.error("فشل إنشاء إشعار الموافقة على طلب التعارف:", error);
    return null;
  }
};

exports.createMessageNotification = async (
  senderId,
  receiverId,
  chatId,
  messageContent,
) => {
  try {
    const notification = await Notification.create({
      user: receiverId,
      type: "new_message",
      title: "ط±ط³ط§ظ„ط© ط¬ط¯ظٹط¯ط©",
      message:
        messageContent.length > 50
          ? messageContent.substring(0, 50) + "..."
          : messageContent,
      relatedUser: senderId,
      relatedChat: chatId,
      data: { messageContent },
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط§ظ„ط±ط³ط§ظ„ط©:", error);
  }
};

exports.createLikeNotification = async (likerId, postOwnerId, postId) => {
  try {
    const notification = await Notification.create({
      user: postOwnerId,
      type: "post_like",
      title: "ط¥ط¹ط¬ط§ط¨ ط¬ط¯ظٹط¯",
      message: "ط£ط¹ط¬ط¨ ط´ط®طµ ط¨ظ…ظ†ط´ظˆط±ظƒ",
      relatedUser: likerId,
      relatedPost: postId,
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط§ظ„ط¥ط¹ط¬ط§ط¨:", error);
  }
};

exports.createCommentNotification = async (
  commenterId,
  postOwnerId,
  postId,
  commentContent,
) => {
  try {
    const notification = await Notification.create({
      user: postOwnerId,
      type: "post_comment",
      title: "طھط¹ظ„ظٹظ‚ ط¬ط¯ظٹط¯",
      message:
        commentContent.length > 50
          ? commentContent.substring(0, 50) + "..."
          : commentContent,
      relatedUser: commenterId,
      relatedPost: postId,
      data: { commentContent },
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط§ظ„طھط¹ظ„ظٹظ‚:", error);
  }
};

exports.createProfileViewNotification = async (viewerId, profileOwnerId) => {
  try {
    // Check if notification already exists for this viewer in the last 24 hours
    const existingNotification = await Notification.findOne({
      user: profileOwnerId,
      type: "profile_view",
      relatedUser: viewerId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (!existingNotification) {
      const viewer = await User.findById(viewerId).select("name").lean();
      const viewerName = viewer?.name?.trim() || "ظ…ط³طھط®ط¯ظ…";
      const notification = await Notification.create({
        user: profileOwnerId,
        type: "profile_view",
        title: "ط²ظٹط§ط±ط© ظ…ظ„ظپ ط´ط®طµظٹ",
        message: `${viewerName} ظ‚ط§ظ… ط¨ط²ظٹط§ط±ط© ظ…ظ„ظپظƒ ط§ظ„ط´ط®طµظٹ`,
        relatedUser: viewerId,
      });
      return notification;
    }
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط²ظٹط§ط±ط© ظ…ظ„ظپ ط´ط®طµظٹ:", error);
  }
};

exports.createGalleryViewRequestNotification = async (requesterId, ownerId) => {
  try {
    const requester = await User.findById(requesterId).select("name").lean();
    const requesterName = requester?.name?.trim() || "ظ…ط³طھط®ط¯ظ…";
    const notification = await Notification.create({
      user: ownerId,
      type: "gallery_view_request",
      title: "ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶",
      message: `${requesterName} ظٹط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ظ…ط¹ط±ط¶ طµظˆط±ظƒ`,
      relatedUser: requesterId,
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶:", error);
  }
};

// ط¥ط´ط¹ط§ط± ط§ظ„ظ‚ط¨ظˆظ„/ط§ظ„ط±ظپط¶ ظٹظڈط±ط³ظ„ ظپظ‚ط· ظ„طµط§ط­ط¨ ط§ظ„ط·ظ„ط¨ (ط§ظ„ط·ط§ظ„ط¨) ظˆظ„ظٹط³ ظ„طµط§ط­ط¨ ط§ظ„ظ…ط¹ط±ط¶
exports.createGalleryViewAcceptedNotification = async (
  ownerId,
  requesterId,
) => {
  try {
    const recipientId =
      requesterId && typeof requesterId === "object"
        ? requesterId._id ?? requesterId
        : requesterId;
    if (!recipientId) return null;
    const owner = await User.findById(ownerId).select("name").lean();
    const ownerName = owner?.name?.trim() || "ظ…ط³طھط®ط¯ظ…";
    const notification = await Notification.create({
      user: recipientId,
      type: "gallery_view_accepted",
      title: "طھظ… ظ‚ط¨ظˆظ„ ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶",
      message: `ظˆط§ظپظ‚ ${ownerName} ط¹ظ„ظ‰ ط·ظ„ط¨ظƒ ظ„ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶. ظٹظ…ظƒظ†ظƒ ط§ظ„ظ…ط´ط§ظ‡ط¯ط© ظ…ط±ط© ظˆط§ط­ط¯ط©.`,
      relatedUser: ownerId,
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ظ‚ط¨ظˆظ„ ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶:", error);
  }
};

exports.createGalleryViewRejectedNotification = async (
  ownerId,
  requesterId,
) => {
  try {
    const recipientId =
      requesterId && typeof requesterId === "object"
        ? requesterId._id ?? requesterId
        : requesterId;
    if (!recipientId) return null;
    const owner = await User.findById(ownerId).select("name").lean();
    const ownerName = owner?.name?.trim() || "ظ…ط³طھط®ط¯ظ…";
    const notification = await Notification.create({
      user: recipientId,
      type: "gallery_view_rejected",
      title: "طھظ… ط±ظپط¶ ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶",
      message: `ط±ظپط¶ ${ownerName} ط·ظ„ط¨ظƒ ظ„ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶`,
      relatedUser: ownerId,
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط±ظپط¶ ط·ظ„ط¨ ظ…ط´ط§ظ‡ط¯ط© ط§ظ„ظ…ط¹ط±ط¶:", error);
  }
};

exports.createMatchNotification = async (userId1, userId2, matchData) => {
  try {
    // Create notification for both users
    const notifications = await Promise.all([
      Notification.create({
        user: userId1,
        type: "match_suggestion",
        title: "طھط·ط§ط¨ظ‚ ط¬ط¯ظٹط¯!",
        message: "طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ طھط·ط§ط¨ظ‚ ظ…ظ†ط§ط³ط¨ ظ„ظƒ",
        relatedUser: userId2,
        data: matchData,
      }),
      Notification.create({
        user: userId2,
        type: "match_suggestion",
        title: "طھط·ط§ط¨ظ‚ ط¬ط¯ظٹط¯!",
        message: "طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ طھط·ط§ط¨ظ‚ ظ…ظ†ط§ط³ط¨ ظ„ظƒ",
        relatedUser: userId1,
        data: matchData,
      }),
    ]);
    return notifications;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„طھط·ط§ط¨ظ‚:", error);
  }
};

exports.createSecurityNotification = async (userId, title, message) => {
  try {
    const notification = await Notification.create({
      user: userId,
      type: "security_update",
      title: title,
      message: message,
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط§ظ„ط£ظ…ظ†ظٹ:", error);
  }
};

// ط¥ط´ط¹ط§ط± ط£ط´ط®ط§طµ ط¨ط§ظ„ظ‚ط±ط¨ ظ…ظ†ظƒ ط£ظˆ ظ„ط¯ظٹظ‡ظ… ظ†ظپط³ ط§ظ„ط§ظ‡طھظ…ط§ظ…ط§طھ
exports.createPeopleNearbyNotification = async (userId, matchCount) => {
  try {
    const existing = await Notification.findOne({
      user: userId,
      type: "people_nearby",
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });
    if (existing) return null;
    const notification = await Notification.createNotification({
      user: userId,
      type: "people_nearby",
      title: "ط£ط´ط®ط§طµ ظ‚ط¯ ظٹظ‡ظ…ظƒ ط§ظ„طھط¹ط±ظپ ط¹ظ„ظٹظ‡ظ…",
      message:
        matchCount > 1
          ? `ظ„ط¯ظٹظƒ ${matchCount} ط£ط´ط®ط§طµ ط¨ط§ظ„ظ‚ط±ط¨ ظ…ظ†ظƒ ط£ظˆ ظٹط´طھط±ظƒظˆظ† ظ…ط¹ظƒ ظپظٹ ط§ظ„ط§ظ‡طھظ…ط§ظ…ط§طھ`
          : "ط´ط®طµ ظˆط§ط­ط¯ ط¨ط§ظ„ظ‚ط±ط¨ ظ…ظ†ظƒ ط£ظˆ ظ„ط¯ظٹظ‡ ظ†ظپط³ ط§ظ‡طھظ…ط§ظ…ط§طھظƒ",
    });
    return notification;
  } catch (error) {
    console.error("ظپط´ظ„ ط¥ظ†ط´ط§ط، ط¥ط´ط¹ط§ط± ط§ظ„ط£ط´ط®ط§طµ ط§ظ„ظ‚ط±ظٹط¨ظٹظ†:", error);
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
      type: "friend_request",
      title: "طلب تعارف جديد",
      message: "لديك طلب تعارف جديد من أحمد",
      isRead: false,
    },
    {
      user: userId,
      type: "new_message",
      title: "ط±ط³ط§ظ„ط© ط¬ط¯ظٹط¯ط©",
      message: "ظ…ط±ط­ط¨ط§! ظƒظٹظپ ط­ط§ظ„ظƒ ط§ظ„ظٹظˆظ…طں",
      isRead: false,
    },
    {
      user: userId,
      type: "post_like",
      title: "ط¥ط¹ط¬ط§ط¨ ط¬ط¯ظٹط¯",
      message: "ط£ط¹ط¬ط¨ ط´ط®طµ ط¨ظ…ظ†ط´ظˆط±ظƒ",
      isRead: false,
    },
    {
      user: userId,
      type: "security_update",
      title: "طھط­ط¯ظٹط« ط£ظ…ظ†ظٹ",
      message: "طھظ… طھط­ط¯ظٹط« ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط£ظ…ط§ظ† ظ„ط­ط³ط§ط¨ظƒ",
      isRead: true,
    },
    {
      user: userId,
      type: "match_suggestion",
      title: "طھط·ط§ط¨ظ‚ ط¬ط¯ظٹط¯!",
      message: "طھظ… ط§ظ„ط¹ط«ظˆط± ط¹ظ„ظ‰ طھط·ط§ط¨ظ‚ ظ…ظ†ط§ط³ط¨ ظ„ظƒ",
      isRead: false,
    },
  ];

  const notifications = await Notification.insertMany(testNotifications);

  res.status(201).json({
    message: "طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„طھط¬ط±ظٹط¨ظٹط© ط¨ظ†ط¬ط§ط­",
    data: notifications,
  });
});


