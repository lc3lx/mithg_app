const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const { createAdminToken } = require("../utils/createToken");

const Admin = require("../models/adminModel");
const User = require("../models/userModel");
const Subscription = require("../models/subscriptionModel");
const PaymentRequest = require("../models/paymentRequestModel");
const SubscriptionCode = require("../models/subscriptionCodeModel");
const IdentityVerification = require("../models/identityVerificationModel");

// @desc    Create new admin (Super admin only)
// @route   POST /api/v1/admins
// @access  Private/SuperAdmin
exports.createAdmin = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, adminType } = req.body;

  // Check if email already exists
  const existingAdmin = await Admin.findOne({ email });
  if (existingAdmin) {
    return next(new ApiError("Admin with this email already exists", 400));
  }

  // Validate admin type
  if (!["male", "female", "super"].includes(adminType)) {
    return next(new ApiError("Invalid admin type", 400));
  }

  // Only super admin can create other super admins
  if (adminType === "super" && req.admin.adminType !== "super") {
    return next(
      new ApiError("Only super admin can create super admin accounts", 403)
    );
  }

  const admin = await Admin.create({
    name,
    email,
    password,
    phone,
    adminType,
  });

  // Remove password from response
  admin.password = undefined;

  res.status(201).json({
    message: "Admin created successfully",
    data: admin,
  });
});

// @desc    Get all admins (Super admin only)
// @route   GET /api/v1/admins
// @access  Private/SuperAdmin
exports.getAdmins = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    Admin.find().select("-password").sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const admins = await features.query;

  res.status(200).json({
    results: admins.length,
    data: admins,
  });
});

// @desc    Update admin (Super admin only or self)
// @route   PUT /api/v1/admins/:id
// @access  Private/Admin
exports.updateAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, email, phone, adminType, isActive, permissions } = req.body;
  const currentAdmin = req.admin;

  // Check if admin exists
  const admin = await Admin.findById(id);
  if (!admin) {
    return next(new ApiError("Admin not found", 404));
  }

  // Only super admin can update admin types and permissions
  if (currentAdmin.adminType !== "super") {
    if (id !== currentAdmin._id.toString()) {
      return next(new ApiError("You can only update your own profile", 403));
    }
    if (adminType || permissions) {
      return next(
        new ApiError("You cannot update admin type or permissions", 403)
      );
    }
  }

  // Update fields
  if (name) admin.name = name;
  if (email) admin.email = email;
  if (phone) admin.phone = phone;
  if (adminType && currentAdmin.adminType === "super")
    admin.adminType = adminType;
  if (isActive !== undefined && currentAdmin.adminType === "super")
    admin.isActive = isActive;
  if (permissions && currentAdmin.adminType === "super")
    admin.permissions = permissions;

  await admin.save();

  // Remove password from response
  admin.password = undefined;

  res.status(200).json({
    message: "Admin updated successfully",
    data: admin,
  });
});

// @desc    Delete admin (Super admin only)
// @route   DELETE /api/v1/admins/:id
// @access  Private/SuperAdmin
exports.deleteAdmin = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Prevent deleting self
  if (id === req.admin._id.toString()) {
    return next(new ApiError("You cannot delete your own account", 400));
  }

  const admin = await Admin.findById(id);
  if (!admin) {
    return next(new ApiError("Admin not found", 404));
  }

  // Prevent deleting other super admins
  if (admin.adminType === "super" && req.admin.adminType !== "super") {
    return next(
      new ApiError("Only super admin can delete super admin accounts", 403)
    );
  }

  await Admin.findByIdAndDelete(id);

  res.status(200).json({
    message: "Admin deleted successfully",
  });
});

// @desc    Admin login
// @route   POST /api/v1/admins/login
// @access  Public
exports.adminLogin = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new ApiError("Please provide email and password", 400));
  }

  // Check if admin exists and get password
  const admin = await Admin.findOne({ email }).select("+password");
  if (!admin || !(await admin.comparePassword(password))) {
    return next(new ApiError("Incorrect email or password", 401));
  }

  // Check if account is active
  if (!admin.isActive) {
    return next(new ApiError("Account is deactivated", 401));
  }

  // Check if account is locked
  if (admin.lockUntil && admin.lockUntil > Date.now()) {
    return next(
      new ApiError(
        "Account is temporarily locked due to too many failed login attempts",
        423
      )
    );
  }

  // Reset login attempts on successful login
  await admin.resetLoginAttempts();

  // Generate admin token
  const token = createAdminToken(admin._id);

  // Remove password from response
  admin.password = undefined;

  res.status(200).json({
    message: "Login successful",
    token,
    data: admin,
  });
});

// @desc    Get admin profile
// @route   GET /api/v1/admins/profile
// @access  Private/Admin
exports.getAdminProfile = asyncHandler(async (req, res) => {
  const admin = await Admin.findById(req.admin._id).select("-password");

  res.status(200).json({
    data: admin,
  });
});

