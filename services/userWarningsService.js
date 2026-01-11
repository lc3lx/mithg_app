const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const UserWarnings = require("../models/userWarningsModel");
const User = require("../models/userModel");
const BannedWords = require("../models/bannedWordsModel");
const { autoBlockUser } = require("./userModerationService");

// @desc    Issue a warning to a user
// @route   POST /api/v1/admin/warnings
// @access  Private/Admin
exports.issueWarning = asyncHandler(async (req, res, next) => {
  const {
    userId,
    warningType,
    severity,
    warningMessage,
    bannedWordId,
    violatedMessageId,
    chatId,
    notes,
  } = req.body;

  const adminId = req.admin._id;

  // Validate user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Get current warning count for the user
  const currentWarningCount = await UserWarnings.getWarningCount(userId, 30);

  const warning = await UserWarnings.create({
    user: userId,
    warningType: warningType || "banned_word",
    severity: severity || "medium",
    bannedWord: bannedWordId,
    violatedMessage: violatedMessageId,
    chat: chatId,
    warningMessage:
      warningMessage ||
      "تم اكتشاف محتوى غير مناسب. يرجى الحفاظ على المحادثة محترمة.",
    issuedBy: adminId,
    isAutomatic: false,
    userWarningCount: currentWarningCount + 1,
    notes,
  });

  res.status(201).json({
    message: "Warning issued successfully",
    data: warning,
  });
});

// @desc    Get user warnings
// @route   GET /api/v1/admin/warnings
// @access  Private/Admin
exports.getUserWarnings = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    UserWarnings.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const warnings = await features.query;

  res.status(200).json({
    results: warnings.length,
    data: warnings,
  });
});

// @desc    Get warnings for a specific user
// @route   GET /api/v1/admin/users/:userId/warnings
// @access  Private/Admin
exports.getUserWarningsById = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Validate user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const warnings = await UserWarnings.find({ user: userId }).sort({
    createdAt: -1,
  });

  res.status(200).json({
    results: warnings.length,
    data: warnings,
  });
});

// @desc    Resolve a warning
// @route   PUT /api/v1/admin/warnings/:id/resolve
// @access  Private/Admin
exports.resolveWarning = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { resolutionNotes } = req.body;
  const adminId = req.admin._id;

  const warning = await UserWarnings.findById(id);
  if (!warning) {
    return next(new ApiError("Warning not found", 404));
  }

  if (warning.status !== "active" && warning.status !== "appealed") {
    return next(new ApiError("Warning is already resolved", 400));
  }

  await warning.resolve(adminId, resolutionNotes);

  res.status(200).json({
    message: "Warning resolved successfully",
    data: warning,
  });
});

// @desc    Appeal a warning (User can appeal)
// @route   PUT /api/v1/warnings/:id/appeal
// @access  Private/Protect
exports.appealWarning = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { appealReason } = req.body;
  const userId = req.user._id;

  const warning = await UserWarnings.findOne({
    _id: id,
    user: userId,
  });

  if (!warning) {
    return next(new ApiError("Warning not found", 404));
  }

  if (warning.status !== "active") {
    return next(new ApiError("Warning cannot be appealed", 400));
  }

  if (!appealReason || appealReason.trim().length < 10) {
    return next(
      new ApiError("Appeal reason must be at least 10 characters", 400)
    );
  }

  await warning.appeal(appealReason);

  res.status(200).json({
    message: "Warning appeal submitted successfully",
    data: warning,
  });
});

// @desc    Get user's own warnings
// @route   GET /api/v1/warnings
// @access  Private/Protect
exports.getMyWarnings = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const warnings = await UserWarnings.find({ user: userId }).sort({
    createdAt: -1,
  });

  res.status(200).json({
    results: warnings.length,
    data: warnings,
  });
});

