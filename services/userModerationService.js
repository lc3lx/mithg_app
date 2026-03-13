const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const User = require("../models/userModel");
const UserWarnings = require("../models/userWarningsModel");

// @desc    Block a user manually
// @route   PUT /api/v1/admin/users/:id/block
// @access  Private/Admin
exports.blockUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { blockReason, blockDurationHours, fullBlock } = req.body;
  const adminId = req.admin._id;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  if (user.isBlocked) {
    return next(new ApiError("User is already blocked", 400));
  }

  // Calculate block end date
  const blockedUntil = new Date();
  blockedUntil.setHours(blockedUntil.getHours() + (blockDurationHours || 24));

  // Update user
  user.isBlocked = true;
  user.blockedUntil = blockedUntil;
  user.blockReason = blockReason || "Manual block by admin";
  user.blockedBy = adminId;

  // حظر شامل: IP + جهاز + جوال — عند إلغاء الحظر تُرفع كلها
  if (fullBlock) {
    const ips = [].concat(user.lastLoginIp).filter(Boolean);
    const deviceIds = [].concat(user.lastDeviceId).filter(Boolean);
    user.blockedIdentifiers = {
      phone: user.phone || undefined,
      ips,
      deviceIds,
    };
  }

  await user.save();

  // Populate admin info
  await user.populate("blockedBy", "name email");

  res.status(200).json({
    message: "User blocked successfully",
    data: {
      userId: user._id,
      isBlocked: user.isBlocked,
      blockedUntil: user.blockedUntil,
      blockReason: user.blockReason,
      blockedBy: user.blockedBy,
    },
  });
});

// @desc    Unblock a user
// @route   PUT /api/v1/admin/users/:id/unblock
// @access  Private/Admin
exports.unblockUser = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  if (!user.isBlocked) {
    return next(new ApiError("User is not blocked", 400));
  }

  // Update user — إزالة الحظر والحظر الشامل (IP + جهاز + جوال)
  user.isBlocked = false;
  user.blockedUntil = null;
  user.blockReason = null;
  user.blockedBy = null;
  user.blockedIdentifiers = undefined;
  await user.save();

  res.status(200).json({
    message: "User unblocked successfully",
    data: {
      userId: user._id,
      isBlocked: user.isBlocked,
    },
  });
});

// @desc    Get blocked users
// @route   GET /api/v1/admin/users/blocked
// @access  Private/Admin
exports.getBlockedUsers = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    User.find({
      isBlocked: true,
      blockedUntil: { $gt: new Date() },
    }).populate("blockedBy", "name email adminType"),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const users = await features.mongooseQuery;

  res.status(200).json({
    results: users.length,
    data: users,
  });
});

// @desc    Auto-block user based on warning count (called internally)
// @access  Internal
exports.autoBlockUser = asyncHandler(
  async (userId, blockReason, blockDurationHours, blockedBy) => {
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError("User not found", 404);
    }

    if (user.isBlocked) {
      return; // Already blocked
    }

    // Calculate block end date
    const blockedUntil = new Date();
    blockedUntil.setHours(blockedUntil.getHours() + (blockDurationHours || 24));

    // Update user
    user.isBlocked = true;
    user.blockedUntil = blockedUntil;
    user.blockReason = blockReason;
    user.blockedBy = blockedBy;
    await user.save();

    return user;
  }
);

// @desc    Check and unblock expired blocks
// @route   POST /api/v1/admin/moderation/unblock-expired
// @access  Private/Admin
exports.unblockExpiredBlocks = asyncHandler(async (req, res) => {
  const result = await User.updateMany(
    {
      isBlocked: true,
      blockedUntil: { $lt: new Date() },
    },
    {
      isBlocked: false,
      blockedUntil: null,
      blockReason: null,
      blockedBy: null,
    }
  );

  res.status(200).json({
    message: `${result.modifiedCount} expired blocks removed`,
  });
});

// @desc    Get user moderation stats
// @route   GET /api/v1/admin/moderation/stats
// @access  Private/Admin
exports.getModerationStats = asyncHandler(async (req, res) => {
  const now = new Date();
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Current blocked users
  const currentlyBlocked = await User.countDocuments({
    isBlocked: true,
    blockedUntil: { $gt: now },
  });

  // Users blocked in last 30 days
  const blockedLast30Days = await User.countDocuments({
    isBlocked: true,
    blockedUntil: { $gt: now },
    createdAt: { $gte: last30Days },
  });

  // Warnings issued in last 30 days
  const warningsLast30Days = await UserWarnings.countDocuments({
    createdAt: { $gte: last30Days },
  });

  // Users with multiple warnings
  const usersWithMultipleWarnings = await UserWarnings.aggregate([
    {
      $match: {
        createdAt: { $gte: last30Days },
        status: { $ne: "expired" },
      },
    },
    {
      $group: {
        _id: "$user",
        warningCount: { $sum: 1 },
      },
    },
    {
      $match: {
        warningCount: { $gte: 3 },
      },
    },
    {
      $count: "usersWithMultipleWarnings",
    },
  ]);

  res.status(200).json({
    data: {
      currentlyBlocked,
      blockedLast30Days,
      warningsLast30Days,
      usersWithMultipleWarnings:
        usersWithMultipleWarnings[0]?.usersWithMultipleWarnings || 0,
    },
  });
});

// @desc    Reset user warning count (after successful appeal or good behavior)
// @route   PUT /api/v1/admin/users/:id/reset-warnings
// @access  Private/Admin
exports.resetUserWarnings = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Reset warning count and unblock if blocked
  user.warningCount = 0;
  user.lastWarning = null;

  if (user.isBlocked) {
    user.isBlocked = false;
    user.blockedUntil = null;
    user.blockReason = null;
    user.blockedBy = null;
    user.blockedIdentifiers = undefined;
  }

  await user.save();

  res.status(200).json({
    message: "User warnings reset successfully",
    data: {
      userId: user._id,
      warningCount: user.warningCount,
      isBlocked: user.isBlocked,
    },
  });
});
