const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const IdentityVerification = require("../models/identityVerificationModel");
const User = require("../models/userModel");
const Notification = require("../models/notificationModel");

// @desc    Submit identity verification request
// @route   POST /api/v1/verification/submit
// @access  Private/Protect
exports.submitIdentityVerification = asyncHandler(async (req, res, next) => {
  const { documents, adminType } = req.body;
  const userId = req.user._id;

  // Check if user is subscribed (required for verification)
  const user = await User.findById(userId);
  if (!user.isSubscribed) {
    return next(
      new ApiError(
        "You must be subscribed to submit identity verification",
        403
      )
    );
  }

  // Validate admin type based on user's gender
  if (adminType !== user.gender) {
    return next(
      new ApiError(
        `You can only submit verification to ${user.gender} admin`,
        400
      )
    );
  }

  // Check if user already has a pending verification
  const existingPending = await IdentityVerification.findOne({
    user: userId,
    status: "pending",
  });

  if (existingPending) {
    return next(
      new ApiError("You already have a pending verification request", 400)
    );
  }

  // Check if user is already verified
  if (user.identityVerified) {
    return next(new ApiError("Your identity is already verified", 400));
  }

  // Validate documents
  if (!documents || documents.length === 0) {
    return next(new ApiError("At least one document is required", 400));
  }

  // Create verification request
  const verificationRequest = await IdentityVerification.create({
    user: userId,
    adminType,
    documents,
  });

  // Update user status
  await User.findByIdAndUpdate(userId, {
    identityVerificationStatus: "pending",
    identityVerificationSubmitted: true,
  });

  res.status(201).json({
    message:
      "Identity verification request submitted successfully. Please wait for admin review.",
    data: verificationRequest,
  });
});

// @desc    Get user's verification status
// @route   GET /api/v1/verification/status
// @access  Private/Protect
exports.getUserVerificationStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId).select(
    "identityVerified identityVerificationStatus identityVerificationSubmitted"
  );

  const verificationRequest = await IdentityVerification.findOne({
    user: userId,
    status: { $in: ["pending", "approved"] },
  })
    .populate("reviewedBy", "name email adminType")
    .sort({ createdAt: -1 });

  res.status(200).json({
    data: {
      identityVerified: user.identityVerified,
      verificationStatus: user.identityVerificationStatus,
      verificationSubmitted: user.identityVerificationSubmitted,
      currentRequest: verificationRequest,
    },
  });
});

