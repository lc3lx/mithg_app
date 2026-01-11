const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const Subscription = require("../models/subscriptionModel");
const User = require("../models/userModel");
const PaymentRequest = require("../models/paymentRequestModel");
const SubscriptionCode = require("../models/subscriptionCodeModel");

// @desc    Get all active subscription packages
// @route   GET /api/v1/subscriptions/packages
// @access  Public
exports.getSubscriptionPackages = asyncHandler(async (req, res) => {
  const packages = await Subscription.find({ isActive: true }).sort({
    price: 1,
  });

  res.status(200).json({
    results: packages.length,
    data: packages,
  });
});

// @desc    Create subscription package (Admin only)
// @route   POST /api/v1/subscriptions/packages
// @access  Private/Admin
exports.createSubscriptionPackage = asyncHandler(async (req, res, next) => {
  const { packageType, name, description, price, currency, features } =
    req.body;

  // Validate package type
  if (!["1month", "3months", "6months"].includes(packageType)) {
    return next(new ApiError("Invalid package type", 400));
  }

  // Check if package type already exists
  const existingPackage = await Subscription.findOne({
    packageType,
    isActive: true,
  });
  if (existingPackage) {
    return next(new ApiError("Package type already exists", 400));
  }

  // Calculate duration in days
  let durationDays;
  switch (packageType) {
    case "1month":
      durationDays = 30;
      break;
    case "3months":
      durationDays = 90;
      break;
    case "6months":
      durationDays = 180;
      break;
    default:
      return next(new ApiError("Invalid package type", 400));
  }

  const subscriptionPackage = await Subscription.create({
    packageType,
    name,
    description,
    price,
    currency: currency || "USD",
    durationDays,
    features: features || [],
  });

  res.status(201).json({
    message: "Subscription package created successfully",
    data: subscriptionPackage,
  });
});

// @desc    Update subscription package (Admin only)
// @route   PUT /api/v1/subscriptions/packages/:id
// @access  Private/Admin
exports.updateSubscriptionPackage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { name, description, price, currency, features, isActive } = req.body;

  const subscriptionPackage = await Subscription.findById(id);
  if (!subscriptionPackage) {
    return next(new ApiError("Subscription package not found", 404));
  }

  // Update fields
  if (name) subscriptionPackage.name = name;
  if (description !== undefined) subscriptionPackage.description = description;
  if (price) subscriptionPackage.price = price;
  if (currency) subscriptionPackage.currency = currency;
  if (features) subscriptionPackage.features = features;
  if (isActive !== undefined) subscriptionPackage.isActive = isActive;

  await subscriptionPackage.save();

  res.status(200).json({
    message: "Subscription package updated successfully",
    data: subscriptionPackage,
  });
});

// @desc    Subscribe user to package using payment request
// @route   POST /api/v1/subscriptions/subscribe/request
// @access  Private/Protect
exports.subscribeWithPaymentRequest = asyncHandler(async (req, res, next) => {
  const {
    subscriptionId,
    paymentInstructions,
    paymentMethod,
    transactionReference,
  } = req.body;
  const userId = req.user._id;

  // Check if subscription exists
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription || !subscription.isActive) {
    return next(
      new ApiError("Subscription package not found or inactive", 404)
    );
  }

  // Check if user already has a pending request for this subscription
  const existingRequest = await PaymentRequest.findOne({
    user: userId,
    subscription: subscriptionId,
    status: "pending",
  });

  if (existingRequest) {
    return next(
      new ApiError(
        "You already have a pending payment request for this subscription",
        400
      )
    );
  }

  // Create payment request
  const paymentRequest = await PaymentRequest.create({
    user: userId,
    subscription: subscriptionId,
    amount: subscription.price,
    currency: subscription.currency,
    paymentInstructions,
    paymentMethod: paymentMethod || "bank_transfer",
    transactionReference,
  });

  res.status(201).json({
    message:
      "Payment request submitted successfully. Please follow the payment instructions and wait for admin approval.",
    data: paymentRequest,
  });
});

