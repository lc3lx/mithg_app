const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");
const {
  createProfileViewNotification,
} = require("./notificationService");

// @desc    Update user about section
// @route   PUT /api/v1/users/about
// @access  Private/Protect (user himself)
exports.updateAbout = asyncHandler(async (req, res, next) => {
  const { about } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { about },
    { new: true, runValidators: true }
  ).select("about");

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  res.status(200).json({
    message: "About section updated successfully",
    data: user,
  });
});

// @desc    Add item to user gallery
// @route   POST /api/v1/users/gallery
// @access  Private/Protect (user himself)
exports.addToGallery = asyncHandler(async (req, res, next) => {
  const { caption, type = "image" } = req.body;

  if (!req.file) {
    return next(new ApiError("File is required", 400));
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Limit gallery to 20 items
  if (user.gallery && user.gallery.length >= 20) {
    return next(new ApiError("Gallery is full (maximum 20 items)", 400));
  }

  let filename;
  const allowedTypes = ["image", "video"];

  if (!allowedTypes.includes(type)) {
    return next(new ApiError("Invalid media type", 400));
  }

  if (type === "image") {
    filename = `gallery-${uuidv4()}-${Date.now()}.jpeg`;

    await sharp(req.file.buffer)
      .resize(800, 800)
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(`uploads/users/gallery/${filename}`);
  } else if (type === "video") {
    // For videos, we'll just save the uploaded file
    // In a real app, you'd want to process videos too
    filename = `gallery-${uuidv4()}-${Date.now()}${req.file.originalname.substring(
      req.file.originalname.lastIndexOf(".")
    )}`;

    // For now, just save the file as-is
    fs.writeFileSync(
      `uploads/users/gallery/${filename}`,
      req.file.buffer
    );
  }

  const galleryItem = {
    type,
    url: filename,
    caption: caption || "",
    createdAt: new Date(),
  };

  // If this is the first item, make it primary
  if (!user.gallery || user.gallery.length === 0) {
    galleryItem.isPrimary = true;
  }

  user.gallery.push(galleryItem);
  await user.save();

  res.status(201).json({
    message: "Item added to gallery successfully",
    data: galleryItem,
  });
});

// @desc    Get user gallery
// @route   GET /api/v1/users/:userId/gallery
// @access  Private/Protect (friends or self)
exports.getUserGallery = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const user = await User.findById(userId).select("gallery friends");

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const requesterId = req.user._id.toString();
  const isFriend =
    requesterId === userId ||
    user.friends.some((friend) => {
      const friendId =
        friend && typeof friend === "object" && friend._id
          ? friend._id.toString()
          : friend.toString();
      return friendId === requesterId;
    });

  if (!isFriend) {
    return next(new ApiError("Gallery is available for friends only", 403));
  }

  // Sort gallery by creation date (newest first)
  const gallery = user.gallery.sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.status(200).json({
    results: gallery.length,
    data: gallery,
  });
});

// @desc    Update gallery item
// @route   PUT /api/v1/users/gallery/:itemId
// @access  Private/Protect (user himself)
exports.updateGalleryItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;
  const { caption } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("Gallery item not found", 404));
  }

  if (caption !== undefined) {
    galleryItem.caption = caption;
  }

  await user.save();

  res.status(200).json({
    message: "Gallery item updated successfully",
    data: galleryItem,
  });
});

// @desc    Set primary gallery item
// @route   PUT /api/v1/users/gallery/:itemId/primary
// @access  Private/Protect (user himself)
exports.setPrimaryGalleryItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;

  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("Gallery item not found", 404));
  }

  // Remove primary from all items
  user.gallery.forEach((item) => {
    item.isPrimary = false;
  });

  // Set this item as primary
  galleryItem.isPrimary = true;

  await user.save();

  res.status(200).json({
    message: "Primary gallery item set successfully",
    data: galleryItem,
  });
});