// @desc    Get pending verification requests (Admin only)
// @route   GET /api/v1/verification/requests
// @access  Private/Admin
exports.getPendingVerificationRequests = asyncHandler(async (req, res) => {
  const { adminType } = req.admin;

  // Super admin can see all, others only their gender type
  const filter = { status: "pending" };
  if (adminType !== "super") {
    filter.adminType = adminType;
  }

  const features = new ApiFeatures(
    IdentityVerification.find(filter).sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const requests = await features.query;

  res.status(200).json({
    results: requests.length,
    data: requests,
  });
});

// @desc    Review verification request (Admin only)
// @route   PUT /api/v1/verification/requests/:id/review
// @access  Private/Admin
exports.reviewVerificationRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { action, reviewNotes, rejectionReason } = req.body;
  const { _id: adminId, adminType } = req.admin;

  if (!["approve", "reject"].includes(action)) {
    return next(new ApiError("Action must be either approve or reject", 400));
  }

  const verificationRequest = await IdentityVerification.findById(id).populate(
    "user"
  );
  if (!verificationRequest) {
    return next(new ApiError("Verification request not found", 404));
  }

  if (verificationRequest.status !== "pending") {
    return next(new ApiError("Request has already been reviewed", 400));
  }

  // Check if admin has permission for this request type
  if (adminType !== "super" && verificationRequest.adminType !== adminType) {
    return next(
      new ApiError(
        "You can only review requests assigned to your admin type",
        403
      )
    );
  }

  const userId = verificationRequest.user._id;

  if (action === "approve") {
    // Update verification request
    verificationRequest.status = "approved";
    verificationRequest.reviewedBy = adminId;
    verificationRequest.reviewNotes = reviewNotes;
    verificationRequest.reviewedAt = new Date();
    await verificationRequest.save();

    // Update user status
    await User.findByIdAndUpdate(userId, {
      identityVerified: true,
      identityVerificationStatus: "approved",
    });

    // Create notification for user
    await Notification.createNotification({
      user: userId,
      type: "identity_verification_approved",
      title: "Identity Verification Approved",
      message: "Your identity has been verified successfully!",
      data: { verificationId: id },
    });

    // Send real-time notification
    if (req.app && req.app.get("io")) {
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers") || new Map();
      const socketId = onlineUsers.get(userId.toString());

      if (socketId) {
        io.to(socketId).emit("notification", {
          type: "identity_verification_approved",
          title: "Identity Verification Approved",
          message: "Your identity has been verified successfully!",
          verificationId: id,
        });
      }
    }

    res.status(200).json({
      message: "Identity verification approved successfully",
      data: verificationRequest,
    });
  } else {
    // Reject verification
    if (!rejectionReason) {
      return next(new ApiError("Rejection reason is required", 400));
    }

    verificationRequest.status = "rejected";
    verificationRequest.reviewedBy = adminId;
    verificationRequest.reviewNotes = reviewNotes;
    verificationRequest.rejectionReason = rejectionReason;
    verificationRequest.reviewedAt = new Date();
    await verificationRequest.save();

    // Update user status
    await User.findByIdAndUpdate(userId, {
      identityVerificationStatus: "rejected",
    });

    // Create notification for user
    await Notification.createNotification({
      user: userId,
      type: "identity_verification_rejected",
      title: "Identity Verification Rejected",
      message: `Your identity verification was rejected: ${rejectionReason}`,
      data: { verificationId: id, reason: rejectionReason },
    });

    // Send real-time notification
    if (req.app && req.app.get("io")) {
      const io = req.app.get("io");
      const onlineUsers = req.app.get("onlineUsers") || new Map();
      const socketId = onlineUsers.get(userId.toString());

      if (socketId) {
        io.to(socketId).emit("notification", {
          type: "identity_verification_rejected",
          title: "Identity Verification Rejected",
          message: `Your identity verification was rejected: ${rejectionReason}`,
          verificationId: id,
          reason: rejectionReason,
        });
      }
    }

    res.status(200).json({
      message: "Identity verification rejected",
      data: verificationRequest,
    });
  }
});

// @desc    Get verification request details (Admin only)
// @route   GET /api/v1/verification/requests/:id
// @access  Private/Admin
exports.getVerificationRequestDetails = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { adminType } = req.admin;

  const verificationRequest = await IdentityVerification.findById(id)
    .populate("user", "name email phone gender profileImg")
    .populate("reviewedBy", "name email adminType");

  if (!verificationRequest) {
    return next(new ApiError("Verification request not found", 404));
  }

  // Check if admin has permission
  if (adminType !== "super" && verificationRequest.adminType !== adminType) {
    return next(
      new ApiError("You don't have permission to view this request", 403)
    );
  }

  res.status(200).json({
    data: verificationRequest,
  });
});

// @desc    Get verification history for user
// @route   GET /api/v1/verification/history
// @access  Private/Protect
exports.getUserVerificationHistory = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const history = await IdentityVerification.find({ user: userId })
    .populate("reviewedBy", "name email adminType")
    .sort({ createdAt: -1 });

  res.status(200).json({
    results: history.length,
    data: history,
  });
});

// @desc    Get verification statistics (Admin only)
// @route   GET /api/v1/verification/stats
// @access  Private/Admin
exports.getVerificationStats = asyncHandler(async (req, res) => {
  const { adminType } = req.admin;

  // Filter by admin type if not super admin
  const matchFilter = adminType === "super" ? {} : { adminType };

  const stats = await IdentityVerification.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const totalRequests = await IdentityVerification.countDocuments(matchFilter);
  const pendingRequests = await IdentityVerification.countDocuments({
    ...matchFilter,
    status: "pending",
  });
  const approvedRequests = await IdentityVerification.countDocuments({
    ...matchFilter,
    status: "approved",
  });
  const rejectedRequests = await IdentityVerification.countDocuments({
    ...matchFilter,
    status: "rejected",
  });

  // Recent activity (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentActivity = await IdentityVerification.find({
    ...matchFilter,
    createdAt: { $gte: thirtyDaysAgo },
  }).countDocuments();

  res.status(200).json({
    data: {
      total: totalRequests,
      pending: pendingRequests,
      approved: approvedRequests,
      rejected: rejectedRequests,
      recentActivity,
      breakdown: stats,
    },
  });
});
