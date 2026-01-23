const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");
const User = require("../models/userModel");

// @desc    Get all wallets (Admin only)
// @route   GET /api/v1/admins/wallets
// @access  Private/Admin
exports.getWallets = asyncHandler(async (req, res) => {
  const features = new ApiFeatures(
    Wallet.find().sort({ createdAt: -1 }),
    req.query
  )
    .filter()
    .sort()
    .limitFields()
    .paginate(await Wallet.countDocuments());

  const wallets = await features.mongooseQuery;

  res.status(200).json({
    status: "success",
    results: wallets.length,
    data: wallets,
  });
});

// @desc    Get app wallet
// @route   GET /api/v1/admins/wallets/app
// @access  Private/Admin
exports.getAppWallet = asyncHandler(async (req, res) => {
  const wallet = await Wallet.getAppWallet();

  if (!wallet) {
    return res.status(404).json({
      status: "error",
      message: "App wallet not found",
    });
  }

  res.status(200).json({
    status: "success",
    data: wallet,
  });
});

// @desc    Get user wallet
// @route   GET /api/v1/admins/wallets/user/:userId
// @access  Private/Admin
exports.getUserWallet = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const wallet = await Wallet.getUserWallet(userId);

  if (!wallet) {
    return res.status(404).json({
      status: "error",
      message: "User wallet not found",
    });
  }

  res.status(200).json({
    status: "success",
    data: wallet,
  });
});

// @desc    Create app wallet if not exists
// @route   POST /api/v1/admins/wallets/app
// @access  Private/Admin
exports.createAppWallet = asyncHandler(async (req, res) => {
  const existingWallet = await Wallet.getAppWallet();

  if (existingWallet) {
    return res.status(400).json({
      status: "error",
      message: "App wallet already exists",
    });
  }

  const wallet = await Wallet.create({
    walletType: "app",
    balance: 0,
    currency: "SAR",
  });

  res.status(201).json({
    status: "success",
    data: wallet,
  });
});

// @desc    Create user wallet if not exists
// @route   POST /api/v1/admins/wallets/user/:userId
// @access  Private/Admin
exports.createUserWallet = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const user = await User.findById(userId);
  if (!user) {
    return res.status(404).json({
      status: "error",
      message: "User not found",
    });
  }

  const existingWallet = await Wallet.getUserWallet(userId);
  if (existingWallet) {
    return res.status(400).json({
      status: "error",
      message: "User wallet already exists",
    });
  }

  const wallet = await Wallet.create({
    user: userId,
    walletType: "user",
    balance: 0,
    currency: "SAR",
  });

  res.status(201).json({
    status: "success",
    data: wallet,
  });
});

// @desc    Add credit to wallet (Admin action)
// @route   PUT /api/v1/admins/wallets/:id/credit
// @access  Private/Admin
exports.addCredit = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, description, paymentMethod, reference } = req.body;

  if (!amount || amount <= 0) {
    return next(new ApiError("Valid amount is required", 400));
  }

  const wallet = await Wallet.findById(id);
  if (!wallet) {
    return next(new ApiError("Wallet not found", 404));
  }

  // Add credit to wallet
  await wallet.addCredit(amount, description || "Admin credit", reference);

  // Create transaction record
  const transaction = await Transaction.create({
    wallet: wallet._id,
    user: wallet.user,
    type: "credit",
    amount,
    currency: wallet.currency,
    description: description || "Admin credit",
    reference,
    paymentMethod: paymentMethod || "admin_adjustment",
    admin: req.admin._id,
    adminNotes: "Added by admin",
  });

  res.status(200).json({
    status: "success",
    message: `Added ${amount} ${wallet.currency} to wallet`,
    data: {
      wallet,
      transaction,
    },
  });
});

