const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");
const GalleryViewRequest = require("../models/galleryViewRequestModel");
const { createProfileViewNotification } = require("./notificationService");

// @desc    Update user about section
// @route   PUT /api/v1/users/about
// @access  Private/Protect (user himself)
exports.updateAbout = asyncHandler(async (req, res, next) => {
  const { about } = req.body;

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { about },
    { new: true, runValidators: true },
  ).select("about");

  if (!user) {
    return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
  }

  res.status(200).json({
    message: "تم تحديث قسم المعلومات بنجاح",
    data: user,
  });
});

// @desc    Add item to user gallery
// @route   POST /api/v1/users/gallery
// @access  Private/Protect (user himself)
exports.addToGallery = asyncHandler(async (req, res, next) => {
  const { caption, type = "image" } = req.body;

  if (!req.file) {
    return next(new ApiError("يجب أن يتم توفير الملف", 400));
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
  }

  // Limit gallery to 20 items
  if (user.gallery && user.gallery.length >= 20) {
    return next(new ApiError("المعرض ممتلئ (الحد الأقصى 20 عنصر)", 400));
  }

  let filename;
  const allowedTypes = ["image", "video"];

  if (!allowedTypes.includes(type)) {
    return next(new ApiError("نوع الوسائط غير صالح", 400));
  }

  if (type === "image") {
    filename = `gallery-${uuidv4()}-${Date.now()}.jpeg`;

    // حفظ الصورة كاملة بدون قص: تقليص داخل إطار أقصى 1200x1200 مع الحفاظ على النسبة
    await sharp(req.file.buffer)
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .toFormat("jpeg")
      .jpeg({ quality: 90 })
      .toFile(`uploads/users/gallery/${filename}`);
  } else if (type === "video") {
    // For videos, we'll just save the uploaded file
    // In a real app, you'd want to process videos too
    filename = `gallery-${uuidv4()}-${Date.now()}${req.file.originalname.substring(
      req.file.originalname.lastIndexOf("."),
    )}`;

    // For now, just save the file as-is
    fs.writeFileSync(`uploads/users/gallery/${filename}`, req.file.buffer);
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
    message: "تم إضافة العنصر إلى المعرض بنجاح",
    data: galleryItem,
  });
});

// @desc    Get user gallery (returns metadata only for others, full data for self)
// @route   GET /api/v1/profile/:userId/gallery
// @access  Private
exports.getUserGallery = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const user = await User.findById(userId).select("gallery");

  if (!user) {
    return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
  }

  const requesterId = req.user._id.toString();
  const isSelf = requesterId === userId;

  const sorted = user.gallery.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  if (isSelf) {
    return res.status(200).json({ results: sorted.length, data: sorted });
  }

  const grants = await GalleryViewRequest.find({
    ownerId: userId,
    requesterId: req.user._id,
  }).select("galleryItemId status usedAt");

  const grantMap = {};
  for (const g of grants) {
    const key = g.galleryItemId;
    if (!grantMap[key]) grantMap[key] = [];
    grantMap[key].push(g);
  }

  const gallery = sorted.map((item) => {
    const itemId = item._id.toString();
    const itemGrants = grantMap[itemId] || [];
    const hasPending = itemGrants.some((g) => g.status === "pending");
    const hasUnused = itemGrants.some(
      (g) => g.status === "accepted" && g.usedAt === null,
    );

    let accessStatus = "locked";
    if (hasUnused) accessStatus = "granted";
    else if (hasPending) accessStatus = "pending";

    return {
      _id: item._id,
      type: item.type,
      isPrimary: item.isPrimary,
      caption: item.caption,
      createdAt: item.createdAt,
      accessStatus,
    };
  });

  res.status(200).json({ results: gallery.length, data: gallery });
});

