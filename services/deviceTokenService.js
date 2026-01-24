const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const DeviceToken = require("../models/deviceTokenModel");

// @desc    Register device token for push notifications
// @route   POST /api/v1/device-tokens
// @access  Private/Protect
exports.registerDeviceToken = asyncHandler(async (req, res, next) => {
  const { playerId, platform } = req.body;
  const userId = req.user._id;

  if (!playerId || !platform) {
    return next(new ApiError("playerId and platform are required", 400));
  }

  const token = await DeviceToken.findOneAndUpdate(
    { user: userId, playerId },
    {
      platform,
      isActive: true,
      lastSeenAt: new Date(),
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  res.status(200).json({ data: token });
});

// @desc    Remove device token
// @route   DELETE /api/v1/device-tokens/:playerId
// @access  Private/Protect
exports.removeDeviceToken = asyncHandler(async (req, res, next) => {
  const { playerId } = req.params;
  const userId = req.user._id;

  if (!playerId) {
    return next(new ApiError("playerId is required", 400));
  }

  await DeviceToken.findOneAndUpdate(
    { user: userId, playerId },
    { isActive: false, lastSeenAt: new Date() }
  );

  res.status(200).json({ message: "Device token removed" });
});