// @desc    Add debit to wallet (Admin action)
// @route   PUT /api/v1/admins/wallets/:id/debit
// @access  Private/Admin
exports.addDebit = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { amount, description, reference } = req.body;

  if (!amount || amount <= 0) {
    return next(new ApiError("Valid amount is required", 400));
  }

  const wallet = await Wallet.findById(id);
  if (!wallet) {
    return next(new ApiError("Wallet not found", 404));
  }

  if (wallet.balance < amount) {
    return next(new ApiError("Insufficient balance", 400));
  }

  // Add debit to wallet
  await wallet.addDebit(amount, description || "Admin debit", reference);

  // Create transaction record
  const transaction = await Transaction.create({
    wallet: wallet._id,
    user: wallet.user,
    type: "debit",
    amount,
    currency: wallet.currency,
    description: description || "Admin debit",
    reference,
    admin: req.admin._id,
    adminNotes: "Deducted by admin",
  });

  res.status(200).json({
    status: "success",
    message: `Deducted ${amount} ${wallet.currency} from wallet`,
    data: {
      wallet,
      transaction,
    },
  });
});

// @desc    Transfer between wallets
// @route   POST /api/v1/admins/wallets/transfer
// @access  Private/Admin
exports.transferBetweenWallets = asyncHandler(async (req, res, next) => {
  const { fromWalletId, toWalletId, amount, description } = req.body;

  if (!amount || amount <= 0) {
    return next(new ApiError("Valid amount is required", 400));
  }

  const fromWallet = await Wallet.findById(fromWalletId);
  const toWallet = await Wallet.findById(toWalletId);

  if (!fromWallet || !toWallet) {
    return next(new ApiError("Wallet not found", 404));
  }

  if (fromWallet.balance < amount) {
    return next(new ApiError("Insufficient balance in source wallet", 400));
  }

  // Perform transfer
  await fromWallet.addDebit(amount, description || "Transfer out", null);
  await toWallet.addCredit(amount, description || "Transfer in", null);

  // Create transaction records
  const debitTransaction = await Transaction.create({
    wallet: fromWallet._id,
    user: fromWallet.user,
    type: "transfer_out",
    amount,
    currency: fromWallet.currency,
    description: description || "Transfer out",
    recipientWallet: toWallet._id,
    admin: req.admin._id,
  });

  const creditTransaction = await Transaction.create({
    wallet: toWallet._id,
    user: toWallet.user,
    type: "transfer_in",
    amount,
    currency: toWallet.currency,
    description: description || "Transfer in",
    admin: req.admin._id,
  });

  res.status(200).json({
    status: "success",
    message: `Transferred ${amount} ${fromWallet.currency} successfully`,
    data: {
      fromWallet,
      toWallet,
      transactions: [debitTransaction, creditTransaction],
    },
  });
});

// @desc    Get wallet transactions
// @route   GET /api/v1/admins/wallets/:id/transactions
// @access  Private/Admin
exports.getWalletTransactions = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const transactions = await Transaction.getWalletTransactions(id, req.query.limit);

  res.status(200).json({
    status: "success",
    results: transactions.length,
    data: transactions,
  });
});

// @desc    Get wallet statistics
// @route   GET /api/v1/admins/wallets/stats
// @access  Private/Admin
exports.getWalletStats = asyncHandler(async (req, res) => {
  const totalWallets = await Wallet.countDocuments();
  const activeWallets = await Wallet.countDocuments({ isActive: true });
  const userWallets = await Wallet.countDocuments({ walletType: "user" });
  const appWallets = await Wallet.countDocuments({ walletType: "app" });

  const totalBalance = await Wallet.aggregate([
    { $group: { _id: null, total: { $sum: "$balance" } } },
  ]);

  const recentTransactions = await Transaction.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("wallet", "walletType")
    .populate("user", "name");

  res.status(200).json({
    status: "success",
    data: {
      totalWallets,
      activeWallets,
      userWallets,
      appWallets,
      totalBalance: totalBalance.length > 0 ? totalBalance[0].total : 0,
      recentTransactions,
    },
  });
});
