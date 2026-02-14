const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const Subscription = require("../models/subscriptionModel");
const User = require("../models/userModel");
const PaymentRequest = require("../models/paymentRequestModel");
const SubscriptionCode = require("../models/subscriptionCodeModel");
const ReferralCode = require("../models/referralCodeModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const Notification = require("../models/notificationModel");
const rechargeService = require("./rechargeService");

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

// @desc    Get all subscription packages (Admin only)
// @route   GET /api/v1/subscriptions/admin/packages
// @access  Private/Admin
exports.getAdminSubscriptionPackages = asyncHandler(async (req, res) => {
  const packages = await Subscription.find().sort({ price: 1 });

  res.status(200).json({
    results: packages.length,
    data: packages,
  });
});

// @desc    Create subscription package (Admin only)
// @route   POST /api/v1/subscriptions/packages
// @access  Private/Admin
exports.createSubscriptionPackage = asyncHandler(async (req, res, next) => {
  const {
    packageType,
    name,
    description,
    price,
    currency,
    features,
    durationDays,
  } = req.body;

  // Validate package type
  if (!["basic", "premium"].includes(packageType)) {
    return next(new ApiError("Invalid package type", 400));
  }

  // المدة بالأيام إجبارية — يمكن للأدمن إضافة عدة باقات من نفس النوع (أساسي 15، أساسي 30، بريميوم 15، إلخ)
  const resolvedDurationDays = durationDays;
  if (!resolvedDurationDays || resolvedDurationDays < 1) {
    return next(new ApiError("Duration in days is required (min 1)", 400));
  }

  const subscriptionPackage = await Subscription.create({
    packageType,
    name,
    description,
    price,
    currency: currency || "USD",
    durationDays: resolvedDurationDays,
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
  const { name, description, price, currency, features, isActive, durationDays } = req.body;

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
  if (durationDays != null && durationDays >= 1) subscriptionPackage.durationDays = durationDays;

  await subscriptionPackage.save();

  res.status(200).json({
    message: "Subscription package updated successfully",
    data: subscriptionPackage,
  });
});

// @desc    Delete subscription package (Admin only)
// @route   DELETE /api/v1/subscriptions/packages/:id
// @access  Private/Admin
exports.deleteSubscriptionPackage = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const subscriptionPackage = await Subscription.findById(id);
  if (!subscriptionPackage) {
    return next(new ApiError("Subscription package not found", 404));
  }

  // Check if package has active users
  if (subscriptionPackage.currentUsers > 0) {
    return next(
      new ApiError(
        "Cannot delete package with active users. Please deactivate it instead.",
        400
      )
    );
  }

  await Subscription.findByIdAndDelete(id);

  res.status(200).json({
    message: "Subscription package deleted successfully",
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
    referralCode: referralCodeInput,
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

  let amount = subscription.price;
  let originalAmount = null;
  let referralCodeId = null;

  if (referralCodeInput && String(referralCodeInput).trim()) {
    const codeStr = String(referralCodeInput).trim().toUpperCase();
    const referralCode = await ReferralCode.findOne({ code: codeStr });

    if (!referralCode) {
      return next(
        new ApiError("كود الإحالة غير صحيح أو منتهي الصلاحية", 400)
      );
    }
    if (!referralCode.canBeUsed()) {
      if (!referralCode.isActive) {
        return next(new ApiError("كود الإحالة غير مفعّل", 400));
      }
      if (referralCode.isExpired()) {
        return next(new ApiError("كود الإحالة منتهي الصلاحية", 400));
      }
      return next(new ApiError("كود الإحالة استُنفد عدد مرات الاستخدام", 400));
    }

    const user = await User.findById(userId).select("usedReferralCode");
    if (user.usedReferralCode) {
      return next(
        new ApiError("لقد استخدمت كود إحالة مسبقاً. الخصم متاح لمرة واحدة فقط.", 400)
      );
    }

    originalAmount = subscription.price;
    const discount = (originalAmount * referralCode.discountPercent) / 100;
    amount = Math.max(0, originalAmount - discount);
    referralCodeId = referralCode._id;
  }

  // Create payment request
  const paymentRequest = await PaymentRequest.create({
    user: userId,
    subscription: subscriptionId,
    amount,
    currency: subscription.currency,
    paymentInstructions,
    paymentMethod: paymentMethod || "bank_transfer",
    transactionReference,
    referralCode: referralCodeId,
    originalAmount: originalAmount ?? undefined,
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
    // Fall back to recharge code flow (same codes for subscriptions)
    return rechargeService.useRechargeCode(req, res, next);
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

  // Delete the code once it's consumed
  if (subscriptionCode.currentUses >= subscriptionCode.maxUses) {
    await subscriptionCode.deleteOne();
  }

  // Update subscription user count
  await Subscription.findByIdAndUpdate(subscription._id, {
    $inc: { currentUsers: 1 },
  });

  // Record transaction in app wallet for code activation
  let appWallet = await Wallet.getAppWallet();
  if (!appWallet) {
    appWallet = await Wallet.create({
      walletType: "app",
      balance: 0,
      currency: subscription.currency || "SAR",
    });
  }
  await appWallet.addCredit(
    subscription.price,
    `Subscription code used: ${subscriptionCode.code}`,
    subscriptionCode.code
  );
  await Transaction.create({
    wallet: appWallet._id,
    user: userId,
    type: "subscription_payment",
    amount: subscription.price,
    currency: subscription.currency || "SAR",
    description: "Subscription activated via code",
    reference: subscriptionCode.code,
    subscription: subscription._id,
    status: "completed",
    paymentMethod: "recharge_code",
    externalReference: subscriptionCode.code,
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

  const user = await User.findById(userId).select(
    "isSubscribed subscriptionEndDate subscriptionPackage identityVerified identityVerificationStatus"
  );

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

  // Get subscription package details if packageType exists
  let subscriptionPackageDetails = null;
  if (user.subscriptionPackage) {
    const subscription = await Subscription.findOne({
      packageType: user.subscriptionPackage,
      isActive: true,
    }).select("name features");
    if (subscription) {
      subscriptionPackageDetails = {
        name: subscription.name,
        features: subscription.features,
        packageType: user.subscriptionPackage,
      };
    }
  }

  res.status(200).json({
    data: {
      isSubscribed: user.isSubscribed,
      subscriptionEndDate: user.subscriptionEndDate,
      subscriptionPackage: subscriptionPackageDetails,
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

  const paymentRequest = await PaymentRequest.findById(id);
  if (!paymentRequest) {
    return next(new ApiError("Payment request not found", 404));
  }

  if (paymentRequest.status !== "pending") {
    return next(new ApiError("Request has already been processed", 400));
  }

  // Get subscription ID (handle both ObjectId and populated object)
  const subscriptionId = paymentRequest.subscription?._id || paymentRequest.subscription;
  
  // Fetch subscription directly to ensure we have the latest data including isActive
  const subscription = await Subscription.findById(subscriptionId);
  if (!subscription) {
    return next(new ApiError("Subscription package not found", 404));
  }

  // Ensure subscription is active
  if (subscription.isActive !== true) {
    return next(new ApiError("Subscription package is not active", 400));
  }

  // Calculate subscription end date
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + subscription.durationDays);

  // Update user subscription
  const updateUser = {
    isSubscribed: true,
    subscriptionEndDate: endDate,
    subscriptionPackage: subscription.packageType,
  };
  if (paymentRequest.referralCode) {
    updateUser.usedReferralCode = paymentRequest.referralCode;
    await ReferralCode.findByIdAndUpdate(paymentRequest.referralCode, {
      $inc: { currentUses: 1 },
    });
  }
  await User.findByIdAndUpdate(paymentRequest.user, updateUser);

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

  // Record transaction in app wallet
  let appWallet = await Wallet.getAppWallet();
  if (!appWallet) {
    appWallet = await Wallet.create({
      walletType: "app",
      balance: 0,
      currency: paymentRequest.currency || "SAR",
    });
  }
  await appWallet.addCredit(
    paymentRequest.amount,
    `Manual subscription payment approved: ${paymentRequest._id}`,
    paymentRequest.transactionReference
  );
  await Transaction.create({
    wallet: appWallet._id,
    user: paymentRequest.user,
    type: "subscription_payment",
    amount: paymentRequest.amount,
    currency: paymentRequest.currency || "SAR",
    description: "Manual subscription payment approved",
    reference: paymentRequest.transactionReference,
    subscription: subscription._id,
    status: "completed",
    paymentMethod: paymentRequest.paymentMethod || "bank_transfer",
    externalReference: paymentRequest.transactionReference,
    admin: req.admin._id,
  });

  // إشعار للمستخدم (يُرسل push تلقائياً عبر post-save في Notification)
  await Notification.createNotification({
    user: paymentRequest.user,
    type: "subscription_request_approved",
    title: "تمت الموافقة على طلب الاشتراك",
    message: "تم تفعيل اشتراكك بنجاح. استمتع بمزايا التطبيق!",
    data: { paymentRequestId: id },
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

  // إشعار للمستخدم (يُرسل push تلقائياً عبر post-save في Notification)
  await Notification.createNotification({
    user: paymentRequest.user,
    type: "subscription_request_rejected",
    title: "تم رفض طلب الاشتراك",
    message: rejectionReason
      ? `تم رفض طلب الاشتراك: ${rejectionReason}`
      : "تم رفض طلب الاشتراك. يرجى التواصل مع الدعم إن كان لديك استفسار.",
    data: { paymentRequestId: id, reason: rejectionReason },
  });

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

  const requests = await features.mongooseQuery;

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

  const codes = await features.mongooseQuery;

  res.status(200).json({
    results: codes.length,
    data: codes,
  });
});

// ============== Referral Codes (كود إحالة) - Admin only ==============

// @desc    Create referral code (Admin only)
// @route   POST /api/v1/subscriptions/referral-codes
// @access  Private/Admin
exports.createReferralCode = asyncHandler(async (req, res, next) => {
  const { code, discountPercent, expiresAt, maxUses, description } = req.body;
  const { _id: adminId } = req.admin;

  let finalCode = code
    ? String(code).trim().toUpperCase()
    : ReferralCode.generateCode(8);

  const existing = await ReferralCode.findOne({ code: finalCode });
  if (existing) {
    return next(new ApiError("كود الإحالة موجود مسبقاً. اختر كوداً آخر.", 400));
  }

  const referralCode = await ReferralCode.create({
    code: finalCode,
    discountPercent,
    createdBy: adminId,
    expiresAt: expiresAt || null,
    maxUses: maxUses ?? null,
    description: description || undefined,
  });

  res.status(201).json({
    message: "تم إنشاء كود الإحالة بنجاح",
    data: referralCode,
  });
});

// @desc    Get all referral codes (Admin only)
// @route   GET /api/v1/subscriptions/referral-codes
// @access  Private/Admin
exports.getReferralCodes = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    ReferralCode.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .search();

  const codes = await features.mongooseQuery;

  res.status(200).json({
    results: codes.length,
    data: codes,
  });
});

// @desc    Update referral code (Admin only)
// @route   PUT /api/v1/subscriptions/referral-codes/:id
// @access  Private/Admin
exports.updateReferralCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { isActive, expiresAt, maxUses, description } = req.body;

  const referralCode = await ReferralCode.findById(id);
  if (!referralCode) {
    return next(new ApiError("كود الإحالة غير موجود", 404));
  }

  if (isActive !== undefined) referralCode.isActive = isActive;
  if (expiresAt !== undefined) referralCode.expiresAt = expiresAt;
  if (maxUses !== undefined) referralCode.maxUses = maxUses;
  if (description !== undefined) referralCode.description = description;

  await referralCode.save();

  res.status(200).json({
    message: "تم تحديث كود الإحالة بنجاح",
    data: referralCode,
  });
});

// @desc    Delete referral code (Admin only)
// @route   DELETE /api/v1/subscriptions/referral-codes/:id
// @access  Private/Admin
exports.deleteReferralCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const referralCode = await ReferralCode.findById(id);
  if (!referralCode) {
    return next(new ApiError("كود الإحالة غير موجود", 404));
  }

  await ReferralCode.findByIdAndDelete(id);

  res.status(200).json({
    message: "تم حذف كود الإحالة بنجاح",
  });
});
