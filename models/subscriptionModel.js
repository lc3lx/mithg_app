const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    packageType: {
      type: String,
      enum: ["basic", "premium"],
      required: [true, "Package type is required"],
    },
    name: {
      type: String,
      required: [true, "Package name is required"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: [true, "Price is required"],
      min: [0, "Price cannot be negative"],
    },
    currency: {
      type: String,
      default: "USD",
      enum: ["USD", "EUR", "SAR", "AED"],
    },
    durationDays: {
      type: Number,
      required: [true, "Duration in days is required"],
      min: [1, "Duration must be at least 1 day"],
    },
    // ميزات الاشتراك المعروضة للمستخدم (يتحكم بها الأدمن)، مثل: رسائل لا محدودة، إظهار من أعجبك، من زار بروفايلك، فلاتر متقدمة
    features: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    maxUsers: {
      type: Number,
      default: null, // null means unlimited
    },
    currentUsers: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Index for quick lookup
subscriptionSchema.index({ packageType: 1, isActive: 1 });

module.exports = mongoose.model("Subscription", subscriptionSchema);