// @desc    Check message for banned words and handle violations
// @route   POST /api/v1/warnings/check-message
// @access  Private (Used internally by chat service)
exports.checkMessageAndWarn = asyncHandler(async (req, res, next) => {
  const { message, userId, chatId, messageId } = req.body;

  // Check if message contains banned words
  const checkResult = await BannedWords.checkMessage(message);

  if (!checkResult.found) {
    return res.status(200).json({ safe: true });
  }

  const { bannedWord } = checkResult;

  // Increment violation count for the banned word
  await bannedWord.incrementViolation();

  // Get current warning count for the user
  const currentWarningCount = await UserWarnings.getWarningCount(userId, 30);

  // Create warning
  const warning = await UserWarnings.create({
    user: userId,
    warningType: "banned_word",
    severity: bannedWord.severity,
    bannedWord: bannedWord._id,
    violatedMessage: messageId,
    chat: chatId,
    warningMessage: bannedWord.warningMessage,
    isAutomatic: true,
    userWarningCount: currentWarningCount + 1,
  });

  // Check if user should be blocked
  const shouldBlock = await UserWarnings.shouldBlockUser(userId, bannedWord);

  if (shouldBlock) {
    // Auto-block the user
    const blockDuration = bannedWord.blockDurationHours;
    await autoBlockUser(
      userId,
      `Automatic block due to repeated violations (${bannedWord.word})`,
      blockDuration,
      null // No admin ID for auto-block
    );

    warning.leadsToBlock = true;
    warning.blockDurationHours = blockDuration;
    warning.blockReason = `Reached ${bannedWord.autoBlockThreshold} warnings in 30 days`;
    await warning.save();
  }

  res.status(200).json({
    safe: false,
    warning: {
      message: bannedWord.warningMessage,
      severity: bannedWord.severity,
      warningCount: warning.userWarningCount,
      blocked: shouldBlock,
      blockDuration: shouldBlock ? bannedWord.blockDurationHours : null,
    },
    bannedWord: bannedWord.word,
  });
});

// @desc    Get warning statistics
// @route   GET /api/v1/admin/warnings/stats
// @access  Private/Admin
exports.getWarningStats = asyncHandler(async (req, res) => {
  const totalWarnings = await UserWarnings.countDocuments();
  const activeWarnings = await UserWarnings.countDocuments({
    status: "active",
  });
  const resolvedWarnings = await UserWarnings.countDocuments({
    status: "resolved",
  });
  const appealedWarnings = await UserWarnings.countDocuments({
    status: "appealed",
  });

  // Type breakdown
  const typeStats = await UserWarnings.aggregate([
    { $group: { _id: "$warningType", count: { $sum: 1 } } },
  ]);

  // Severity breakdown
  const severityStats = await UserWarnings.aggregate([
    { $group: { _id: "$severity", count: { $sum: 1 } } },
  ]);

  // Users with most warnings
  const topViolators = await UserWarnings.aggregate([
    { $match: { status: { $ne: "expired" } } },
    {
      $group: {
        _id: "$user",
        warningCount: { $sum: 1 },
        lastWarning: { $max: "$createdAt" },
      },
    },
    { $sort: { warningCount: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        userName: "$user.name",
        userEmail: "$user.email",
        warningCount: 1,
        lastWarning: 1,
      },
    },
  ]);

  // Recent warnings
  const recentWarnings = await UserWarnings.find()
    .sort({ createdAt: -1 })
    .limit(20)
    .populate("user", "name email")
    .populate("bannedWord", "word category");

  res.status(200).json({
    data: {
      total: totalWarnings,
      active: activeWarnings,
      resolved: resolvedWarnings,
      appealed: appealedWarnings,
      types: typeStats,
      severities: severityStats,
      topViolators,
      recentWarnings,
    },
  });
});

// @desc    Bulk resolve warnings
// @route   PUT /api/v1/admin/warnings/bulk-resolve
// @access  Private/Admin
exports.bulkResolveWarnings = asyncHandler(async (req, res, next) => {
  const { warningIds, resolutionNotes } = req.body;
  const adminId = req.admin._id;

  if (!warningIds || !Array.isArray(warningIds) || warningIds.length === 0) {
    return next(new ApiError("Warning IDs array is required", 400));
  }

  const results = {
    resolved: [],
    skipped: [],
    errors: [],
  };

  for (const warningId of warningIds) {
    try {
      const warning = await UserWarnings.findById(warningId);

      if (!warning) {
        results.errors.push({
          warningId,
          error: "Warning not found",
        });
        continue;
      }

      if (warning.status === "resolved") {
        results.skipped.push({
          warningId,
          reason: "Already resolved",
        });
        continue;
      }

      await warning.resolve(adminId, resolutionNotes);
      results.resolved.push(warning);
    } catch (error) {
      results.errors.push({
        warningId,
        error: error.message,
      });
    }
  }

  res.status(200).json({
    message: `Bulk operation completed. Resolved: ${results.resolved.length}, Skipped: ${results.skipped.length}, Errors: ${results.errors.length}`,
    data: results,
  });
});

// @desc    Expire old warnings
// @route   POST /api/v1/admin/warnings/expire-old
// @access  Private/Admin
exports.expireOldWarnings = asyncHandler(async (req, res) => {
  const expiredCount = await UserWarnings.updateMany(
    {
      status: "active",
      expiresAt: { $lt: new Date() },
    },
    { status: "expired" }
  );

  res.status(200).json({
    message: `${expiredCount.modifiedCount} warnings expired successfully`,
  });
});
