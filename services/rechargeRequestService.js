const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const RechargeRequest = require("../models/rechargeRequestModel");
const User = require("../models/userModel");
const Wallet = require("../models/walletModel");
const Transaction = require("../models/transactionModel");

// @desc    Create a recharge request (user)
// @route   POST /api/v1/recharge-requests
// @access  Private/User
exports.createRechargeRequest = asyncHandler(async (req, res, next) => {
  const { amount, currency, method, proof, notes } = req.body;
  if (!amount || amount <= 0) {
    return next(new ApiError("يجب أن يتم توفير المبلغ المطلوب", 400));
  }

  const request = await RechargeRequest.create({
    user: req.user._id,
    amount,
    currency: currency || "SAR",
    method: method || "bank_transfer",
    proof,
    notes,
  });

  res.status(201).json({
    status: "success",
    data: request,
  });
});

// @desc    Get my recharge requests (user)
// @route   GET /api/v1/recharge-requests/my
// @access  Private/User
exports.getMyRechargeRequests = asyncHandler(async (req, res) => {
  const requests = await RechargeRequest.find({ user: req.user._id }).sort({
    createdAt: -1,
  });
  res
    .status(200)
    .json({ status: "success", results: requests.length, data: requests });
});

// @desc    Get all recharge requests (admin)
// @route   GET /api/v1/admins/recharge-requests
// @access  Private/Admin
exports.getAllRechargeRequests = asyncHandler(async (req, res) => {
  const requests = await RechargeRequest.find().sort({ createdAt: -1 });
  res
    .status(200)
    .json({ status: "success", results: requests.length, data: requests });
});

// @desc    Approve recharge request (admin)
// @route   PUT /api/v1/admins/recharge-requests/:id/approve
// @access  Private/Admin
exports.approveRechargeRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const updateFields = {
      status: "approved",
      adminHandledBy: req.admin._id,
      handledAt: new Date(),
    };
    if (req.body.notes !== undefined) {
      updateFields.notes = req.body.notes;
    }

    const request = await RechargeRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      updateFields,
      { new: true, session },
    );

    if (!request) {
      await session.abortTransaction();
      session.endSession();
      return next(
        new ApiError("لا يوجد طلب شحن لهذا المعرف أو تمت معالجته مسبقاً", 404),
      );
    }

    const user = await User.findById(request.user).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return next(new ApiError("لا يوجد مستخدم لهذا المعرف", 404));
    }

    user.isSubscribed = true;
    user.subscriptionPackage = user.subscriptionPackage || "premium";
    const now = new Date();
    user.subscriptionEndDate = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    await user.save({ session });

    let appWallet = await Wallet.findOne({
      walletType: "app",
      isActive: true,
    }).session(session);
    if (!appWallet) {
      const created = await Wallet.create(
        [
          {
            walletType: "app",
            balance: 0,
            currency: request.currency || "SAR",
          },
        ],
        { session },
      );
      appWallet = created[0];
    }

    await Wallet.findByIdAndUpdate(
      appWallet._id,
      {
        $inc: {
          balance: request.amount,
          totalCredits: request.amount,
        },
      },
      { session },
    );

    const [transaction] = await Transaction.create(
      [
        {
          wallet: appWallet._id,
          user: user._id,
          type: "subscription_payment",
          amount: request.amount,
          currency: request.currency || "SAR",
          description: `Manual recharge approved: ${request._id}`,
          status: "completed",
          admin: req.admin._id,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: "success",
      message: "Recharge request approved",
      data: { request, transaction },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return next(err);
  }
});

// @desc    Reject recharge request (admin)
// @route   PUT /api/v1/admins/recharge-requests/:id/reject
// @access  Private/Admin
exports.rejectRechargeRequest = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const request = await RechargeRequest.findById(id);
  if (!request) return next(new ApiError("Recharge request not found", 404));
  if (request.status !== "pending")
    return next(new ApiError("Request already handled", 400));

  request.status = "rejected";
  request.adminHandledBy = req.admin._id;
  request.handledAt = new Date();
  request.notes = req.body.notes || request.notes;
  await request.save();

  res.status(200).json({
    status: "success",
    message: "Recharge request rejected",
    data: request,
  });
});
