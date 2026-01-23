const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const Guardian = require("../models/guardianModel");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");
const {
  generateGuardianQRData,
  verifyGuardianQRData,
} = require("../utils/qrCodeGenerator");

// @desc    Add a new guardian for a user
// @route   POST /api/v1/guardians
// @access  Private/Protect
exports.addGuardian = asyncHandler(async (req, res, next) => {
  const {
    relationship,
    firstName,
    lastName,
    phone,
    email,
    dateOfBirth,
    identityDocuments,
  } = req.body;
  const userId = req.user._id;

  // Check if user is subscribed (required for adding guardians)
  const user = await User.findById(userId);
  if (!user.isSubscribed) {
    return next(new ApiError("You must be subscribed to add guardians", 403));
  }

  // Check if relationship already exists for this user
  const existingGuardian = await Guardian.findOne({
    user: userId,
    relationship,
    isActive: true,
  });

  if (existingGuardian) {
    return next(new ApiError(`You already have a ${relationship} added`, 400));
  }

  // Check if phone number is already used
  const phoneExists = await Guardian.findOne({
    phone,
    isActive: true,
  });

  if (phoneExists) {
    return next(new ApiError("Phone number is already registered", 400));
  }

  // Create guardian
  const guardian = await Guardian.create({
    user: userId,
    relationship,
    firstName,
    lastName,
    phone,
    email,
    dateOfBirth,
    identityDocuments,
  });

  // Add guardian to user's guardians list
  await User.findByIdAndUpdate(userId, {
    $push: { guardians: guardian._id },
  });

  // Populate guardian data
  await guardian.populate("user", "name email");

  res.status(201).json({
    message:
      "Guardian added successfully. Please wait for identity verification.",
    data: guardian,
  });
});

// @desc    Get user's guardians
// @route   GET /api/v1/guardians
// @access  Private/Protect
exports.getUserGuardians = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const guardians = await Guardian.find({
    user: userId,
    isActive: true,
  }).sort({ createdAt: -1 });

  res.status(200).json({
    results: guardians.length,
    data: guardians,
  });
});

// @desc    Update guardian information
// @route   PUT /api/v1/guardians/:id
// @access  Private/Protect
exports.updateGuardian = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { firstName, lastName, phone, email, emergencyContact } = req.body;
  const userId = req.user._id;

  const guardian = await Guardian.findOne({
    _id: id,
    user: userId,
    isActive: true,
  });

  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  // Check if phone is being changed and if it's already used
  if (phone && phone !== guardian.phone) {
    const phoneExists = await Guardian.findOne({
      phone,
      isActive: true,
      _id: { $ne: id },
    });

    if (phoneExists) {
      return next(new ApiError("Phone number is already registered", 400));
    }
  }

  // Update fields
  if (firstName) guardian.firstName = firstName;
  if (lastName) guardian.lastName = lastName;
  if (phone) guardian.phone = phone;
  if (email !== undefined) guardian.email = email;
  if (emergencyContact) guardian.emergencyContact = emergencyContact;

  await guardian.save();

  res.status(200).json({
    message: "Guardian updated successfully",
    data: guardian,
  });
});

// @desc    Remove guardian
// @route   DELETE /api/v1/guardians/:id
// @access  Private/Protect
exports.removeGuardian = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const guardian = await Guardian.findOne({
    _id: id,
    user: userId,
    isActive: true,
  });

  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  // Deactivate guardian instead of deleting
  guardian.isActive = false;
  await guardian.save();

  // Remove from user's guardians list
  await User.findByIdAndUpdate(userId, {
    $pull: { guardians: id },
  });

  // Remove guardian from any chats they were part of
  await Chat.updateMany(
    { guardians: id },
    { $pull: { guardians: id, participants: id } }
  );

  res.status(200).json({
    message: "Guardian removed successfully",
  });
});