// @desc    Subscribe user using subscription code
// @route   POST /api/v1/subscriptions/subscribe/code
// @access  Private/Protect
exports.subscribeWithCode = asyncHandler(async (req, res, next) => {
  const { code } = req.body;
  const userId = req.user._id;

  // Find and validate code
  const subscriptionCode = await SubscriptionCode.findOne({
    code: code.toUpperCase(),
  }).populate("subscription");

  if (!subscriptionCode) {
    return next(new ApiError("Invalid subscription code", 404));
  }

  if (!subscriptionCode.canBeUsed()) {
    if (subscriptionCode.isUsed) {
      return next(new ApiError("Subscription code has already been used", 400));
    }
    if (subscriptionCode.isExpired()) {
      return next(new ApiError("Subscription code has expired", 400));
    }
    return next(new ApiError("Subscription code is no longer valid", 400));
  }

  const { subscription } = subscriptionCode;
  if (!subscription || !subscription.isActive) {
    return next(new ApiError("Subscription package is not available", 400));
  }

  // Calculate subscription end date
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + subscription.durationDays);

  // Update user subscription
  await User.findByIdAndUpdate(userId, {
    isSubscribed: true,
    subscriptionEndDate: endDate,
    subscriptionPackage: subscription.packageType,
  });

  // Mark code as used
  subscriptionCode.isUsed = true;
  subscriptionCode.usedBy = userId;
  subscriptionCode.usedAt = new Date();
  subscriptionCode.currentUses += 1;
  await subscriptionCode.save();

  // Update subscription user count
  await Subscription.findByIdAndUpdate(subscription._id, {
    $inc: { currentUsers: 1 },
  });

  res.status(200).json({
    message: "Subscription activated successfully!",
    data: {
      subscriptionPackage: subscription.packageType,
      endDate,
      features: subscription.features,
    },
  });
});

// @desc    Get user's subscription status
// @route   GET /api/v1/subscriptions/status
// @access  Private/Protect
exports.getUserSubscriptionStatus = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const user = await User.findById(userId)
    .select(
      "isSubscribed subscriptionEndDate subscriptionPackage identityVerified identityVerificationStatus"
    )
    .populate({
      path: "subscriptionPackage",
      model: "Subscription",
      select: "name features",
    });

  // Check if subscription is expired
  let isExpired = false;
  if (user.subscriptionEndDate && user.subscriptionEndDate < new Date()) {
    isExpired = true;
    // Update user status if expired
    await User.findByIdAndUpdate(userId, {
      isSubscribed: false,
    });
    user.isSubscribed = false;
  }

  res.status(200).json({
    data: {
      isSubscribed: user.isSubscribed,
      subscriptionEndDate: user.subscriptionEndDate,
      subscriptionPackage: user.subscriptionPackage,
      isExpired,
      identityVerified: user.identityVerified,
      identityVerificationStatus: user.identityVerificationStatus,
    },
  });
});

// @desc    Approve payment request (Admin only)
// @route   PUT /api/v1/subscriptions/requests/:id/approve
// @access  Private/Admin
exports.approvePaymentRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { reviewNotes } = req.body;
  const { _id: adminId } = req.admin;

  const paymentRequest = await PaymentRequest.findById(id).populate(
    "subscription"
  );
  if (!paymentRequest) {
    return next(new ApiError("Payment request not found", 404));
  }

  if (paymentRequest.status !== "pending") {
    return next(new ApiError("Request has already been processed", 400));
  }

  const { subscription } = paymentRequest;
  if (!subscription || !subscription.isActive) {
    return next(new ApiError("Subscription package is not available", 400));
  }

  // Calculate subscription end date
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + subscription.durationDays);

  // Update user subscription
  await User.findByIdAndUpdate(paymentRequest.user, {
    isSubscribed: true,
    subscriptionEndDate: endDate,
    subscriptionPackage: subscription.packageType,
  });

  // Update request status
  paymentRequest.status = "approved";
  paymentRequest.reviewedBy = adminId;
  paymentRequest.reviewNotes = reviewNotes;
  paymentRequest.reviewedAt = new Date();
  await paymentRequest.save();

  // Update subscription user count
  await Subscription.findByIdAndUpdate(subscription._id, {
    $inc: { currentUsers: 1 },
  });

  res.status(200).json({
    message: "Payment request approved and subscription activated",
    data: paymentRequest,
  });
});