// @desc    Delete gallery item
// @route   DELETE /api/v1/users/gallery/:itemId
// @access  Private/Protect (user himself)
exports.deleteGalleryItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;

  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("Gallery item not found", 404));
  }

  // Remove the file from filesystem

  const filePath = path.join("uploads/users/gallery", galleryItem.url);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.log("Error deleting file:", error);
  }

  // Remove from gallery array
  user.gallery.pull(itemId);

  // If this was the primary item, set another one as primary
  if (galleryItem.isPrimary && user.gallery.length > 0) {
    user.gallery[0].isPrimary = true;
  }

  await user.save();

  res.status(200).json({
    message: "Gallery item deleted successfully",
  });
});

// @desc    Get user profile with gallery and about
// @route   GET /api/v1/users/:userId/profile
// @access  Private/Protect
exports.getUserProfile = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const user = await User.findOne({
    _id: userId,
    // Only allow viewing profiles of subscribed users (no end date = active)
    isSubscribed: true,
    $or: [
      { subscriptionEndDate: { $gt: new Date() } },
      { subscriptionEndDate: null },
      { subscriptionEndDate: { $exists: false } },
    ],
  })
    .select(
      "name username age gender bio about profileImg coverImg gallery country city nationality " +
        "educationalLevel fieldOfWork socialStatus religion hijab havingChildren desire polygamy smoking " +
        "hairColor height weight bodyShape isOnline lastSeen friends profileViews likesReceived blockedUsers " +
        "isSubscribed identityVerified createdAt"
    )
    .populate("friends", "name profileImg isOnline");

  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // إذا حظرك صاحب البروفيل فلا يمكنك مشاهدته
  const blockedIds = (user.blockedUsers || []).map((id) => id.toString());
  if (blockedIds.includes(req.user._id.toString())) {
    return next(new ApiError("لا يمكنك مشاهدة هذا البروفيل", 403));
  }

  // Sort gallery by primary first, then by creation date
  const sortedGallery = user.gallery.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const profileData = {
    ...user.toObject(),
    gallery: sortedGallery,
    friendsCount: user.friends.length,
  };

  // When friends are populated, each friend is an object with _id; when not, it's ObjectId
  const friendIds = (user.friends || []).map((f) => {
    if (f && typeof f === "object" && f._id) return f._id.toString();
    return f && f.toString ? f.toString() : "";
  });
  const isFriend =
    req.user._id.toString() === userId ||
    friendIds.includes(req.user._id.toString());

  if (req.user._id.toString() !== userId && !isFriend) {
    profileData.profileImg = null;
    profileData.coverImg = null;
    profileData.gallery = [];
    profileData.bio = null;
    profileData.about = null;
    profileData.location = null;
    profileData.country = null;
    profileData.city = null;
    profileData.nationality = null;
    profileData.educationalLevel = null;
    profileData.fieldOfWork = null;
    profileData.socialStatus = null;
    profileData.religion = null;
    profileData.hairColor = null;
    profileData.height = null;
    profileData.weight = null;
    profileData.hijab = null;
    profileData.havingChildren = null;
    profileData.desire = null;
    profileData.polygamy = null;
    profileData.smoking = null;
  }

  profileData.isFriend = isFriend;

  // إشعار زيارة البروفايل: عندما يشاهد أحدهم بروفايلك (غير نفسك)
  if (req.user._id.toString() !== userId) {
    createProfileViewNotification(req.user._id, userId).catch(() => {});
  }

  res.status(200).json({
    data: profileData,
  });
});

