const mongoose = require("mongoose");

const userWarningsSchema = new mongoose.Schema(
  {
    // User who received the warning
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },

    // Warning details
    warningType: {
      type: String,
      enum: [
        "banned_word",
        "inappropriate_content",
        "harassment",
        "spam",
        "other",
      ],
      default: "banned_word",
    },

    // Severity level (inherited from banned word or set manually)
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    // The banned word that triggered this warning
    bannedWord: {
      type: mongoose.Schema.ObjectId,
      ref: "BannedWords",
    },

    // The message that contained the violation
    violatedMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },

    // Chat where the violation occurred
    chat: {
      type: mongoose.Schema.ObjectId,
      ref: "Chat",
    },

    // Warning message shown to user
    warningMessage: {
      type: String,
      trim: true,
      required: [true, "Warning message is required"],
    },

    // Admin who issued the warning (can be automatic or manual)
    issuedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },

    // Was this warning issued automatically?
    isAutomatic: {
      type: Boolean,
      default: true,
    },

    // Warning status
    status: {
      type: String,
      enum: ["active", "appealed", "resolved", "expired"],
      default: "active",
    },

    // Appeal details
    appealReason: {
      type: String,
      trim: true,
    },

    appealResponse: {
      type: String,
      trim: true,
    },

    appealedAt: Date,

    appealedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },

    // Expiration date for the warning
    expiresAt: {
      type: Date,
      default: function () {
        const date = new Date();
        date.setDate(date.getDate() + 30); // 30 days default
        return date;
      },
    },

    // Additional notes
    notes: {
      type: String,
      trim: true,
    },

    // Statistics for the user
    userWarningCount: {
      type: Number,
      default: 1,
    },

    // Should this warning lead to blocking?
    leadsToBlock: {
      type: Boolean,
      default: false,
    },

    // Block details (if applicable)
    blockDurationHours: {
      type: Number,
      min: [1, "Block duration must be at least 1 hour"],
    },

    blockReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes for performance
userWarningsSchema.index({ user: 1, createdAt: -1 });
userWarningsSchema.index({ status: 1 });
userWarningsSchema.index({ expiresAt: 1 });
userWarningsSchema.index({ warningType: 1 });
userWarningsSchema.index({ severity: 1 });

// Pre-save middleware to set expiration based on severity
userWarningsSchema.pre("save", function (next) {
  if (this.isNew) {
    const now = new Date();

    // Set expiration based on severity
    switch (this.severity) {
      case "low":
        this.expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
        break;
      case "medium":
        this.expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        break;
      case "high":
        this.expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
        break;
      case "critical":
        this.expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
        break;
    }
  }
  next();
});

// Static method to get active warnings for a user
userWarningsSchema.statics.getActiveWarnings = function (userId) {
  return this.find({
    user: userId,
    status: "active",
    expiresAt: { $gt: new Date() },
  });
};

// Static method to count warnings for a user in a time period
userWarningsSchema.statics.getWarningCount = function (userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.countDocuments({
    user: userId,
    createdAt: { $gte: startDate },
    status: { $ne: "expired" },
  });
};

// Static method to check if user should be blocked
userWarningsSchema.statics.shouldBlockUser = async function (
  userId,
  bannedWord
) {
  const warningCount = await this.getWarningCount(userId, 30); // Last 30 days
  return warningCount >= bannedWord.autoBlockThreshold;
};

// Instance method to resolve the warning
userWarningsSchema.methods.resolve = function (adminId, resolutionNotes) {
  this.status = "resolved";
  this.appealedBy = adminId;
  this.appealResponse = resolutionNotes;
  return this.save();
};

// Instance method to appeal the warning
userWarningsSchema.methods.appeal = function (reason) {
  this.status = "appealed";
  this.appealReason = reason;
  this.appealedAt = new Date();
  return this.save();
};

// Instance method to check if warning is expired
userWarningsSchema.methods.isExpired = function () {
  return new Date() > this.expiresAt;
};

// Populate related data when querying
userWarningsSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name email phone",
  })
    .populate({
      path: "bannedWord",
      select: "word category severity",
    })
    .populate({
      path: "violatedMessage",
      select: "content sender createdAt",
      populate: {
        path: "sender",
        select: "name",
      },
    })
    .populate({
      path: "chat",
      select: "chatType primaryUsers",
    })
    .populate({
      path: "issuedBy",
      select: "name email adminType",
    })
    .populate({
      path: "appealedBy",
      select: "name email adminType",
    });
  next();
});

module.exports = mongoose.model("UserWarnings", userWarningsSchema);
