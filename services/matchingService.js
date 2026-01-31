const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");
const MessagingRequest = require("../models/messagingRequestModel");
const Notification = require("../models/notificationModel");
const {
  createPeopleNearbyNotification,
} = require("./notificationService");

// Calculate compatibility score between two users
const calculateCompatibilityScore = (user1, user2) => {
  let score = 0;
  const maxScore = 100;

  // Age preference compatibility (25 points)
  const ageDiff = Math.abs(user1.age - user2.age);
  if (ageDiff <= 5) score += 25;
  else if (ageDiff <= 10) score += 15;
  else if (ageDiff <= 15) score += 5;

  // Gender preference compatibility (20 points)
  if (user1.interestedIn === "both" || user1.interestedIn === user2.gender) {
    if (user2.interestedIn === "both" || user2.interestedIn === user1.gender) {
      score += 20;
    }
  }

  // Location proximity (15 points) - simplified version
  if (user1.location && user2.location) {
    if (user1.location.toLowerCase() === user2.location.toLowerCase()) {
      score += 15;
    } else {
      // Could implement distance calculation here
      score += 5;
    }
  }

  // Interests matching (20 points)
  if (user1.interests && user2.interests) {
    const user1Interests = user1.interests.map((i) => i.toLowerCase());
    const user2Interests = user2.interests.map((i) => i.toLowerCase());
    const commonInterests = user1Interests.filter((interest) =>
      user2Interests.includes(interest)
    );
    const interestScore =
      (commonInterests.length /
        Math.max(user1Interests.length, user2Interests.length)) *
      20;
    score += interestScore;
  }

  // Activity status (10 points)
  if (user2.isOnline) score += 10;
  else if (user2.lastSeen) {
    const hoursSinceLastSeen = (Date.now() - user2.lastSeen) / (1000 * 60 * 60);
    if (hoursSinceLastSeen <= 24) score += 7;
    else if (hoursSinceLastSeen <= 72) score += 3;
  }

  // Profile completion (10 points)
  let profileScore = 0;
  if (user2.bio) profileScore += 3;
  if (user2.profileImg) profileScore += 3;
  if (user2.coverImg) profileScore += 2;
  if (user2.interests && user2.interests.length > 0) profileScore += 2;
  score += profileScore;

  return Math.min(score, maxScore);
};

// @desc    Get potential matches for current user
// @route   GET /api/v1/matches
// @access  Private/Protect
exports.getMatches = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { limit = 20, minScore = 40 } = req.query;

  // Get current user with preferences
  const currentUser = await User.findById(userId)
    .select(
      "age gender interestedIn minAgePreference maxAgePreference location friends blockedUsers"
    )
    .lean();

  if (!currentUser) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  // Build match criteria
  const matchCriteria = {
    _id: {
      $ne: userId,
      $nin: [...currentUser.friends, ...currentUser.blockedUsers],
    },
    active: true,
    // Only show subscribed users (users with active subscription)
    isSubscribed: true,
    subscriptionEndDate: { $gt: new Date() },
    // Age range compatibility
    age: {
      $gte: currentUser.minAgePreference,
      $lte: currentUser.maxAgePreference,
    },
    // Gender preference
    gender:
      currentUser.interestedIn === "both"
        ? { $in: ["male", "female"] }
        : currentUser.interestedIn,
  };

  // Get potential matches
  const potentialMatches = await User.find(matchCriteria)
    .select(
      "name age gender bio location profileImg coverImg interests isOnline lastSeen profileViews likesReceived"
    )
    .lean();

  // Calculate compatibility scores and filter
  const matchesWithScores = potentialMatches
    .map((match) => ({
      ...match,
      compatibilityScore: calculateCompatibilityScore(currentUser, match),
    }))
    .filter((match) => match.compatibilityScore >= minScore)
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore)
    .slice(0, limit);

  // إشعار أشخاص بالقرب منك أو لديهم نفس الاهتمامات (مرة واحدة كل 24 ساعة)
  if (matchesWithScores.length > 0) {
    createPeopleNearbyNotification(userId, matchesWithScores.length).catch(
      () => {}
    );
  }

  res.status(200).json({
    results: matchesWithScores.length,
    data: matchesWithScores,
  });
});

