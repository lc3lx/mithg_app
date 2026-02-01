const asyncHandler = require("express-async-handler");
const { v4: uuidv4 } = require("uuid");
const sharp = require("sharp");
const bcrypt = require("bcryptjs");

const factory = require("./handlersFactory");
const ApiError = require("../utils/apiError");
const { uploadSingleImage } = require("../middlewares/uploadImageMiddleware");
const createToken = require("../utils/createToken");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const DeviceToken = require("../models/deviceTokenModel");
const UserReport = require("../models/userReportModel");
const { createFriendRequestNotification, createFriendRequestAcceptedNotification } = require("./notificationService");

// Upload single image
exports.uploadUserImage = uploadSingleImage("profileImg");
exports.uploadCoverImage = uploadSingleImage("coverImg");

// Image processing
exports.resizeImage = asyncHandler(async (req, res, next) => {
  console.log('🔄 resizeImage called, URL:', req.originalUrl);
  console.log('📁 req.file:', req.file ? 'EXISTS' : 'NOT FOUND');
  console.log('📋 req.body:', req.body);

  const filename = `user-${uuidv4()}-${Date.now()}.jpeg`;

  if (req.file) {
    console.log('🖼️ Processing image file');
    await sharp(req.file.buffer)
      .resize(600, 600)
      .toFormat("jpeg")
      .jpeg({ quality: 95 })
      .toFile(`uploads/users/${filename}`);

    // Save image into our db - determine which field to update based on URL
    if (req.originalUrl.includes('uploadProfileImage')) {
      req.body.profileImg = filename;
      console.log('✅ Set profileImg:', filename);
    } else if (req.originalUrl.includes('uploadCoverImage')) {
      req.body.coverImg = filename;
      console.log('✅ Set coverImg:', filename);
    }
  } else {
    console.log('❌ No file found in request');
  }

  next();
});

// @desc    Get list of users
// @route   GET /api/v1/users
// @access  Private/Admin
exports.getUsers = factory.getAll(User);

// @desc    Get specific user by id
// @route   GET /api/v1/users/:id
// @access  Private/Admin
exports.getUser = factory.getOne(User);

// @desc    Create user
// @route   POST  /api/v1/users
// @access  Private/Admin
exports.createUser = factory.createOne(User);

// @desc    Update specific user
// @route   PUT /api/v1/users/:id
// @access  Private/Admin
exports.updateUser = asyncHandler(async (req, res, next) => {
  const document = await User.findByIdAndUpdate(
    req.params.id,
    {
      name: req.body.name,
      slug: req.body.slug,
      phone: req.body.phone,
      email: req.body.email,
      profileImg: req.body.profileImg,
      role: req.body.role,
    },
    {
      new: true,
    }
  );

  if (!document) {
    return next(new ApiError(`No document for this id ${req.params.id}`, 404));
  }
  res.status(200).json({ data: document });
});

exports.changeUserPassword = asyncHandler(async (req, res, next) => {
  const document = await User.findByIdAndUpdate(
    req.params.id,
    {
      password: await bcrypt.hash(req.body.password, 12),
      passwordChangedAt: Date.now(),
    },
    {
      new: true,
    }
  );

  if (!document) {
    return next(new ApiError(`No document for this id ${req.params.id}`, 404));
  }
  res.status(200).json({ data: document });
});

// @desc    Delete specific user
// @route   DELETE /api/v1/users/:id
// @access  Private/Admin
exports.deleteUser = factory.deleteOne(User);

// @desc    Get Logged user data
// @route   GET /api/v1/users/getMe
// @access  Private/Protect
exports.getLoggedUserData = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Auto-expire subscription if end date passed
  if (user.subscriptionEndDate && user.subscriptionEndDate < new Date()) {
    user.isSubscribed = false;
    await user.save();
  }

  // Convert to plain object
  const userObject = user.toObject();

  // Manually set image URLs if they exist
  if (userObject.profileImg && !userObject.profileImg.startsWith('http')) {
    userObject.profileImg = `${process.env.BASE_URL}/uploads/users/${userObject.profileImg}`;
  }
  if (userObject.coverImg && !userObject.coverImg.startsWith('http')) {
    userObject.coverImg = `${process.env.BASE_URL}/uploads/users/${userObject.coverImg}`;
  }

  console.log('👤 getLoggedUserData - Final data:', {
    profileImg: userObject.profileImg,
    coverImg: userObject.coverImg
  });

  res.status(200).json({ data: userObject });
});

