const asyncHandler = require("express-async-handler");

const UserWarnings = require("../models/userWarningsModel");
const BannedWords = require("../models/bannedWordsModel");
const User = require("../models/userModel");
const PaymentRequest = require("../models/paymentRequestModel");
const RechargeRequest = require("../models/rechargeRequestModel");
const Transaction = require("../models/transactionModel");
const UserReport = require("../models/userReportModel");

// @desc    Get reports summary for admin
// @route   GET /api/v1/admins/reports
// @access  Private/Admin (viewReports permission)
exports.getReportsSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(now);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  startOfWeek.setHours(0, 0, 0, 0);

  const [
    totalViolations,
    todayViolations,
    bannedWordsCount,
    blockedUsers,
    totalLast7Days,
    totalUsers,
    subscribedUsers,
    verifiedUsers,
    subscribedNotVerified,
    totalPaymentRequests,
    pendingPaymentRequests,
    approvedPaymentRequests,
    rejectedPaymentRequests,
    totalRechargeRequests,
    pendingRechargeRequests,
    approvedRechargeRequests,
    rejectedRechargeRequests,
  ] = await Promise.all([
    UserWarnings.countDocuments(),
    UserWarnings.countDocuments({ createdAt: { $gte: startOfDay } }),
    BannedWords.countDocuments(),
    User.countDocuments({ isBlocked: true }),
    UserWarnings.countDocuments({ createdAt: { $gte: startOfWeek } }),
    User.countDocuments(),
    User.countDocuments({ isSubscribed: true }),
    User.countDocuments({ identityVerified: true }),
    User.countDocuments({ isSubscribed: true, identityVerified: false }),
    PaymentRequest.countDocuments(),
    PaymentRequest.countDocuments({ status: "pending" }),
    PaymentRequest.countDocuments({ status: "approved" }),
    PaymentRequest.countDocuments({ status: "rejected" }),
    RechargeRequest.countDocuments(),
    RechargeRequest.countDocuments({ status: "pending" }),
    RechargeRequest.countDocuments({ status: "approved" }),
    RechargeRequest.countDocuments({ status: "rejected" }),
  ]);

  // Top violator
  let topViolator = "غير محدد";
  const topViolatorAgg = await UserWarnings.aggregate([
    { $group: { _id: "$user", count: { $sum: 1 }, lastViolation: { $max: "$createdAt" } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]);
  if (topViolatorAgg.length > 0 && topViolatorAgg[0]._id) {
    const topUser = await User.findById(topViolatorAgg[0]._id).select("name");
    if (topUser) topViolator = topUser.name || "غير محدد";
  }

  // Latest violations list
  const warnings = await UserWarnings.find()
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("user", "name")
    .populate("bannedWord", "word")
    .populate("violatedMessage", "content");

  const violations = warnings.map((warning) => ({
    userId: warning.user?._id,
    userName: warning.user?.name || "غير معروف",
    violationType:
      warning.warningType === "banned_word"
        ? "banned_words"
        : warning.warningType || "other",
    bannedWord: warning.bannedWord?.word || null,
    message:
      warning.violatedMessage?.content ||
      warning.warningMessage ||
      "محتوى غير معروف",
    timestamp: warning.createdAt,
    severity: warning.severity || "medium",
  }));

  // Banned words stats map
  const bannedWords = await BannedWords.find({ violationCount: { $gt: 0 } })
    .select("word violationCount")
    .sort({ violationCount: -1 })
    .limit(50);

  const bannedWordsStats = bannedWords.reduce((acc, item) => {
    acc[item.word] = item.violationCount || 0;
    return acc;
  }, {});

  const avgViolationsPerDay =
    totalLast7Days > 0 ? Number((totalLast7Days / 7).toFixed(1)) : 0;

  // Revenue aggregates
  const approvedPaymentsAgg = await PaymentRequest.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalRevenue =
    approvedPaymentsAgg.length > 0 ? approvedPaymentsAgg[0].total : 0;

  const approvedRechargeAgg = await RechargeRequest.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalRechargeAmount =
    approvedRechargeAgg.length > 0 ? approvedRechargeAgg[0].total : 0;

  const subscriptionPaymentsAgg = await Transaction.aggregate([
    { $match: { type: "subscription_payment", status: "completed" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const totalSubscriptionPayments =
    subscriptionPaymentsAgg.length > 0 ? subscriptionPaymentsAgg[0].total : 0;

  // Top payers (approved payment requests)
  const topPayersAgg = await PaymentRequest.aggregate([
    { $match: { status: "approved" } },
    { $group: { _id: "$user", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: 5 },
  ]);
  const topPayerIds = topPayersAgg.map((p) => p._id);
  const topPayerUsers = await User.find({ _id: { $in: topPayerIds } }).select(
    "name"
  );
  const topPayers = topPayersAgg.map((p) => {
    const user = topPayerUsers.find((u) => u._id.toString() === p._id.toString());
    return {
      userId: p._id,
      name: user?.name || "غير معروف",
      totalAmount: p.total || 0,
      paymentsCount: p.count || 0,
    };
  });

  res.status(200).json({
    data: {
      stats: {
        totalViolations,
        todayViolations,
        bannedWordsCount,
        topViolator,
        avgViolationsPerDay,
        blockedUsers,
        totalUsers,
        subscribedUsers,
        unsubscribedUsers: totalUsers - subscribedUsers,
        verifiedUsers,
        unverifiedUsers: totalUsers - verifiedUsers,
        subscribedNotVerified,
        totalPaymentRequests,
        pendingPaymentRequests,
        approvedPaymentRequests,
        rejectedPaymentRequests,
        totalRevenue,
        totalRechargeRequests,
        pendingRechargeRequests,
        approvedRechargeRequests,
        rejectedRechargeRequests,
        totalRechargeAmount,
        totalSubscriptionPayments,
      },
      violations,
      bannedWordsStats,
      topPayers,
    },
  });
});

// @desc    Get user reports list for admin
// @route   GET /api/v1/admins/user-reports
// @access  Private/Admin (viewReports permission)
exports.getUserReports = asyncHandler(async (req, res) => {
  const reports = await UserReport.find()
    .populate("reporter", "name email profileImg")
    .populate("reportedUser", "name email profileImg")
    .sort({ createdAt: -1 });

  res.status(200).json({
    results: reports.length,
    data: reports,
  });
});