// @desc    Upload guardian identity documents
// @route   POST /api/v1/guardians/:id/documents
// @access  Private/Protect
exports.uploadGuardianDocuments = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const guardian = await Guardian.findOne({
    _id: id,
    user: userId,
    isActive: true,
  });

  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  if (!req.files || req.files.length === 0) {
    return next(new ApiError("No files uploaded", 400));
  }

  // Process uploaded files
  const documents = req.files.map((file, index) => ({
    type: req.body.documentTypes[index] || "id_card",
    url: file.filename,
    uploadedAt: new Date(),
  }));

  // Reset verification status when new documents are uploaded
  guardian.identityDocuments = documents;
  guardian.identityVerified = false;
  guardian.verificationStatus = "pending";
  guardian.verifiedBy = undefined;
  guardian.verifiedAt = undefined;

  await guardian.save();

  res.status(200).json({
    message:
      "Documents uploaded successfully. Verification process will begin.",
    data: guardian,
  });
});

// @desc    Get guardian QR code
// @route   GET /api/v1/guardians/:id/qr-code
// @access  Private/Protect
exports.getGuardianQRCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const guardian = await Guardian.findOne({
    _id: id,
    user: userId,
    isActive: true,
    identityVerified: true,
  });

  if (!guardian) {
    return next(new ApiError("Guardian not found or not verified", 404));
  }

  // Generate QR code data
  const qrData = generateGuardianQRData(guardian._id, guardian.qrCode);

  res.status(200).json({
    data: {
      guardianId: guardian._id,
      qrCode: guardian.qrCode,
      qrData,
      expiresAt: guardian.qrCodeExpiresAt,
    },
  });
});

// @desc    Regenerate guardian QR code
// @route   POST /api/v1/guardians/:id/regenerate-qr
// @access  Private/Protect
exports.regenerateGuardianQRCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const guardian = await Guardian.findOne({
    _id: id,
    user: userId,
    isActive: true,
  });

  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  // Generate new QR code
  const crypto = require("crypto");
  let newQRCode;
  let existingCode;

  do {
    newQRCode = crypto.randomBytes(16).toString("hex").toUpperCase();
    existingCode = await Guardian.findOne({ qrCode: newQRCode });
  } while (existingCode);

  guardian.qrCode = newQRCode;
  guardian.qrCodeExpiresAt = new Date();
  guardian.qrCodeExpiresAt.setFullYear(
    guardian.qrCodeExpiresAt.getFullYear() + 1
  );

  await guardian.save();

  const qrData = generateGuardianQRData(guardian._id, guardian.qrCode);

  res.status(200).json({
    message: "QR code regenerated successfully",
    data: {
      guardianId: guardian._id,
      qrCode: guardian.qrCode,
      qrData,
      expiresAt: guardian.qrCodeExpiresAt,
    },
  });
});

// @desc    Access chat using guardian QR code
// @route   POST /api/v1/guardians/access-chat
// @access  Public (but requires valid QR code)
exports.accessChatWithQRCode = asyncHandler(async (req, res, next) => {
  const { qrData, chatId } = req.body;

  if (!qrData || !chatId) {
    return next(new ApiError("QR data and chat ID are required", 400));
  }

  // Parse QR data
  let parsedData;
  try {
    parsedData = JSON.parse(qrData);
  } catch (error) {
    return next(new ApiError("Invalid QR code data", 400));
  }

  const { guardianId, qrCode } = parsedData;

  // Find guardian
  const guardian = await Guardian.findById(guardianId);
  if (!guardian || !guardian.isActive) {
    return next(new ApiError("Guardian not found", 404));
  }

  // Verify QR code
  if (!guardian.isQRCodeValid() || guardian.qrCode !== qrCode) {
    return next(new ApiError("Invalid or expired QR code", 400));
  }

  // Check if guardian has access to this chat
  const chat = await Chat.findOne({
    _id: chatId,
    guardians: guardianId,
    isActive: true,
  });

  if (!chat) {
    return next(new ApiError("Chat not found or access denied", 404));
  }

  // Log access
  await guardian.logAccess();

  // Return chat access token or session
  // For now, return chat details
  await chat.populate([
    {
      path: "participants",
      select: "name profileImg isOnline lastSeen",
    },
    {
      path: "guardians",
      select: "firstName lastName relationship",
    },
  ]);

  res.status(200).json({
    message: "Chat access granted",
    data: {
      chat,
      guardian: {
        id: guardian._id,
        name: `${guardian.firstName} ${guardian.lastName}`,
        relationship: guardian.relationship,
      },
    },
  });
});

