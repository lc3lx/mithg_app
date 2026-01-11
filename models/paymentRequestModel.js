const mongoose = require("mongoose");

const paymentRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    subscription: {
      type: mongoose.Schema.ObjectId,
      ref: "Subscription",
      required: [true, "Subscription is required"],
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    currency: {
      type: String,
      default: "USD",
      enum: ["USD", "EUR", "SAR", "AED"],
    },
    paymentInstructions: {
      type: String,
      required: [true, "Payment instructions are required"],
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    reviewedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },
    reviewNotes: {
      type: String,
      trim: true,
    },
    reviewedAt: Date,
    rejectionReason: {
      type: String,
      trim: true,
    },
    paymentMethod: {
      type: String,
      enum: ["bank_transfer", "cash", "online_payment", "other"],
      default: "bank_transfer",
    },
    transactionReference: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// One pending request per user per subscription
paymentRequestSchema.index(
  { user: 1, subscription: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);

// Populate related data
paymentRequestSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name email phone",
  })
    .populate({
      path: "subscription",
      select: "name packageType price currency durationDays",
    })
    .populate({
      path: "reviewedBy",
      select: "name email adminType",
    });
  next();
});

module.exports = mongoose.model("PaymentRequest", paymentRequestSchema);