// @desc    Get all user profiles (with optional search/filter)
// @route   GET /api/v1/users/profiles?search=...
// @access  Private/Protect
exports.getAllProfiles = asyncHandler(async (req, res, next) => {
  const currentGender = req.user ? req.user.gender : undefined;
  let targetGender;
  if (currentGender === "male") {
    targetGender = "female";
  } else if (currentGender === "female") {
    targetGender = "male";
  }

  // Only show profiles of users with active subscription and opposite gender
  const filter = {
    isSubscribed: true,
    _id: { $ne: req.user._id },
    $or: [
      { subscriptionEndDate: { $gt: new Date() } },
      { subscriptionEndDate: null },
      { subscriptionEndDate: { $exists: false } },
    ],
  };
  if (targetGender) {
    filter.gender = targetGender;
  }

  // فلترة بالبحث: مدينة، دولة، اسم، اسم حساب، مجال عمل، نبذة، أو وصف عام
  const searchTerm = (req.query.search && typeof req.query.search === "string")
    ? req.query.search.trim()
    : "";
  if (searchTerm.length > 0) {
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    const searchCondition = {
      $or: [
        { name: { $regex: searchRegex } },
        { username: { $regex: searchRegex } },
        { city: { $regex: searchRegex } },
        { country: { $regex: searchRegex } },
        { nationality: { $regex: searchRegex } },
        { fieldOfWork: { $regex: searchRegex } },
        { about: { $regex: searchRegex } },
      ],
    };
    filter.$and = filter.$and ? [...filter.$and, searchCondition] : [searchCondition];
  }

  // فلاتر إضافية: مدينة، عمر، طول، لون شعر، دين، جنسية
  const city = (req.query.city && typeof req.query.city === "string") ? req.query.city.trim() : "";
  if (city.length > 0) {
    const cityRegex = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.city = { $regex: cityRegex };
  }
  const country = (req.query.country && typeof req.query.country === "string") ? req.query.country.trim() : "";
  if (country.length > 0) {
    const countryRegex = new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.country = { $regex: countryRegex };
  }
  const nationality = (req.query.nationality && typeof req.query.nationality === "string") ? req.query.nationality.trim() : "";
  if (nationality.length > 0) {
    const nationalityRegex = new RegExp(nationality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.nationality = { $regex: nationalityRegex };
  }
  const ageMin = req.query.ageMin != null ? parseInt(req.query.ageMin, 10) : NaN;
  const ageMax = req.query.ageMax != null ? parseInt(req.query.ageMax, 10) : NaN;
  if (!Number.isNaN(ageMin) && ageMin >= 18) {
    filter.age = filter.age || {};
    filter.age.$gte = ageMin;
  }
  if (!Number.isNaN(ageMax) && ageMax >= 18) {
    filter.age = filter.age || {};
    filter.age.$lte = ageMax;
  }
  const heightMin = req.query.heightMin != null ? parseInt(req.query.heightMin, 10) : NaN;
  const heightMax = req.query.heightMax != null ? parseInt(req.query.heightMax, 10) : NaN;
  if (!Number.isNaN(heightMin) && heightMin >= 100) {
    filter.height = filter.height || {};
    filter.height.$gte = heightMin;
  }
  if (!Number.isNaN(heightMax) && heightMax <= 250) {
    filter.height = filter.height || {};
    filter.height.$lte = heightMax;
  }
  const hairColor = (req.query.hairColor && typeof req.query.hairColor === "string") ? req.query.hairColor.trim() : "";
  if (hairColor.length > 0) {
    const hairRegex = new RegExp(hairColor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.hairColor = { $regex: hairRegex };
  }
  const religion = (req.query.religion && typeof req.query.religion === "string") ? req.query.religion.trim() : "";
  if (religion.length > 0) {
    const religionRegex = new RegExp(religion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.religion = { $regex: religionRegex };
  }

  const currentUser = await User.findById(req.user._id).select("friends");
  const friendIds = currentUser
    ? currentUser.friends.map((id) => id.toString())
    : [];

  const users = await User.find(filter)
    .select(
      "name age gender bio city country nationality profileImg coverImg gallery about isOnline lastSeen profileViews friends isSubscribed identityVerified height hairColor religion"
    )
    .sort({ createdAt: -1 });

  // Process each user profile
  const profiles = users.map((user) => {
    // Sort gallery by primary first, then by creation date
    const sortedGallery = user.gallery.sort((a, b) => {
      if (a.isPrimary && !b.isPrimary) return -1;
      if (!a.isPrimary && b.isPrimary) return 1;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });

    const userId = user._id.toString();
    const isFriend = friendIds.includes(userId);

    const profileData = {
      ...user.toObject(),
      gallery: sortedGallery,
      isFriend,
    };

    if (isFriend) {
      return null;
    }
    profileData.gallery = [];

    return profileData;
  });

  const filteredProfiles = profiles.filter(Boolean);

  res.status(200).json({
    results: filteredProfiles.length,
    data: filteredProfiles,
  });
});