// @desc    View a single gallery item (consumes the one-time grant)
// @route   GET /api/v1/profile/:userId/gallery/:itemId/view
// @access  Private
exports.viewGalleryItem = asyncHandler(async (req, res, next) => {
  const { userId, itemId } = req.params;
  const requesterId = req.user._id.toString();

  if (requesterId === userId) {
    const user = await User.findById(userId).select("gallery");
    if (!user) return next(new ApiError("المستخدم غير موجود", 404));
    const item = user.gallery.id(itemId);
    if (!item) return next(new ApiError("عنصر المعرض غير موجود", 404));
    return res.status(200).json({ data: { url: item.url } });
  }

  const grant = await GalleryViewRequest.findOne({
    ownerId: userId,
    requesterId: req.user._id,
    galleryItemId: itemId,
    status: "accepted",
    usedAt: null,
  });

  if (!grant) {
    return next(new ApiError("لا توجد صلاحية صالحة لهذه الصورة", 403));
  }

  grant.usedAt = new Date();
  await grant.save();

  const user = await User.findById(userId).select("gallery");
  if (!user) return next(new ApiError("المستخدم غير موجود", 404));

  const item = user.gallery.id(itemId);
  if (!item) return next(new ApiError("عنصر المعرض غير موجود", 404));

  res.status(200).json({ data: { url: item.url } });
});

// @desc    Update gallery item
// @route   PUT /api/v1/users/gallery/:itemId
// @access  Private/Protect (user himself)
exports.updateGalleryItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.params;
  const { caption } = req.body;

  const user = await User.findById(req.user._id);

  if (!user) {
    return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("عنصر المعرض غير موجود", 404));
  }

  if (caption !== undefined) {
    galleryItem.caption = caption;
  }

  await user.save();

  res.status(200).json({
    message: "تم تحديث عنصر المعرض بنجاح",
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
    return next(new ApiError("المستخدم غير موجود", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("عنصر المعرض غير موجود", 404));
  }

  // Remove primary from all items
  user.gallery.forEach((item) => {
    item.isPrimary = false;
  });

  // Set this item as primary
  galleryItem.isPrimary = true;

  await user.save();

  res.status(200).json({
    message: "تم تعيين العنصر الأساسي بنجاح",
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
    return next(new ApiError("المستخدم غير موجود", 404));
  }

  const galleryItem = user.gallery.id(itemId);

  if (!galleryItem) {
    return next(new ApiError("عنصر المعرض غير موجود", 404));
  }

  // Remove the file from filesystem

  const filePath = path.join("uploads/users/gallery", galleryItem.url);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.log("خطأ في حذف الملف:", error);
  }

  // Remove from gallery array
  user.gallery.pull(itemId);

  // If this was the primary item, set another one as primary
  if (galleryItem.isPrimary && user.gallery.length > 0) {
    user.gallery[0].isPrimary = true;
  }

  await user.save();

  res.status(200).json({
    message: "تم حذف عنصر المعرض بنجاح",
  });
});