// @desc    Get pending guardian verifications (Admin only)
// @route   GET /api/v1/guardians/verifications
// @access  Private/Admin
exports.getPendingGuardianVerifications = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    Guardian.find({ verificationStatus: "pending", isActive: true }).sort({
      createdAt: -1,
    }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const guardians = await features.mongooseQuery;

  res.status(200).json({
    results: guardians.length,
    data: guardians,
  });
});

// @desc    Review guardian verification (Admin only)
// @route   PUT /api/v1/guardians/:id/verify
// @access  Private/Admin
exports.reviewGuardianVerification = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, reviewNotes, rejectionReason } = req.body;
  const adminId = req.admin._id;

  if (!["approve", "reject"].includes(action)) {
    return next(new ApiError("Action must be either approve or reject", 400));
  }

  const guardian = await Guardian.findById(id).populate("user", "name email");
  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  if (guardian.verificationStatus !== "pending") {
    return next(
      new ApiError("Guardian verification has already been reviewed", 400)
    );
  }

  if (action === "approve") {
    guardian.verificationStatus = "approved";
    guardian.identityVerified = true;
    guardian.verifiedBy = adminId;
    guardian.verifiedAt = new Date();
    guardian.canAccessChats = true;
    guardian.reviewNotes = reviewNotes;

    await guardian.save();

    res.status(200).json({
      message: "Guardian verification approved successfully",
      data: guardian,
    });
  } else {
    if (!rejectionReason) {
      return next(new ApiError("Rejection reason is required", 400));
    }

    guardian.verificationStatus = "rejected";
    guardian.verifiedBy = adminId;
    guardian.verifiedAt = new Date();
    guardian.rejectionReason = rejectionReason;
    guardian.reviewNotes = reviewNotes;

    await guardian.save();

    res.status(200).json({
      message: "Guardian verification rejected",
      data: guardian,
    });
  }
});

// @desc    Get guardian details (Admin only)
// @route   GET /api/v1/guardians/admin/:id/details
// @access  Private/Admin
exports.getGuardianDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const guardian = await Guardian.findById(id);
  if (!guardian) {
    return next(new ApiError("Guardian not found", 404));
  }

  res.status(200).json({
    data: guardian,
  });
});

// @desc    Get guardian statistics (Admin only)
// @route   GET /api/v1/guardians/stats
// @access  Private/Admin
exports.getGuardianStats = asyncHandler(async (req, res) => {
  const totalGuardians = await Guardian.countDocuments({ isActive: true });
  const verifiedGuardians = await Guardian.countDocuments({
    isActive: true,
    identityVerified: true,
  });
  const pendingVerifications = await Guardian.countDocuments({
    isActive: true,
    verificationStatus: "pending",
  });
  const rejectedVerifications = await Guardian.countDocuments({
    isActive: true,
    verificationStatus: "rejected",
  });

  // Relationship breakdown
  const relationshipStats = await Guardian.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$relationship", count: { $sum: 1 } } },
  ]);

  res.status(200).json({
    data: {
      total: totalGuardians,
      verified: verifiedGuardians,
      pending: pendingVerifications,
      rejected: rejectedVerifications,
      relationships: relationshipStats,
    },
  });
});
