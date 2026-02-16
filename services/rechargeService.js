const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const RechargeCode = require("../models/rechargeCodeModel");
const Subscription = require("../models/subscriptionModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");

// @desc    Get all recharge codes
// @route   GET /api/v1/admins/recharge-codes
// @access  Private/Admin
exports.getRechargeCodes = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    RechargeCode.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .paginate(await RechargeCode.countDocuments());

  const codes = await features.mongooseQuery;

  res.status(200).json({
    status: "success",
    results: codes.length,
    data: codes,
  });
});

// @desc    Generate batch of recharge codes
// @route   POST /api/v1/admins/recharge-codes/generate
// @access  Private/Admin
exports.generateRechargeCodes = asyncHandler(async (req, res, next) => {
  const { count, amount, currency, expiresAt, description } = req.body;

  if (!count || count <= 0 || count > 1000) {
    return next(new ApiError("Count must be between 1 and 1000", 400));
  }

  if (!amount || amount <= 0) {
    return next(new ApiError("Valid amount is required", 400));
  }

  const batchId = `BATCH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const codes = await RechargeCode.generateBatch(
    count,
    amount,
    currency || "SAR",
    expiresAt ? new Date(expiresAt) : null,
    req.admin._id,
    description,
    batchId
  );

  res.status(201).json({
    status: "success",
    message: `Generated ${count} recharge codes with amount ${amount} ${currency || "SAR"}`,
    data: {
      batchId,
      codes: codes.map(code => ({
        code: code.code,
        amount: code.amount,
        currency: code.currency,
        expiresAt: code.expiresAt,
      })),
    },
  });
});

// @desc    Get recharge code by ID
// @route   GET /api/v1/admins/recharge-codes/:id
// @access  Private/Admin
exports.getRechargeCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const code = await RechargeCode.findById(id);

  if (!code) {
    return next(new ApiError("Recharge code not found", 404));
  }

  res.status(200).json({
    status: "success",
    data: code,
  });
});

// @desc    Update recharge code
// @route   PUT /api/v1/admins/recharge-codes/:id
// @access  Private/Admin
exports.updateRechargeCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { status, description } = req.body;

  const code = await RechargeCode.findById(id);

  if (!code) {
    return next(new ApiError("Recharge code not found", 404));
  }

  // Update allowed fields
  if (status) code.status = status;
  if (description !== undefined) code.description = description;

  await code.save();

  res.status(200).json({
    status: "success",
    message: "Recharge code updated successfully",
    data: code,
  });
});

// @desc    Delete recharge code
// @route   DELETE /api/v1/admins/recharge-codes/:id
// @access  Private/Admin
exports.deleteRechargeCode = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const code = await RechargeCode.findById(id);

  if (!code) {
    return next(new ApiError("Recharge code not found", 404));
  }

  // Don't allow deleting used codes
  if (code.currentUses > 0) {
    return next(new ApiError("Cannot delete used recharge code", 400));
  }

  await RechargeCode.findByIdAndDelete(id);

  res.status(200).json({
    status: "success",
    message: "Recharge code deleted successfully",
  });
});

// @desc    Use recharge code (for users)
// @route   POST /api/v1/recharge-codes/use
// @access  Private/User
exports.useRechargeCode = asyncHandler(async (req, res, next) => {
  const { code, packageId } = req.body;

  if (!code) {
    return next(new ApiError("Recharge code is required", 400));
  }

  // Find the code
  const rechargeCode = await RechargeCode.findOne({
    code: code.toUpperCase().trim()
  });

  if (!rechargeCode) {
    return next(new ApiError("Invalid recharge code", 400));
  }

  // Check if code can be used
  if (!rechargeCode.canBeUsed()) {
    let message = "Recharge code cannot be used";
    if (rechargeCode.status !== "active") {
      message = "Recharge code is not active";
    } else if (rechargeCode.isExpired) {
      message = "Recharge code has expired";
    } else if (rechargeCode.currentUses >= rechargeCode.maxUses) {
      message = "Recharge code has reached maximum uses";
    }

    return next(new ApiError(message, 400));
  }

  // التحقق: قيمة الكود يجب أن تكون مساوية لسعر الباقة التي اختارها المستخدم (نفس العملة)
  if (!packageId) {
    return next(
      new ApiError("يجب اختيار الباقة قبل استخدام الكود.", 400)
    );
  }

  const subscription = await Subscription.findOne({
    _id: packageId,
    isActive: true,
  }).lean();

  if (!subscription) {
    return next(new ApiError("الباقة غير موجودة أو غير متاحة.", 400));
  }

  // الاشتراك بالكود: القيمة بالدولار (USD) فقط
  const codeAmount = Number(rechargeCode.amount);
  const codeCurrency = (rechargeCode.currency || "").toUpperCase();
  const packagePrice = Number(subscription.price);
  const packageCurrency = (subscription.currency || "").toUpperCase();

  if (codeCurrency !== "USD" || packageCurrency !== "USD") {
    return next(
      new ApiError(
        "قيمة الكود وسعر الباقة يجب أن يكونا بالدولار (USD).",
        400
      )
    );
  }

  // قيمة الكود يجب أن تساوي سعر الباقة التي اختارها المستخدم (مقارنة متسامحة للأرقام العشرية)
  const priceDiff = Math.abs(codeAmount - packagePrice);
  if (priceDiff > 0.001) {
    return next(
      new ApiError(
        "قيمة الكود لا تكفي لشحن الباقة. قم بمراسلة الدعم.",
        400
      )
    );
  }

  // Get or create user wallet
  let wallet = await Wallet.getUserWallet(req.user._id);
  if (!wallet) {
    wallet = await Wallet.create({
      user: req.user._id,
      walletType: "user",
      balance: 0,
      currency: rechargeCode.currency,
    });
  }

  // Add credit to wallet
  await wallet.addCredit(rechargeCode.amount, `Recharge code: ${rechargeCode.code}`, null);

  // Use the code
  await rechargeCode.useCode(req.user._id);

  // Create transaction record
  const transaction = await Transaction.create({
    wallet: wallet._id,
    user: req.user._id,
    type: "recharge_code",
    amount: rechargeCode.amount,
    currency: rechargeCode.currency,
    description: `Used recharge code: ${rechargeCode.code}`,
    rechargeCode: rechargeCode._id,
    status: "completed",
  });

  // تفعيل الاشتراك حسب الباقة المختارة (مدة ونوع الباقة)
  try {
    const user = await User.findById(req.user._id);
    if (user && subscription) {
      user.isSubscribed = true;
      const now = new Date();
      const durationDays = subscription.durationDays || 30;
      user.subscriptionEndDate = new Date(
        now.getTime() + durationDays * 24 * 60 * 60 * 1000
      );
      user.subscriptionPackage = subscription.packageType;
      await user.save();
    }
  } catch (err) {
    console.error("Error granting subscription after recharge code:", err);
  }

  res.status(200).json({
    status: "success",
    message: `Successfully added ${rechargeCode.amount} ${rechargeCode.currency} to your wallet`,
    data: {
      wallet,
      transaction,
    },
  });
});

// @desc    Get recharge codes statistics
// @route   GET /api/v1/admins/recharge-codes/stats
// @access  Private/Admin
exports.getRechargeStats = asyncHandler(async (req, res) => {
  const totalCodes = await RechargeCode.countDocuments();
  const activeCodes = await RechargeCode.countDocuments({ status: "active" });
  const usedCodes = await RechargeCode.countDocuments({ status: "used" });
  const expiredCodes = await RechargeCode.countDocuments({ status: "expired" });

  const totalValue = await RechargeCode.aggregate([
    { $match: { status: { $in: ["active", "used"] } } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const usedValue = await RechargeCode.aggregate([
    { $match: { status: "used" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const recentCodes = await RechargeCode.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("createdBy", "name")
    .populate("usedBy", "name");

  res.status(200).json({
    status: "success",
    data: {
      totalCodes,
      activeCodes,
      usedCodes,
      expiredCodes,
      totalValue: totalValue.length > 0 ? totalValue[0].total : 0,
      usedValue: usedValue.length > 0 ? usedValue[0].total : 0,
      recentCodes,
    },
  });
});

// @desc    Export recharge codes
// @route   GET /api/v1/admins/recharge-codes/export
// @access  Private/Admin
exports.exportRechargeCodes = asyncHandler(async (req, res) => {
  const codes = await RechargeCode.find({
    status: { $in: ["active", "used"] }
  })
    .sort({ createdAt: -1 })
    .populate("createdBy", "name")
    .populate("usedBy", "name");

  const csvData = codes.map(code => ({
    code: code.code,
    amount: code.amount,
    currency: code.currency,
    status: code.status,
    createdAt: code.createdAt,
    expiresAt: code.expiresAt,
    usedAt: code.usedAt,
    createdBy: code.createdBy?.name || "Unknown",
    usedBy: code.usedBy?.name || "Not used",
  }));

  res.status(200).json({
    status: "success",
    message: "Recharge codes exported successfully",
    data: csvData,
  });
});
