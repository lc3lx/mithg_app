const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");
const { createAdminToken } = require("../utils/createToken");

const Admin = require("../models/adminModel");
const AdminActivity = require("../models/adminActivityModel");
const User = require("../models/userModel");
const Subscription = require("../models/subscriptionModel");
const PaymentRequest = require("../models/paymentRequestModel");
const SubscriptionCode = require("../models/subscriptionCodeModel");
const IdentityVerification = require("../models/identityVerificationModel");

const getDefaultPermissions = (adminType) => {
  if (adminType === "super") {
    return {
      manageSubscriptions: true,
      manageUsers: true,
      verifyIdentities: true,
      manageAdmins: true,
      viewReports: true,
      monitorChats: true,
      manageBannedWords: true,
      manageWallets: true,
      manageRechargeCodes: true,
      moderateContent: true,
    };
  }
  return {
    manageSubscriptions: false,
    manageUsers: false,
    verifyIdentities: true,
    manageAdmins: false,
    viewReports: true,
    monitorChats: true,
    manageBannedWords: false,
    manageWallets: false,
    manageRechargeCodes: false,
    moderateContent: true,
  };
};

function _getMonthName(monthNumber) {
  const months = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  return months[monthNumber - 1] || "غير معروف";
}

const logAdminAction = async (
  adminId,
  action,
  targetType,
  targetId,
  details
) => {
  if (!adminId) return;
  try {
    await AdminActivity.create({
      admin: adminId,
      action,
      targetType,
      targetId,
      details,
    });
    await Admin.findByIdAndUpdate(adminId, { $inc: { actionsCount: 1 } });
  } catch (error) {
    // Avoid blocking main operation if logging fails
  }
};

// @desc    Create new admin (Super admin only)
// @route   POST /api/v1/admins
// @access  Private/SuperAdmin
exports.createAdmin = asyncHandler(async (req, res, next) => {
  const { name, email, password, phone, adminType, permissions } = req.body;

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
    permissions: permissions
      ? { ...getDefaultPermissions(adminType), ...permissions }
      : getDefaultPermissions(adminType),
  });

  await logAdminAction(req.admin?._id, "create_admin", "admin", admin._id, {
    name: admin.name,
    adminType: admin.adminType,
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

  const admins = await features.mongooseQuery;

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
  const { name, email, phone, adminType, isActive, permissions, password } =
    req.body;
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
  if (adminType && currentAdmin.adminType === "super") {
    admin.adminType = adminType;
    if (!permissions) {
      admin.permissions = getDefaultPermissions(adminType);
    }
  }
  if (isActive !== undefined && currentAdmin.adminType === "super") {
    admin.isActive = isActive;
  }
  if (permissions && currentAdmin.adminType === "super") {
    admin.permissions = { ...admin.permissions.toObject(), ...permissions };
  }
  if (password && currentAdmin.adminType === "super") {
    admin.password = password;
  }

  await admin.save();

  await logAdminAction(req.admin?._id, "update_admin", "admin", admin._id, {
    name: admin.name,
  });

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

  await logAdminAction(req.admin?._id, "delete_admin", "admin", id, {});

  res.status(200).json({
    message: "Admin deleted successfully",
  });
});

