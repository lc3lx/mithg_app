const mongoose = require("mongoose");

const rechargeRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    currency: {
      type: String,
      enum: ["SAR", "USD", "EUR", "AED"],
      default: "SAR",
    },
    method: {
      type: String,
      enum: ["bank_transfer", "cash", "other"],
      default: "bank_transfer",
    },
    proof: {
      // optional link or text describing proof
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    adminHandledBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },
    handledAt: Date,
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

rechargeRequestSchema.index({ status: 1 });
rechargeRequestSchema.index({ user: 1 });

rechargeRequestSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name email",
  }).populate({
    path: "adminHandledBy",
    select: "name email",
  });
  next();
});

module.exports = mongoose.model("RechargeRequest", rechargeRequestSchema);


