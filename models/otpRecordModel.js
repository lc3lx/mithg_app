const mongoose = require("mongoose");

const otpRecordSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL: حذف السجلات تلقائياً بعد انتهاء الصلاحية
otpRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpRecordSchema.index({ phone: 1, createdAt: -1 });

module.exports = mongoose.model("OtpRecord", otpRecordSchema);
