const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      // null for app wallet
    },
    balance: {
      type: Number,
      required: [true, "Balance is required"],
      default: 0,
      min: [0, "Balance cannot be negative"],
    },
    currency: {
      type: String,
      enum: ["SAR", "USD", "EUR", "AED"],
      default: "SAR",
    },
    walletType: {
      type: String,
      enum: ["user", "app"],
      required: [true, "Wallet type is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastTransaction: {
      type: mongoose.Schema.ObjectId,
      ref: "Transaction",
    },
    totalCredits: {
      type: Number,
      default: 0,
    },
    totalDebits: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Indexes
walletSchema.index({ user: 1, walletType: 1 });
walletSchema.index({ walletType: 1 });

// Virtual for formatted balance
walletSchema.virtual("formattedBalance").get(function () {
  return `${this.balance.toFixed(2)} ${this.currency}`;
});

// Static method to get app wallet
walletSchema.statics.getAppWallet = function () {
  return this.findOne({ walletType: "app", isActive: true });
};

// Static method to get user wallet
walletSchema.statics.getUserWallet = function (userId) {
  return this.findOne({ user: userId, walletType: "user", isActive: true });
};

// Instance method to add credit
walletSchema.methods.addCredit = function (amount, description, reference) {
  this.balance += amount;
  this.totalCredits += amount;
  return this.save();
};

// Instance method to add debit
walletSchema.methods.addDebit = function (amount, description, reference) {
  if (this.balance < amount) {
    throw new Error("Insufficient balance");
  }
  this.balance -= amount;
  this.totalDebits += amount;
  return this.save();
};

// Populate user data for user wallets
walletSchema.pre(/^find/, function (next) {
  if (this.getQuery().walletType !== "app") {
    this.populate({
      path: "user",
      select: "name email phone",
    });
  }
  next();
});

module.exports = mongoose.model("Wallet", walletSchema);
