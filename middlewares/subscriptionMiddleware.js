const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");

// Middleware to check if user has active subscription and is verified
exports.requireSubscriptionAndVerification = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Get user with subscription and verification info
  const user = await User.findById(userId).select(
    'isSubscribed subscriptionEndDate identityVerified'
  );

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Check if user has active subscription
  const hasActiveSubscription = user.isSubscribed &&
    (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());

  if (!hasActiveSubscription) {
    return next(new ApiError(
      'هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة',
      403
    ));
  }

  // Check if user is verified
  if (!user.identityVerified) {
    return next(new ApiError(
      'هذه الميزة تتطلب توثيق الهوية. يرجى توثيق حسابك أولاً',
      403
    ));
  }

  next();
});

// Middleware to check if user has active subscription (for messaging and friends)
exports.requireSubscription = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  // Get user with subscription info
  const user = await User.findById(userId).select('isSubscribed subscriptionEndDate');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Check if user has active subscription
  const hasActiveSubscription = user.isSubscribed &&
    (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());

  if (!hasActiveSubscription) {
    return next(new ApiError(
      'هذه الميزة متاحة فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك للوصول إلى هذه الخدمة',
      403
    ));
  }

  next();
});

// Middleware to check if user can send friend request (must be subscribed)
exports.requireSubscriptionForFriendRequest = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const user = await User.findById(userId).select('isSubscribed subscriptionEndDate');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  const hasActiveSubscription = user.isSubscribed &&
    (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());

  if (!hasActiveSubscription) {
    return next(new ApiError(
      'إرسال طلبات الصداقة متاح فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك لإرسال طلبات صداقة',
      403
    ));
  }

  next();
});

// Middleware to check if user can send messages (must be subscribed)
exports.requireSubscriptionForMessaging = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;

  const user = await User.findById(userId).select('isSubscribed subscriptionEndDate');

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  const hasActiveSubscription = user.isSubscribed &&
    (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());

  if (!hasActiveSubscription) {
    return next(new ApiError(
      'إرسال الرسائل متاح فقط للمستخدمين المشتركين. يرجى ترقية اشتراكك لإمكانية المراسلة',
      403
    ));
  }

  next();
});

// Helper function to check if user has active subscription (for internal use)
exports.hasActiveSubscription = async (userId) => {
  try {
    const user = await User.findById(userId).select('isSubscribed subscriptionEndDate');
    if (!user) return false;

    return user.isSubscribed &&
      (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());
  } catch (error) {
    console.error('Error checking subscription status:', error);
    return false;
  }
};

// اشتراك فعال + حساب موثق (للاستخدام في السوكت وغيره خارج الـ middleware)
exports.hasActiveSubscriptionAndVerification = async (userId) => {
  try {
    const user = await User.findById(userId).select(
      'isSubscribed subscriptionEndDate identityVerified'
    );
    if (!user) return { ok: false, reason: 'not_found' };

    const hasSub =
      user.isSubscribed &&
      (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());
    if (!hasSub) return { ok: false, reason: 'subscription' };

    if (!user.identityVerified) return { ok: false, reason: 'verification' };

    return { ok: true };
  } catch (error) {
    console.error('Error checking subscription and verification:', error);
    return { ok: false, reason: 'error' };
  }
};
