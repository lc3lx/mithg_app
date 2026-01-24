const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    playerId: {
      type: String,
      required: [true, "Player ID is required"],
      trim: true,
    },
    platform: {
      type: String,
      enum: ["android", "ios"],
      required: [true, "Platform is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ user: 1, playerId: 1 }, { unique: true });
deviceTokenSchema.index({ user: 1, isActive: 1 });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);

