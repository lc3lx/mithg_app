const mongoose = require("mongoose");

/**
 * كود إحالة - ينشئه الأدمن
 * يعطي خصم بنسبة مئوية للمشترك الجديد لمرة واحدة فقط
 */
const referralCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Code is required"],
      unique: true,
      uppercase: true,
      trim: true,
      minlength: [4, "Code must be at least 4 characters"],
      maxlength: [32, "Code cannot exceed 32 characters"],
    },
    discountPercent: {
      type: Number,
      required: [true, "Discount percentage is required"],
      min: [1, "Discount must be at least 1%"],
      max: [100, "Discount cannot exceed 100%"],
    },
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: [true, "Admin who created the code is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
      default: null,
      // null = لا ينتهي
    },
    maxUses: {
      type: Number,
      default: null,
      min: [1, "Max uses must be at least 1"],
      // null = استخدامات غير محدودة
    },
    currentUses: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [200, "Description cannot exceed 200 characters"],
    },
  },
  { timestamps: true }
);

referralCodeSchema.index({ code: 1 });
referralCodeSchema.index({ isActive: 1 });
referralCodeSchema.index({ expiresAt: 1 });

referralCodeSchema.methods.isExpired = function () {
  if (!this.expiresAt) return false;
  return Date.now() > this.expiresAt;
};

referralCodeSchema.methods.canBeUsed = function () {
  if (!this.isActive) return false;
  if (this.isExpired()) return false;
  if (this.maxUses != null && this.currentUses >= this.maxUses) return false;
  return true;
};

referralCodeSchema.statics.generateCode = function (length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

referralCodeSchema.pre(/^find/, function (next) {
  this.populate({
    path: "createdBy",
    select: "name email adminType",
  });
  next();
});

module.exports = mongoose.model("ReferralCode", referralCodeSchema);