// @desc    Admin login
// @route   POST /api/v1/admins/login
// @access  Public
exports.adminLogin = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;
  console.log(req.body)

  if (!email || !password) {
    return next(new ApiError("Please provide email and password", 400));
  }

  // Check if admin exists and get password
  const admin = await Admin.findOne({ email: email.trim() }).select("+password");

  if (!admin) {
    return next(new ApiError("Incorrect email or password", 401));
  }

  // Normalize incoming password for comparison (avoid accidental non-string / surrounding whitespace)
  const candidatePassword =
    typeof password === "string" ? password : String(password || "");

  // Helpful debug logs (remove or lower verbosity in production)
  console.log("adminLogin: comparing passwords", {
    email: admin.email,
    candidateLength: candidatePassword.length,
    storedHashLength: admin.password ? admin.password.length : 0,
  });

  // Try exact and trimmed variants (some clients send accidental spaces/newlines)
  const isValidPassword =
    (await admin.comparePassword(candidatePassword)) ||
    (candidatePassword !== candidatePassword.trim() &&
      (await admin.comparePassword(candidatePassword.trim())));

  console.log("adminLogin: password valid?", isValidPassword);

  if (!isValidPassword) {
    console.log(admin);
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
        totalRevenue:
          totalRevenue && totalRevenue.length > 0
            ? totalRevenue[0].total || 0
            : 0,
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

// @desc    Get users growth chart data (Admin only)
// @route   GET /api/v1/admins/charts/users-growth
// @access  Private/Admin
exports.getUsersGrowthChart = asyncHandler(async (req, res) => {
  // Get user registrations for the last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const usersGrowth = await User.aggregate([
    {
      $match: {
        createdAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Format the data for frontend
  const formattedData = usersGrowth.map((item) => ({
    month: `${item._id.year}-${item._id.month.toString().padStart(2, "0")}`,
    users: item.count,
    label: _getMonthName(item._id.month),
  }));

  res.status(200).json({
    data: formattedData,
  });
});

// @desc    Get revenue growth chart data (Admin only)
// @route   GET /api/v1/admins/charts/revenue-growth
// @access  Private/Admin
exports.getRevenueGrowthChart = asyncHandler(async (req, res) => {
  // Get approved payments for the last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const revenueGrowth = await PaymentRequest.aggregate([
    {
      $match: {
        status: "approved",
        reviewedAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$reviewedAt" },
          month: { $month: "$reviewedAt" },
        },
        totalRevenue: { $sum: "$amount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  // Format the data for frontend
  const formattedData = revenueGrowth.map((item) => ({
    month: `${item._id.year}-${item._id.month.toString().padStart(2, "0")}`,
    revenue: item.totalRevenue,
    label: _getMonthName(item._id.month),
  }));

  res.status(200).json({
    data: formattedData,
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

// @desc    Get all users (filtered by admin type)
// @route   GET /api/v1/admins/users
// @access  Private/Admin
exports.getAdminUsers = asyncHandler(async (req, res) => {
  const { adminType } = req.admin;

  // Build filter based on admin type
  const filter = {};
  if (adminType === "male") {
    filter.gender = "male";
  } else if (adminType === "female") {
    filter.gender = "female";
  }
  // super admin sees all users (no filter)

  // Apply additional filters from query params
  if (req.query.isSubscribed !== undefined) {
    filter.isSubscribed = req.query.isSubscribed === "true";
  }
  if (req.query.identityVerified !== undefined) {
    filter.identityVerified = req.query.identityVerified === "true";
  }
  if (req.query.isBlocked !== undefined) {
    filter.isBlocked = req.query.isBlocked === "true";
  }
  if (req.query.isActive !== undefined) {
    filter.active = req.query.isActive === "true";
  }

  // بحث بالاسم / البريد / الهاتف / اسم المستخدم
  const searchTerm = (req.query.search || req.query.keyword || "").toString().trim();
  if (searchTerm.length > 0) {
    const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const searchRegex = new RegExp(escaped, "i");
    filter.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phone: searchRegex },
      { username: searchRegex },
    ];
  }

  // Build query with ApiFeatures
  const apiFeatures = new ApiFeatures(User.find(filter), req.query)
    .paginate()
    .filter()
    .search("User")
    .limitFields()
    .sort();

  const { mongooseQuery, paginationResult } = apiFeatures;
  const users = await mongooseQuery.select("-password");

  res.status(200).json({
    results: users.length,
    paginationResult,
    data: users,
  });
});

// @desc    Toggle user subscription
// @route   PUT /api/v1/admins/users/:id/subscription
// @access  Private/Admin
exports.toggleUserSubscription = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isSubscribed, subscriptionEndDate } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  const newIsSubscribed =
    isSubscribed !== undefined ? isSubscribed : !user.isSubscribed;

  const updateOps = { $set: { isSubscribed: newIsSubscribed } };

  if (newIsSubscribed && subscriptionEndDate) {
    updateOps.$set.subscriptionEndDate = new Date(subscriptionEndDate);
  } else if (!newIsSubscribed) {
    updateOps.$set.subscriptionEndDate = null;
    // إزالة الحقل بدل null لتجنب رفض enum في الموديل
    updateOps.$unset = { subscriptionPackage: 1 };
  }

  await User.updateOne({ _id: id }, updateOps);

  // Fetch updated user
  const updatedUser = await User.findById(id).select(
    "_id isSubscribed subscriptionEndDate"
  );

  res.status(200).json({
    message: `User subscription ${
      newIsSubscribed ? "activated" : "deactivated"
    } successfully`,
    data: {
      userId: updatedUser._id,
      isSubscribed: updatedUser.isSubscribed,
      subscriptionEndDate: updatedUser.subscriptionEndDate,
    },
  });

  await logAdminAction(req.admin?._id, "toggle_user_subscription", "user", id, {
    isSubscribed: newIsSubscribed,
  });
});

// @desc    Toggle user active status
// @route   PUT /api/v1/admins/users/:id/active
// @access  Private/Admin
exports.toggleUserActive = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  // الحقل في الموديل هو active (تجميد الحساب يضع active: false)
  const newActive = isActive !== undefined ? isActive : !user.active;

  await User.updateOne({ _id: id }, { $set: { active: newActive } });

  const updatedUser = await User.findById(id).select("_id active");

  res.status(200).json({
    message: `User account ${
      newActive ? "activated" : "deactivated"
    } successfully`,
    data: {
      userId: updatedUser._id,
      isActive: updatedUser.active,
    },
  });

  await logAdminAction(req.admin?._id, "toggle_user_active", "user", id, {
    isActive: newActive,
  });
});

// @desc    Verify user identity (admin action)
// @route   PUT /api/v1/admins/users/:id/verify
// @access  Private/Admin
exports.verifyUserIdentity = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  await User.updateOne(
    { _id: id },
    {
      $set: {
        identityVerified: true,
        identityVerificationStatus: "approved",
        identityVerificationSubmitted: true,
      },
    }
  );

  res.status(200).json({
    message: "User verified successfully",
    data: {
      userId: id,
      identityVerified: true,
      identityVerificationStatus: "approved",
    },
  });

  await logAdminAction(req.admin?._id, "verify_user_identity", "user", id, {
    identityVerified: true,
  });
});