// @desc    Get user profile with gallery and about
// @route   GET /api/v1/users/:userId/profile
// @access  Private/Protect
exports.getUserProfile = asyncHandler(async (req, res, next) => {
  const { userId } = req.params;

  const user = await User.findById(userId)
    .select(
      "name username age gender bio about profileImg coverImg gallery country city nationality " +
        "educationalLevel fieldOfWork socialStatus religion hijab havingChildren desire polygamy smoking " +
        "hairColor height weight bodyShape isOnline lastSeen friends profileViews likesReceived blockedUsers " +
        "isSubscribed subscriptionEndDate identityVerified createdAt",
    )
    .populate("friends", "name profileImg isOnline");

  if (!user) {
    return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
  }

  // إذا حظرك صاحب البروفيل فلا يمكنك مشاهدته
  const blockedIds = (user.blockedUsers || []).map((id) => id.toString());
  if (blockedIds.includes(req.user._id.toString())) {
    return next(new ApiError("لا يمكنك مشاهدة هذا البروفيل", 403));
  }

  const sortedGallery = user.gallery.sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const profileData = {
    ...user.toObject(),
    friendsCount: user.friends.length,
  };

  const friendIds = (user.friends || []).map((f) => {
    if (f && typeof f === "object" && f._id) return f._id.toString();
    return f && f.toString ? f.toString() : "";
  });
  const isSelf = req.user._id.toString() === userId;
  const isFriend = isSelf || friendIds.includes(req.user._id.toString());
  const hasActiveSubscription =
    user.isSubscribed === true &&
    (!user.subscriptionEndDate || user.subscriptionEndDate > new Date());

  // السماح دائماً لصاحب الحساب وصديقه، حتى لو الاشتراك منتهي.
  // لغير الأصدقاء: يلزم اشتراك نشط لمشاهدة الملف.
  if (!hasActiveSubscription && !isFriend) {
    return next(new ApiError("لا يمكنك مشاهدة هذا البروفيل", 403));
  }

  if (isSelf) {
    profileData.gallery = sortedGallery;
  } else {
    profileData.gallery = sortedGallery.map((item) => ({
      _id: item._id,
      type: item.type,
      isPrimary: item.isPrimary,
      caption: item.caption,
      createdAt: item.createdAt,
    }));
  }

  profileData.isFriend = isFriend;

  // إشعار زيارة البروفايل: فقط عندما يشاهد بروفايلك شخص غير صديق (وليس نفسك)
  if (req.user._id.toString() !== userId && !isFriend) {
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

  // فلترة بالبحث: نفس حقول الفلتر النصية (اسم، مدينة، دولة، جنسية، مجال عمل، نبذة، لون شعر، دين)
  const searchTerm =
    req.query.search && typeof req.query.search === "string"
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
        { hairColor: { $regex: searchRegex } },
        { religion: { $regex: searchRegex } },
      ],
    };
    filter.$and = filter.$and
      ? [...filter.$and, searchCondition]
      : [searchCondition];
  }

  // فلاتر إضافية: مدينة، عمر، طول، لون شعر، دين، جنسية
  const city =
    req.query.city && typeof req.query.city === "string"
      ? req.query.city.trim()
      : "";
  if (city.length > 0) {
    const cityRegex = new RegExp(
      city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filter.city = { $regex: cityRegex };
  }
  const country =
    req.query.country && typeof req.query.country === "string"
      ? req.query.country.trim()
      : "";
  if (country.length > 0) {
    const countryRegex = new RegExp(
      country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filter.country = { $regex: countryRegex };
  }
  const nationality =
    req.query.nationality && typeof req.query.nationality === "string"
      ? req.query.nationality.trim()
      : "";
  if (nationality.length > 0) {
    const nationalityRegex = new RegExp(
      nationality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filter.nationality = { $regex: nationalityRegex };
  }
  const ageMin =
    req.query.ageMin != null ? parseInt(req.query.ageMin, 10) : NaN;
  const ageMax =
    req.query.ageMax != null ? parseInt(req.query.ageMax, 10) : NaN;
  if (!Number.isNaN(ageMin) && ageMin >= 18) {
    filter.age = filter.age || {};
    filter.age.$gte = ageMin;
  }
  if (!Number.isNaN(ageMax) && ageMax >= 18) {
    filter.age = filter.age || {};
    filter.age.$lte = ageMax;
  }
  const heightMin =
    req.query.heightMin != null ? parseInt(req.query.heightMin, 10) : NaN;
  const heightMax =
    req.query.heightMax != null ? parseInt(req.query.heightMax, 10) : NaN;
  if (!Number.isNaN(heightMin) && heightMin >= 100) {
    filter.height = filter.height || {};
    filter.height.$gte = heightMin;
  }
  if (!Number.isNaN(heightMax) && heightMax <= 250) {
    filter.height = filter.height || {};
    filter.height.$lte = heightMax;
  }
  const hairColor =
    req.query.hairColor && typeof req.query.hairColor === "string"
      ? req.query.hairColor.trim()
      : "";
  if (hairColor.length > 0) {
    const hairRegex = new RegExp(
      hairColor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filter.hairColor = { $regex: hairRegex };
  }
  const religion =
    req.query.religion && typeof req.query.religion === "string"
      ? req.query.religion.trim()
      : "";
  if (religion.length > 0) {
    const religionRegex = new RegExp(
      religion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "i",
    );
    filter.religion = { $regex: religionRegex };
  }

  const currentUser = await User.findById(req.user._id).select("friends");
  const friendIds = currentUser
    ? currentUser.friends.map((id) => id.toString())
    : [];

  const users = await User.find(filter)
    .select(
      "name age gender bio city country nationality profileImg coverImg gallery about isOnline lastSeen profileViews friends isSubscribed identityVerified height hairColor religion",
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

    profileData.gallery = sortedGallery.map((item) => ({
      _id: item._id,
      type: item.type,
      isPrimary: item.isPrimary,
    }));

    if (!isFriend) {
      profileData.coverImg = null;
      profileData.canOpenProfile = false;
    } else {
      profileData.canOpenProfile = true;
    }

    return profileData;
  });

  res.status(200).json({
    results: profiles.length,
    data: profiles,
  });
});
