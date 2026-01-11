const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const guardianSchema = new mongoose.Schema(
  {
    // Relationship with user
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Guardian must belong to a user"],
    },

    // Guardian details
    relationship: {
      type: String,
      enum: ["mother", "father", "brother", "sister"],
      required: [true, "Relationship type is required"],
    },

    firstName: {
      type: String,
      required: [true, "First name is required"],
      trim: true,
      maxlength: [50, "First name too long"],
    },

    lastName: {
      type: String,
      required: [true, "Last name is required"],
      trim: true,
      maxlength: [50, "Last name too long"],
    },

    phone: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
    },

    dateOfBirth: {
      type: Date,
      required: [true, "Date of birth is required"],
    },

    // Identity verification documents
    identityDocuments: [
      {
        type: {
          type: String,
          enum: ["id_card", "passport", "birth_certificate", "family_card"],
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
        verified: {
          type: Boolean,
          default: false,
        },
      },
    ],

    // Verification status
    identityVerified: {
      type: Boolean,
      default: false,
    },

    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },

    verifiedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },

    verifiedAt: Date,

    rejectionReason: {
      type: String,
      trim: true,
    },

    // QR Code for chat access
    qrCode: {
      type: String,
      unique: true,
    },

    qrCodeExpiresAt: {
      type: Date,
    },

    // Access permissions
    canAccessChats: {
      type: Boolean,
      default: false,
    },

    // Emergency contact info
    emergencyContact: {
      name: String,
      phone: String,
      relationship: String,
    },

    // Status
    isActive: {
      type: Boolean,
      default: true,
    },

    // Access logs
    lastAccess: Date,
    accessCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Indexes
guardianSchema.index({ user: 1, relationship: 1 }, { unique: true });
guardianSchema.index({ phone: 1 });
guardianSchema.index({ qrCode: 1 });
guardianSchema.index({ verificationStatus: 1 });

// Virtual for full name
guardianSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Pre-save middleware to generate QR code
guardianSchema.pre("save", async function (next) {
  if (this.isNew && !this.qrCode) {
    // Generate unique QR code
    const crypto = require("crypto");
    let qrCode;
    let existingGuardian;

    do {
      qrCode = crypto.randomBytes(16).toString("hex").toUpperCase();
      existingGuardian = await this.constructor.findOne({ qrCode });
    } while (existingGuardian);

    this.qrCode = qrCode;

    // Set QR code expiration (1 year from now)
    this.qrCodeExpiresAt = new Date();
    this.qrCodeExpiresAt.setFullYear(this.qrCodeExpiresAt.getFullYear() + 1);
  }
  next();
});

// Populate user when querying
guardianSchema.pre(/^find/, function (next) {
  this.populate({
    path: "user",
    select: "name email phone",
  }).populate({
    path: "verifiedBy",
    select: "name email adminType",
  });
  next();
});

// Static method to generate QR code data
guardianSchema.statics.generateQRCodeData = function (guardianId, qrCode) {
  return JSON.stringify({
    type: "guardian_access",
    guardianId,
    qrCode,
    timestamp: Date.now(),
  });
};

// Instance method to check if QR code is valid
guardianSchema.methods.isQRCodeValid = function () {
  return this.qrCodeExpiresAt > new Date() && this.isActive;
};

// Instance method to log access
guardianSchema.methods.logAccess = function () {
  this.lastAccess = new Date();
  this.accessCount += 1;
  return this.save();
};

module.exports = mongoose.model("Guardian", guardianSchema);