// @desc    Update logged user password
// @route   PUT /api/v1/users/updateMyPassword
// @access  Private/Protect
exports.updateLoggedUserPassword = asyncHandler(async (req, res, next) => {
  // 1) Update user password based user payload (req.user._id)
  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      password: await bcrypt.hash(req.body.password, 12),
      passwordChangedAt: Date.now(),
    },
    {
      new: true,
    }
  );

  // 2) Generate token
  const token = createToken(user._id);

  res.status(200).json({ data: user, token });
});

// @desc    Update logged user data (without password, role)
// @route   PUT /api/v1/users/updateMe
// @access  Private/Protect
exports.updateLoggedUserData = asyncHandler(async (req, res, next) => {
  // Get the user first
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Update only the image fields to avoid validation issues
  if (req.body.profileImg !== undefined) {
    user.profileImg = req.body.profileImg;
  }
  if (req.body.coverImg !== undefined) {
    user.coverImg = req.body.coverImg;
  }

  // Save to trigger post("save") hooks
  const updatedUser = await user.save();

  console.log('✅ User updated successfully:', {
    id: updatedUser._id,
    profileImg: updatedUser.profileImg,
    coverImg: updatedUser.coverImg
  });
  res.status(200).json({ data: updatedUser });
});

// @desc    Update logged user profile info (name, email, phone, bio)
// @route   PUT /api/v1/users/updateProfileInfo
// @access  Private/Protect
exports.updateLoggedUserProfileInfo = asyncHandler(async (req, res, next) => {
  // Get the user first
  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError('User not found', 404));
  }

  // Update profile info fields
  if (req.body.name !== undefined) user.name = req.body.name;
  if (req.body.phone !== undefined) user.phone = req.body.phone;
  if (req.body.bio !== undefined) user.bio = req.body.bio;
  if (req.body.about !== undefined) user.about = req.body.about;
  if (req.body.age !== undefined) user.age = req.body.age;
  if (req.body.country !== undefined) user.country = req.body.country;
  if (req.body.city !== undefined) user.city = req.body.city;
  if (req.body.nationality !== undefined) user.nationality = req.body.nationality;
  if (req.body.educationalLevel !== undefined) user.educationalLevel = req.body.educationalLevel;
  if (req.body.fieldOfWork !== undefined) user.fieldOfWork = req.body.fieldOfWork;
  if (req.body.gender !== undefined) user.gender = req.body.gender;
  if (req.body.socialStatus !== undefined) user.socialStatus = req.body.socialStatus;
  if (req.body.religion !== undefined) user.religion = req.body.religion;
  if (req.body.hijab !== undefined) user.hijab = req.body.hijab;
  if (req.body.havingChildren !== undefined) user.havingChildren = req.body.havingChildren;
  if (req.body.desire !== undefined) user.desire = req.body.desire;
  if (req.body.polygamy !== undefined) user.polygamy = req.body.polygamy;
  if (req.body.smoking !== undefined) user.smoking = req.body.smoking;
  if (req.body.hairColor !== undefined) user.hairColor = req.body.hairColor;
  if (req.body.height !== undefined) user.height = req.body.height;
  if (req.body.weight !== undefined) user.weight = req.body.weight;
  if (req.body.bodyShape !== undefined) user.bodyShape = req.body.bodyShape;
  if (req.body.healthProblems !== undefined) user.healthProblems = req.body.healthProblems;

  // Save to trigger post("save") hooks
  const updatedUser = await user.save();

  console.log('✅ User profile info updated successfully:', {
    id: updatedUser._id,
    name: updatedUser.name,
    email: updatedUser.email,
    phone: updatedUser.phone,
    bio: updatedUser.bio,
  });
  res.status(200).json({ data: updatedUser });
});

// @desc    Deactivate logged user (soft delete - same as freeze)
// @route   DELETE /api/v1/users/deleteMe
// @access  Private/Protect
exports.deleteLoggedUserData = asyncHandler(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user._id, { active: false });

  res.status(204).json({ status: "Success" });
});

// @desc    Freeze account (تجميد الحساب) - user can't login until admin reactivates
// @route   PUT /api/v1/users/freezeAccount
// @access  Private/Protect
exports.freezeAccount = asyncHandler(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user._id, { active: false });

  res.status(200).json({
    status: "Success",
    message: "تم تجميد الحساب بنجاح. يمكنك التواصل مع الدعم لإلغاء التجميد.",
  });
});

