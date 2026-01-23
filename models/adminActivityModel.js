const mongoose = require("mongoose");

const adminActivitySchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    targetType: {
      type: String,
      trim: true,
    },
    targetId: {
      type: mongoose.Schema.ObjectId,
    },
    details: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

adminActivitySchema.index({ admin: 1, createdAt: -1 });
adminActivitySchema.index({ action: 1 });

module.exports = mongoose.model("AdminActivity", adminActivitySchema);

