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
    /** خطوة التسجيل: 0=أنشئ الحساب فقط، 1-5=أكمل الصفحات، 6=تحقق OTP وتم الإكمال */
    registrationStep: {
      type: Number,
      default: 0,
      min: 0,
      max: 6,
    },

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
      type: Number, // in cm (optional)
      validate: {
        validator(v) {
          return v == null || (typeof v === "number" && v >= 100 && v <= 250);
        },
        message: "الطول يجب أن يكون بين 100 و 250 سم أو غير مدخل",
      },
    },
    weight: {
      type: Number, // in kg (optional)
      validate: {
        validator(v) {
          return v == null || (typeof v === "number" && v >= 30 && v <= 200);
        },
        message: "الوزن يجب أن يكون بين 30 و 200 كغ أو غير مدخل",
      },
    },
    bodyShape: {
      type: String,
      trim: true,
    },
    healthProblems: {
      type: String,
      trim: true,
    },

    // صفحة 4.5 - تفضيلات الشريك (مشتركة + خاصة بالبنت/الشاب)
    religiousCommitment: { type: String, trim: true }, // درجة الالتزام الديني
    prayerObservance: { type: String, trim: true }, // المحافظة على الصلاة
    preferredPartnerAgeMin: { type: Number },
    preferredPartnerAgeMax: { type: Number },
    preferredPartnerCountry: { type: String, trim: true }, // البلد المفضل للشريك
    // للبنت فقط
    hijabType: { type: String, trim: true }, // محجبة / غير محجبة / نقاب
    acceptPolygamy: { type: Boolean }, // تقبل التعدد
    partnerTraitsOrConditions: { type: String, trim: true }, // صفات أو شروط الشريك
    // للشاب فقط
    marriageType: { type: String, trim: true }, // أول / تعدد (نوع الزواج)

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
      enum: ["basic", "premium"],
    },
    usedReferralCode: {
      type: mongoose.Schema.ObjectId,
      ref: "ReferralCode",
      default: null,
      // كود الإحالة المستخدم عند الاشتراك (مرة واحدة فقط لكل مستخدم)
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
    // حظر شامل: عند الإلغاء تُرفع كلها (IP + جهاز + جوال)
    blockedIdentifiers: {
      phone: { type: String, trim: true },
      ips: [{ type: String, trim: true }],
      deviceIds: [{ type: String, trim: true }],
    },
    lastLoginIp: { type: String, trim: true },
    lastDeviceId: { type: String, trim: true },
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