// @desc    Get dashboard statistics (Admin only)
// @route   GET /api/v1/admins/dashboard
// @access  Private/Admin
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const { adminType } = req.admin;

  // User statistics
  const totalUsers = await User.countDocuments();
  const subscribedUsers = await User.countDocuments({ isSubscribed: true });
  const verifiedUsers = await User.countDocuments({ identityVerified: true });

  // New users this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const newUsersThisMonth = await User.countDocuments({
    createdAt: { $gte: startOfMonth },
  });

  // Subscription statistics
  const activeSubscriptions = await Subscription.countDocuments({
    isActive: true,
  });
  const totalRevenue = await PaymentRequest.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  // Verification requests statistics
  const verificationFilter = adminType === "super" ? {} : { adminType };
  const pendingVerifications = await IdentityVerification.countDocuments({
    ...verificationFilter,
    status: "pending",
  });
  const approvedVerifications = await IdentityVerification.countDocuments({
    ...verificationFilter,
    status: "approved",
  });
  const rejectedVerifications = await IdentityVerification.countDocuments({
    ...verificationFilter,
    status: "rejected",
  });

  // Payment requests statistics
  const pendingRequests = await PaymentRequest.countDocuments({
    status: "pending",
  });
  const approvedRequests = await PaymentRequest.countDocuments({
    status: "approved",
  });

  // Subscription codes statistics
  const activeCodes = await SubscriptionCode.countDocuments({
    isUsed: false,
    expiresAt: { $gt: new Date() },
  });

  res.status(200).json({
    data: {
      users: {
        total: totalUsers,
        subscribed: subscribedUsers,
        verified: verifiedUsers,
        newThisMonth: newUsersThisMonth,
      },
      subscriptions: {
        activePackages: activeSubscriptions,
        totalRevenue: totalRevenue[0].total || 0,
      },
      verifications: {
        pending: pendingVerifications,
        approved: approvedVerifications,
        rejected: rejectedVerifications,
      },
      payments: {
        pendingRequests,
        approvedRequests,
      },
      codes: {
        active: activeCodes,
      },
    },
  });
});

// @desc    Get recent activity (Admin only)
// @route   GET /api/v1/admins/activity
// @access  Private/Admin
exports.getRecentActivity = asyncHandler(async (req, res) => {
  const { adminType } = req.admin;

  // Recent verification activities
  const verificationFilter = adminType === "super" ? {} : { adminType };
  const recentVerifications = await IdentityVerification.find({
    ...verificationFilter,
    reviewedAt: { $exists: true },
  })
    .populate("user", "name email")
    .populate("reviewedBy", "name")
    .sort({ reviewedAt: -1 })
    .limit(10)
    .select("status reviewedAt user reviewedBy");

  // Recent payment approvals
  const recentPayments = await PaymentRequest.find({
    status: { $in: ["approved", "rejected"] },
  })
    .populate("user", "name email")
    .populate("reviewedBy", "name")
    .populate("subscription", "name packageType")
    .sort({ reviewedAt: -1 })
    .limit(10)
    .select(
      "status reviewedAt user reviewedBy subscription amount paymentInstructions"
    );

  // Recent user registrations
  const recentUsers = await User.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .select("name email gender createdAt isSubscribed");

  res.status(200).json({
    data: {
      recentVerifications,
      recentPayments,
      recentUsers,
    },
  });
});

// @desc    Protect admin routes
// @access  Private/Admin
exports.protectAdmin = asyncHandler(async (req, res, next) => {
  let token;

  // Check for token in header
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return next(
      new ApiError("You are not logged in. Please log in to get access.", 401)
    );
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);

    // Check if admin exists
    const currentAdmin = await Admin.findById(decoded.adminId);
    if (!currentAdmin) {
      return next(
        new ApiError(
          "The admin belonging to this token does no longer exist.",
          401
        )
      );
    }

    // Check if admin is active
    if (!currentAdmin.isActive) {
      return next(new ApiError("Your account has been deactivated.", 401));
    }

    // Check if password was changed after token was issued
    if (currentAdmin.passwordChangedAt) {
      const passChangedTimestamp = parseInt(
        currentAdmin.passwordChangedAt.getTime() / 1000,
        10
      );
      if (decoded.iat < passChangedTimestamp) {
        return next(
          new ApiError(
            "Admin recently changed password. Please log in again.",
            401
          )
        );
      }
    }

    req.admin = currentAdmin;
    next();
  } catch (err) {
    return next(new ApiError("Invalid token. Please log in again.", 401));
  }
});

// @desc    Restrict to super admin only
// @access  Private/SuperAdmin
exports.restrictToSuperAdmin = asyncHandler(async (req, res, next) => {
  if (req.admin.adminType !== "super") {
    return next(
      new ApiError("You do not have permission to perform this action", 403)
    );
  }
  next();
});