// @desc    Permanent delete account (حذف الحساب بشكل نهائي من قاعدة البيانات)
// @route   DELETE /api/v1/users/permanentDelete
// @access  Private/Protect
exports.permanentDeleteAccount = asyncHandler(async (req, res, next) => {
  const userId = req.user._id;
  const deleted = await User.findByIdAndDelete(userId);
  if (!deleted) {
    return next(new ApiError("المستخدم غير موجود أو تم حذفه مسبقاً.", 404));
  }
  // حذف توكنات الجهاز لهذا المستخدم حتى لا تُرسل له إشعارات
  await DeviceToken.deleteMany({ user: userId });

  res.status(200).json({
    status: "Success",
    message: "تم حذف الحساب بشكل نهائي.",
  });
});

// @desc    Add user to favorites
// @route   POST /api/v1/users/favorites/:userId
// @access  Private/Protect
exports.addToFavorites = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check if user is already in favorites
  const currentUser = await User.findById(req.user._id);
  if (currentUser.favorites.includes(userId)) {
    return next(new ApiError("User already in favorites", 400));
  }

  // Add to favorites
  await User.findByIdAndUpdate(req.user._id, {
    $push: { favorites: userId },
  });

  res.status(200).json({
    message: "User added to favorites successfully",
  });
});

// @desc    Remove user from favorites
// @route   DELETE /api/v1/users/favorites/:userId
// @access  Private/Protect
exports.removeFromFavorites = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Remove from favorites
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { favorites: userId },
  });

  res.status(200).json({
    message: "User removed from favorites successfully",
  });
});

// @desc    Get user favorites
// @route   GET /api/v1/users/favorites
// @access  Private/Protect
exports.getUserFavorites = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id).populate(
    "favorites",
    "name age gender bio location profileImg coverImg about isOnline lastSeen profileViews"
  );

  res.status(200).json({
    results: user.favorites.length,
    data: user.favorites,
  });
});

// @desc    Send friend request
// @route   POST /api/v1/users/friend-request/:userId
// @access  Private/Protect
exports.sendFriendRequest = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  // Check if user exists
  const user = await User.findById(userId);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check if they are already friends
  const currentUser = await User.findById(req.user._id);
  if (currentUser.friends.includes(userId)) {
    return next(new ApiError("You are already friends", 400));
  }

  // Check if request already sent
  if (currentUser.sentFriendRequests.includes(userId)) {
    return next(new ApiError("Friend request already sent", 400));
  }

  // Check if user already sent request to current user
  if (currentUser.friendRequests.includes(userId)) {
    return next(
      new ApiError("This user already sent you a friend request", 400)
    );
  }

  // Add to sent requests for current user
  await User.findByIdAndUpdate(req.user._id, {
    $push: { sentFriendRequests: userId },
  });

  // Add to friend requests for target user
  await User.findByIdAndUpdate(userId, {
    $push: { friendRequests: req.user._id },
  });

  // Create notification for the target user
  await createFriendRequestNotification(req.user._id, userId);

  res.status(200).json({
    message: "Friend request sent successfully",
  });
});

// @desc    Accept friend request
// @route   POST /api/v1/users/friend-request/:userId/accept
// @access  Private/Protect
exports.acceptFriendRequest = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const currentUser = await User.findById(req.user._id);
  const otherUser = await User.findById(userId);

  if (!currentUser || !otherUser) {
    return next(new ApiError("User not found", 404));
  }

  // Check if request exists
  if (!currentUser.friendRequests.includes(userId)) {
    return next(new ApiError("No friend request from this user", 400));
  }

  // Remove from friend requests
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { friendRequests: userId },
    $push: { friends: userId },
  });

  // Remove from sent requests and add to friends for other user
  await User.findByIdAndUpdate(userId, {
    $pull: { sentFriendRequests: req.user._id },
    $push: { friends: req.user._id },
  });

  // Ensure a direct chat exists between the two friends
  const existingChat = await Chat.findOne({
    chatType: "direct",
    participants: { $all: [req.user._id, userId] },
    isActive: true,
  });
  if (!existingChat) {
    await Chat.create({
      participants: [req.user._id, userId],
      chatType: "direct",
    });
  }

  // Create notification for the sender (who sent the original request)
  await createFriendRequestAcceptedNotification(req.user._id, userId);

  res.status(200).json({
    message: "Friend request accepted successfully",
  });
});

// @desc    Reject friend request
// @route   POST /api/v1/users/friend-request/:userId/reject
// @access  Private/Protect
exports.rejectFriendRequest = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const currentUser = await User.findById(req.user._id);

  if (!currentUser) {
    return next(new ApiError("User not found", 404));
  }

  // Check if request exists
  if (!currentUser.friendRequests.includes(userId)) {
    return next(new ApiError("No friend request from this user", 400));
  }

  // Remove from friend requests
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { friendRequests: userId },
  });

  // Remove from sent requests for other user
  await User.findByIdAndUpdate(userId, {
    $pull: { sentFriendRequests: req.user._id },
  });

  res.status(200).json({
    message: "Friend request rejected successfully",
  });
});

