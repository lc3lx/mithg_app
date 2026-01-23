const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    wallet: {
      type: mongoose.Schema.ObjectId,
      ref: "Wallet",
      required: [true, "Wallet is required"],
    },
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    type: {
      type: String,
      enum: [
        "credit", // إضافة رصيد
        "debit", // سحب رصيد
        "transfer_in", // استلام تحويل
        "transfer_out", // إرسال تحويل
        "subscription_payment", // دفع اشتراك
        "recharge_code", // استخدام كود شحن
        "refund", // استرداد
        "admin_adjustment", // تعديل أدمن
      ],
      required: [true, "Transaction type is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      enum: ["SAR", "USD", "EUR", "AED"],
      default: "SAR",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "cancelled"],
      default: "completed",
    },
    description: {
      type: String,
      required: [true, "Description is required"],
      trim: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    // For transfers
    recipientWallet: {
      type: mongoose.Schema.ObjectId,
      ref: "Wallet",
    },
    // For subscriptions
    subscription: {
      type: mongoose.Schema.ObjectId,
      ref: "Subscription",
    },
    // For recharge codes
    rechargeCode: {
      type: mongoose.Schema.ObjectId,
      ref: "RechargeCode",
    },
    // For admin actions
    admin: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },
    adminNotes: {
      type: String,
      trim: true,
    },
    // Payment method for incoming transactions
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "online_payment", "wallet_transfer", "recharge_code"],
    },
    // External transaction reference
    externalReference: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes
transactionSchema.index({ wallet: 1, createdAt: -1 });
transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ reference: 1 });

// Virtual for formatted amount
transactionSchema.virtual("formattedAmount").get(function () {
  const sign = this.type.includes("out") || this.type === "debit" ? "-" : "+";
  return `${sign}${this.amount.toFixed(2)} ${this.currency}`;
});

// Virtual for transaction direction
transactionSchema.virtual("direction").get(function () {
  if (["credit", "transfer_in", "refund", "recharge_code"].includes(this.type)) {
    return "in";
  } else if (["debit", "transfer_out", "subscription_payment"].includes(this.type)) {
    return "out";
  }
  return "neutral";
});

// Static method to get wallet transactions
transactionSchema.statics.getWalletTransactions = function (walletId, limit = 50) {
  return this.find({ wallet: walletId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("user", "name email")
    .populate("recipientWallet")
    .populate("subscription", "name packageType")
    .populate("rechargeCode", "code")
    .populate("admin", "name");
};

// Static method to get user transactions
transactionSchema.statics.getUserTransactions = function (userId, limit = 50) {
  return this.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("wallet")
    .populate("recipientWallet")
    .populate("subscription", "name packageType")
    .populate("rechargeCode", "code")
    .populate("admin", "name");
};

// Instance method to reverse transaction
transactionSchema.methods.reverse = async function (reason, adminId) {
  if (this.status !== "completed") {
    throw new Error("Only completed transactions can be reversed");
  }

  // Create reverse transaction
  const reverseTransaction = new this.constructor({
    wallet: this.wallet,
    user: this.user,
    type: this.type.includes("out") ? this.type.replace("out", "in") :
          this.type.includes("in") ? this.type.replace("in", "out") :
          this.type === "debit" ? "credit" : "debit",
    amount: this.amount,
    currency: this.currency,
    description: `Reversal: ${this.description}`,
    reference: `REV-${this.reference}`,
    admin: adminId,
    adminNotes: reason,
    status: "completed",
  });

  await reverseTransaction.save();

  // Update original transaction status
  this.status = "cancelled";
  await this.save();

  return reverseTransaction;
};

// Populate related data
transactionSchema.pre(/^find/, function (next) {
  this.populate({
    path: "wallet",
    select: "walletType balance currency",
  })
    .populate({
      path: "user",
      select: "name email",
    })
    .populate({
      path: "recipientWallet",
      select: "walletType balance currency",
    })
    .populate({
      path: "subscription",
      select: "name packageType price",
    })
    .populate({
      path: "rechargeCode",
      select: "code amount",
    })
    .populate({
      path: "admin",
      select: "name email",
    });
  next();
});

module.exports = mongoose.model("Transaction", transactionSchema);