// @desc    Reject payment request (Admin only)
// @route   PUT /api/v1/subscriptions/requests/:id/reject
// @access  Private/Admin
exports.rejectPaymentRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { rejectionReason, reviewNotes } = req.body;
  const { _id: adminId } = req.admin;

  const paymentRequest = await PaymentRequest.findById(id);
  if (!paymentRequest) {
    return next(new ApiError("Payment request not found", 404));
  }

  if (paymentRequest.status !== "pending") {
    return next(new ApiError("Request has already been processed", 400));
  }

  // Update request status
  paymentRequest.status = "rejected";
  paymentRequest.reviewedBy = adminId;
  paymentRequest.reviewNotes = reviewNotes;
  paymentRequest.rejectionReason = rejectionReason;
  paymentRequest.reviewedAt = new Date();
  await paymentRequest.save();

  res.status(200).json({
    message: "Payment request rejected",
    data: paymentRequest,
  });
});

// @desc    Get payment requests (Admin only)
// @route   GET /api/v1/subscriptions/requests
// @access  Private/Admin
exports.getPaymentRequests = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    PaymentRequest.find().sort({ createdAt: -1 }),
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

// @desc    Get user's payment requests
// @route   GET /api/v1/subscriptions/my-requests
// @access  Private/Protect
exports.getUserPaymentRequests = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const requests = await PaymentRequest.find({ user: userId })
    .populate("subscription", "name packageType price currency")
    .populate("reviewedBy", "name email adminType")
    .sort({ createdAt: -1 });

  res.status(200).json({
    results: requests.length,
    data: requests,
  });
});

// @desc    Create subscription code (Admin only)
// @route   POST /api/v1/subscriptions/codes
// @access  Private/Admin
exports.createSubscriptionCode = asyncHandler(async (req, res, next) => {
  const { subscriptionId, expiresAt, maxUses, description } = req.body;
  const { _id: adminId } = req.admin;

  // Check if subscription exists
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription || !subscription.isActive) {
    return next(
      new ApiError("Subscription package not found or inactive", 404)
    );
  }

  // Generate unique code
  // Note: This loop may run multiple times (rarely) to ensure code uniqueness
  let code;
  let existingCode;
  let attempts = 0;
  const maxAttempts = 10; // Prevent infinite loop

  while (attempts < maxAttempts) {
    code = Subscription.generateCode();
    // eslint-disable-next-line no-await-in-loop
    existingCode = await SubscriptionCode.findOne({ code });

    if (!existingCode) {
      break; // Found unique code
    }

    attempts += 1; // Increment attempts

    if (attempts >= maxAttempts) {
      return next(
        new ApiError("Failed to generate unique code. Please try again.", 500)
      );
    }
  }

  const subscriptionCode = await SubscriptionCode.create({
    code,
    subscription: subscriptionId,
    createdBy: adminId,
    expiresAt,
    maxUses: maxUses || 1,
    description,
  });

  res.status(201).json({
    message: "Subscription code created successfully",
    data: subscriptionCode,
  });
});

// @desc    Get subscription codes (Admin only)
// @route   GET /api/v1/subscriptions/codes
// @access  Private/Admin
exports.getSubscriptionCodes = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    SubscriptionCode.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const codes = await features.query;

  res.status(200).json({
    results: codes.length,
    data: codes,
  });
});