// @desc    Cancel sent friend request
// @route   DELETE /api/v1/users/friend-request/:userId
// @access  Private/Protect
exports.cancelFriendRequest = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const currentUser = await User.findById(req.user._id);

  if (!currentUser) {
    return next(new ApiError("User not found", 404));
  }

  // Check if request exists
  if (!currentUser.sentFriendRequests.includes(userId)) {
    return next(new ApiError("No sent friend request to this user", 400));
  }

  // Remove from sent requests
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { sentFriendRequests: userId },
  });

  // Remove from friend requests for other user
  await User.findByIdAndUpdate(userId, {
    $pull: { friendRequests: req.user._id },
  });

  res.status(200).json({
    message: "Friend request cancelled successfully",
  });
});

// @desc    Get friend requests (incoming and outgoing)
// @route   GET /api/v1/users/friend-requests
// @access  Private/Protect
exports.getFriendRequests = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user._id)
    .populate(
      "friendRequests",
      "name age gender bio location profileImg coverImg about isOnline lastSeen profileViews"
    )
    .populate(
      "sentFriendRequests",
      "name age gender bio location profileImg coverImg about isOnline lastSeen profileViews"
    );

  res.status(200).json({
    incoming: {
      results: user.friendRequests.length,
      data: user.friendRequests,
    },
    outgoing: {
      results: user.sentFriendRequests.length,
      data: user.sentFriendRequests,
    },
  });
});

// @desc    Get user friends with online status
// @route   GET /api/v1/users/friends/list
// @access  Private
exports.getFriends = asyncHandler(async (req, res) => {
  // Get current user with friends populated
  const currentUser = await User.findById(req.user._id)
    .select("friends")
    .lean();

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

// @desc    Remove friend
// @route   DELETE /api/v1/users/friends/:userId
// @access  Private/Protect
exports.removeFriend = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  if (userId === req.user._id.toString()) {
    return next(new ApiError("You cannot remove yourself", 400));
  }

  const currentUser = await User.findById(req.user._id);
  const otherUser = await User.findById(userId);

  if (!currentUser || !otherUser) {
    return next(new ApiError("User not found", 404));
  }

  if (!currentUser.friends.includes(userId)) {
    return next(new ApiError("User is not in your friends list", 400));
  }

  await User.findByIdAndUpdate(req.user._id, {
    $pull: {
      friends: userId,
      friendRequests: userId,
      sentFriendRequests: userId,
    },
  });

  await User.findByIdAndUpdate(userId, {
    $pull: {
      friends: req.user._id,
      friendRequests: req.user._id,
      sentFriendRequests: req.user._id,
    },
  });

  res.status(200).json({
    message: "Friend removed successfully",
  });
});

// @desc    Block user
// @route   POST /api/v1/users/block/:userId
// @access  Private/Protect
exports.blockUser = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  if (userId === req.user._id.toString()) {
    return next(new ApiError("You cannot block yourself", 400));
  }

  const currentUser = await User.findById(req.user._id);
  const otherUser = await User.findById(userId);

  if (!currentUser || !otherUser) {
    return next(new ApiError("User not found", 404));
  }

  if (currentUser.blockedUsers.includes(userId)) {
    return next(new ApiError("User is already blocked", 400));
  }

  await User.findByIdAndUpdate(req.user._id, {
    $addToSet: { blockedUsers: userId },
    $pull: {
      friends: userId,
      friendRequests: userId,
      sentFriendRequests: userId,
    },
  });

  await User.findByIdAndUpdate(userId, {
    $pull: {
      friends: req.user._id,
      friendRequests: req.user._id,
      sentFriendRequests: req.user._id,
    },
  });

  res.status(200).json({
    message: "User blocked successfully",
  });
});

// @desc    Report user
// @route   POST /api/v1/users/report/:userId
// @access  Private/Protect
exports.reportUser = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;
  const { reason, details } = req.body || {};

  if (userId === req.user._id.toString()) {
    return next(new ApiError("You cannot report yourself", 400));
  }

  const otherUser = await User.findById(userId);
  if (!otherUser) {
    return next(new ApiError("User not found", 404));
  }

  const report = await UserReport.create({
    reporter: req.user._id,
    reportedUser: userId,
    reason: reason || "",
    details: details || "",
  });

  res.status(201).json({
    message: "Report submitted successfully",
    data: report,
  });
});
