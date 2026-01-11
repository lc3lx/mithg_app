const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const { getAll, getOne, deleteOne } = require("./handlersFactory");

const Notification = require("../models/notificationModel");

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
