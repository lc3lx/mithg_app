const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // Basic Info
    name: {
      type: String,
      trim: true,
      required: [true, "name required"],
      minlength: [2, "Name too short"],
      maxlength: [50, "Name too long"],
    },
    username: {
      type: String,
      trim: true,
      unique: true,
      minlength: [3, "Username too short"],
      maxlength: [30, "Username too long"],
    },
    email: {
      type: String,
      required: [true, "email required"],
      unique: true,
      lowercase: true,
    },
    slug: {
      type: String,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number required"],
      unique: true,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerificationCode: String,
    phoneVerificationExpires: Date,

    // Profile Info
    age: {
      type: Number,
      min: [18, "Must be at least 18 years old"],
      max: [80, "Invalid age"],
    },
    gender: {
      type: String,
      enum: ["male", "female"],
      default: "male",
      required: [true, "Gender is required"],
    },

    country: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    nationality: {
      type: String,
      trim: true,
    },
    educationalLevel: {
      type: String,
      trim: true,
    },
    fieldOfWork: {
      type: String,
      trim: true,
    },
    socialStatus: {
      type: String,
      enum: ["single", "married", "divorced", "widowed"],
      default: "single",
    },
    religion: {
      type: String,
      trim: true,
      default: "Muslim",
    },
    hijab: {
      type: Boolean,
      default: false,
    },
    havingChildren: {
      type: Boolean,
      default: false,
    },
    desire: {
      type: String,
      trim: true,
    },
    polygamy: {
      type: Boolean,
      default: false,
    },
    smoking: {
      type: Boolean,
      default: false,
    },
    hairColor: {
      type: String,
      trim: true,
    },
    height: {
      type: Number, // in cm
      min: 100,
      max: 250,
    },
    weight: {
      type: Number, // in kg
      min: 30,
      max: 200,
    },
    profileImg: String,
    coverImg: String,

    // Gallery - صور وفيديوهات المستخدم
    gallery: [
      {
        type: {
          type: String,
          enum: ["image", "video"],
          default: "image",
        },
        url: {
          type: String,
          required: true,
        },
        caption: {
          type: String,
          maxlength: [200, "Caption too long"],
          trim: true,
        },
        isPrimary: {
          type: Boolean,
          default: false,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // About section - نبذة عن المستخدم
    about: {
      type: String,
      maxlength: [100, "About section too long"],
      trim: true,
    },

    // Social Status
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },

    // Authentication
    password: {
      type: String,
      required: [true, "password required"],
      minlength: [6, "Too short password"],
    },
    passwordChangedAt: Date,
    passwordResetCode: String,
    passwordResetExpires: Date,
    passwordResetVerified: Boolean,

    // Account Status
    active: {
      type: Boolean,
      default: true,
    },

    // Subscription Status
    isSubscribed: {
      type: Boolean,
      default: false,
    },
    subscriptionEndDate: Date,
    subscriptionPackage: {
      type: String,
      enum: ["1month", "3months", "6months"],
    },

    // Message Statistics
    messageCount: {
      type: Number,
      default: 0,
    },

    // User Role
    role: {
      type: String,
      enum: ["user", "admin", "manager"],
      default: "user",
    },

    // Identity Verification
    identityVerified: {
      type: Boolean,
      default: false,
    },
    identityVerificationStatus: {
      type: String,
      enum: ["new", "pending", "approved", "rejected"],
      default: "new",
    },
    identityVerificationSubmitted: {
      type: Boolean,
      default: false,
    },
    identityVerificationDocuments: [
      {
        type: {
          type: String,
          enum: ["id_card", "passport", "driving_license"],
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

    // Relationships - will be populated with friends, guardians, and blocked users
    friends: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    friendRequests: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    sentFriendRequests: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    guardians: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Guardian",
      },
    ],
    blockedUsers: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    favorites: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],

    // Moderation fields
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedUntil: Date,
    blockReason: {
      type: String,
      trim: true,
    },
    blockedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
    },
    warningCount: {
      type: Number,
      default: 0,
    },
    lastWarning: Date,

    // Activity tracking
    profileViews: {
      type: Number,
      default: 0,
    },
    likesReceived: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // Hashing user password
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Virtual populate for sent messaging requests
userSchema.virtual("sentMessagingRequests", {
  ref: "MessagingRequest",
  foreignField: "sender",
  localField: "_id",
});

// Virtual populate for received messaging requests
userSchema.virtual("receivedMessagingRequests", {
  ref: "MessagingRequest",
  foreignField: "receiver",
  localField: "_id",
});

// Virtual populate for chats
userSchema.virtual("chats", {
  ref: "Chat",
  foreignField: "participants",
  localField: "_id",
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ gender: 1, age: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ location: 1 });

// Set image URLs
userSchema.post("init", (doc) => {
  if (doc.profileImg && !doc.profileImg.startsWith("http")) {
    const imageUrl = `${process.env.BASE_URL}/uploads/users/${doc.profileImg}`;
    doc.profileImg = imageUrl;
  }
  if (doc.coverImg && !doc.coverImg.startsWith("http")) {
    const imageUrl = `${process.env.BASE_URL}/uploads/users/${doc.coverImg}`;
    doc.coverImg = imageUrl;
  }
});

userSchema.post("save", (doc) => {
  if (doc.profileImg && !doc.profileImg.startsWith("http")) {
    const imageUrl = `${process.env.BASE_URL}/uploads/users/${doc.profileImg}`;
    doc.profileImg = imageUrl;
  }
  if (doc.coverImg && !doc.coverImg.startsWith("http")) {
    const imageUrl = `${process.env.BASE_URL}/uploads/users/${doc.coverImg}`;
    doc.coverImg = imageUrl;
  }
});

const User = mongoose.model("User", userSchema);

module.exports = User;