// @desc    Unverify user identity (admin action)
// @route   PUT /api/v1/admins/users/:id/unverify
// @access  Private/Admin
exports.unverifyUserIdentity = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return next(new ApiError("User not found", 404));
  }

  // Check admin permissions based on admin type
  const { adminType } = req.admin;
  if (adminType !== "super" && user.gender !== adminType) {
    return next(
      new ApiError("You do not have permission to manage this user", 403)
    );
  }

  await User.updateOne(
    { _id: id },
    {
      $set: {
        identityVerified: false,
        identityVerificationStatus: "new",
        identityVerificationSubmitted: false,
      },
    }
  );

  res.status(200).json({
    message: "User verification revoked successfully",
    data: {
      userId: id,
      identityVerified: false,
      identityVerificationStatus: "new",
    },
  });

  await logAdminAction(req.admin?._id, "unverify_user_identity", "user", id, {
    identityVerified: false,
  });
});

// @desc    Get admin activity logs (Super admin only)
// @route   GET /api/v1/admins/:id/activity
// @access  Private/SuperAdmin
exports.getAdminActivity = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);

  const activities = await AdminActivity.find({ admin: id })
    .sort({ createdAt: -1 })
    .limit(limit);

  res.status(200).json({
    results: activities.length,
    data: activities,
  });
});