// @desc    Get detailed match profile
// @route   GET /api/v1/matches/:userId
// @access  Private/Protect
exports.getMatchProfile = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  // Check if user is blocked
  const currentUser = await User.findById(currentUserId).select("blockedUsers");
  if (currentUser.blockedUsers.includes(userId)) {
    return next(new ApiError("Cannot view blocked user profile", 403));
  }

  const matchProfile = await User.findOne({
    _id: userId,
    // Only allow viewing profiles of subscribed users
    isSubscribed: true,
    subscriptionEndDate: { $gt: new Date() }
  })
    .select(
      "name age gender bio location profileImg coverImg interests isOnline lastSeen posts friends"
    )
    .populate({
      path: "posts",
      select: "title content images postType lookingFor interests createdAt",
      options: { limit: 5, sort: { createdAt: -1 } },
    })
    .lean();

  if (!matchProfile) {
    return next(new ApiError("User not found", 404));
  }

  // Calculate compatibility score
  const currentUserFull = await User.findById(currentUserId)
    .select(
      "age gender interestedIn minAgePreference maxAgePreference location interests"
    )
    .lean();

  const compatibilityScore = calculateCompatibilityScore(
    currentUserFull,
    matchProfile
  );

  // Check if already friends or has pending request
  const existingRequest = await MessagingRequest.findOne({
    $or: [
      { sender: currentUserId, receiver: userId },
      { sender: userId, receiver: currentUserId },
    ],
  })
    .select("status sender receiver")
    .lean();

  // Increment profile view count
  await User.findByIdAndUpdate(userId, { $inc: { profileViews: 1 } });

  const responseData = {
    ...matchProfile,
    compatibilityScore,
    relationshipStatus: existingRequest
      ? {
          status: existingRequest.status,
          isSender:
            existingRequest.sender.toString() === currentUserId.toString(),
          isReceiver:
            existingRequest.receiver.toString() === currentUserId.toString(),
        }
      : null,
  };

  res.status(200).json({ data: responseData });
});

// @desc    Get mutual friends between users
// @route   GET /api/v1/matches/:userId/mutual-friends
// @access  Private/Protect
exports.getMutualFriends = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  const currentUser = await User.findById(currentUserId)
    .select("friends")
    .lean();
  const targetUser = await User.findById(userId).select("friends").lean();

  if (!targetUser) {
    return next(new ApiError("User not found", 404));
  }

  // Find mutual friends
  const mutualFriendIds = currentUser.friends.filter((friendId) =>
    targetUser.friends.includes(friendId)
  );

  // Get mutual friends data
  const mutualFriends = await User.find({
    _id: { $in: mutualFriendIds },
  })
    .select("name profileImg isOnline")
    .lean();

  res.status(200).json({
    results: mutualFriends.length,
    data: mutualFriends,
  });
});

// @desc    Like a user's profile (express interest)
// @route   POST /api/v1/matches/:userId/like
// @access  Private/Protect
exports.likeProfile = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const currentUserId = req.user._id;

  // Check if user exists
  const targetUser = await User.findById(userId);
  if (!targetUser) {
    return next(new ApiError("User not found", 404));
  }

  // Check if already friends
  const currentUser = await User.findById(currentUserId).select("friends");
  if (currentUser.friends.includes(userId)) {
    return next(new ApiError("Already friends with this user", 400));
  }

  // Increment likes received
  await User.findByIdAndUpdate(userId, { $inc: { likesReceived: 1 } });

  // Create notification
  await Notification.createNotification({
    user: userId,
    type: "profile_like",
    title: "Profile Liked",
    message: `${req.user.name} liked your profile`,
    relatedUser: currentUserId,
    data: { action: "like" },
  });

  // إرسال إشعار فوري عبر Socket.io إذا كان متاح
  if (req.app && req.app.get("io")) {
    const io = req.app.get("io");
    const onlineUsers = req.app.get("onlineUsers") || new Map();
    const socketId = onlineUsers.get(userId.toString());

    if (socketId) {
      io.to(socketId).emit("notification", {
        type: "profile_like",
        title: "Profile Liked",
        message: `${req.user.name} liked your profile`,
        relatedUser: currentUserId,
      });
    }
  }

  res.status(200).json({
    message: "Profile liked successfully",
  });
});

// @desc    Get users who liked my profile
// @route   GET /api/v1/matches/likes
// @access  Private/Protect
exports.getProfileLikes = asyncHandler(async (req, res) => {
  // This would require a separate collection for likes
  // For now, return empty array as placeholder
  res.status(200).json({
    results: 0,
    data: [],
    message: "Profile likes feature requires additional implementation",
  });
});
