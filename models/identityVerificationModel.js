const mongoose = require("mongoose");

const identityVerificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "User is required"],
    },
    adminType: {
      type: String,
      enum: ["male", "female"],
      required: [true, "Admin type is required"],
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    documents: [
      {
        type: {
          type: String,
          enum: ["id_card", "passport", "driving_license", "selfie"],
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
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
  },
  { timestamps: true }
);

// Prevent duplicate pending requests for the same user
identityVerificationSchema.index(
  { user: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);

// Only one active verification request per user
identityVerificationSchema.pre("save", async function (next) {
  if (this.isNew && this.status === "pending") {
    const existingPending = await this.constructor.findOne({
      user: this.user,
      status: "pending",
    });

    if (existingPending) {
      return next(new Error("User already has a pending verification request"));
    }
  }
  next();
});

// Populate user when querying
identityVerificationSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name email gender profileImg phone",
  }).populate({
    path: "reviewedBy",
    select: "name email adminType",
  });
  next();
});

module.exports = mongoose.model(
  "IdentityVerification",
  identityVerificationSchema
);
