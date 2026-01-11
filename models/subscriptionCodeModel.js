const mongoose = require("mongoose");

const subscriptionCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    subscription: {
      type: mongoose.Schema.ObjectId,
      ref: "Subscription",
      required: [true, "Subscription is required"],
    },
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: [true, "Admin who created the code is required"],
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    usedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    usedAt: Date,
    expiresAt: {
      type: Date,
      required: [true, "Expiration date is required"],
    },
    maxUses: {
      type: Number,
      default: 1,
      min: [1, "Max uses must be at least 1"],
    },
    currentUses: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Index for quick lookup
subscriptionCodeSchema.index({ code: 1 });
subscriptionCodeSchema.index({ expiresAt: 1 });
subscriptionCodeSchema.index({ isUsed: 1 });

// Auto-expire codes
subscriptionCodeSchema.methods.isExpired = function () {
  return Date.now() > this.expiresAt;
};

// Check if code can be used
subscriptionCodeSchema.methods.canBeUsed = function () {
  return !this.isUsed && !this.isExpired() && this.currentUses < this.maxUses;
};

// Generate unique code
subscriptionCodeSchema.statics.generateCode = function () {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Populate related data
subscriptionCodeSchema.pre(/^find/, function (next) {
  this.populate({
    path: "subscription",
    select: "name packageType price currency durationDays",
  })
    .populate({
      path: "createdBy",
      select: "name email adminType",
    })
    .populate({
      path: "usedBy",
      select: "name email",
    });
  next();
});

module.exports = mongoose.model("SubscriptionCode", subscriptionCodeSchema);
