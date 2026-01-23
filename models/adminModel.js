const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Admin name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
    },
    adminType: {
      type: String,
      enum: ["male", "female", "super"],
      required: [true, "Admin type is required"],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    actionsCount: {
      type: Number,
      default: 0,
    },
    permissions: {
      manageSubscriptions: {
        type: Boolean,
        default: false,
      },
      manageUsers: {
        type: Boolean,
        default: false,
      },
      verifyIdentities: {
        type: Boolean,
        default: false,
      },
      manageAdmins: {
        type: Boolean,
        default: false,
      },
      viewReports: {
        type: Boolean,
        default: false,
      },
      monitorChats: {
        type: Boolean,
        default: false,
      },
      manageBannedWords: {
        type: Boolean,
        default: false,
      },
      manageWallets: {
        type: Boolean,
        default: false,
      },
      manageRechargeCodes: {
        type: Boolean,
        default: false,
      },
      moderateContent: {
        type: Boolean,
        default: false,
      },
    },
    lastLogin: Date,
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: Date,
  },
  { timestamps: true }
);

// Hash password before saving
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Set default permissions based on admin type
adminSchema.pre("save", function (next) {
  if (this.isNew && (!this.permissions || Object.keys(this.permissions).length === 0)) {
    switch (this.adminType) {
      case "super":
        this.permissions = {
          manageSubscriptions: true,
          manageUsers: true,
          verifyIdentities: true,
          manageAdmins: true,
          viewReports: true,
          monitorChats: true,
          manageBannedWords: true,
          manageWallets: true,
          manageRechargeCodes: true,
          moderateContent: true,
        };
        break;
      case "male":
      case "female":
        this.permissions = {
          manageSubscriptions: false,
          manageUsers: false,
          verifyIdentities: true,
          manageAdmins: false,
          viewReports: true,
          monitorChats: true,
          manageBannedWords: false,
          manageWallets: false,
          manageRechargeCodes: false,
          moderateContent: true,
        };
        break;
    }
  }
  next();
});

// Indexes
adminSchema.index({ email: 1 });
adminSchema.index({ adminType: 1 });

// Compare password method
adminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Account lock mechanism
adminSchema.methods.incLoginAttempts = function () {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  if (this.loginAttempts + 1 >= 5 && !this.lockUntil) {
    updates.$set = {
      lockUntil: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
    };
  }

  return this.updateOne(updates);
};

adminSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
    $set: { lastLogin: new Date() },
  });
};

module.exports = mongoose.model("Admin", adminSchema);
