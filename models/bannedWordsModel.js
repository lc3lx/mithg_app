const mongoose = require("mongoose");

const bannedWordsSchema = new mongoose.Schema(
  {
    word: {
      type: String,
      required: [true, "Word is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },

    // Alternative spellings or variations
    variations: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],

    // Category of the banned word
    category: {
      type: String,
      enum: [
        "profanity",
        "hate_speech",
        "sexual_content",
        "violence",
        "spam",
        "harassment",
        "other",
      ],
      default: "profanity",
    },

    // Severity level
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    // Warning message to show to user
    warningMessage: {
      type: String,
      trim: true,
      default: "تم اكتشاف محتوى غير مناسب. يرجى الحفاظ على المحادثة محترمة.",
    },

    // Auto block after X warnings
    autoBlockThreshold: {
      type: Number,
      default: 3,
      min: [1, "Auto block threshold must be at least 1"],
      max: [10, "Auto block threshold cannot exceed 10"],
    },

    // Block duration in hours
    blockDurationHours: {
      type: Number,
      default: 24,
      min: [1, "Block duration must be at least 1 hour"],
      max: [168, "Block duration cannot exceed 1 week"],
    },

    // Is the word active (can be disabled temporarily)
    isActive: {
      type: Boolean,
      default: true,
    },

    // Who added this banned word
    addedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: [true, "Admin who added the word is required"],
    },

    // Statistics
    violationCount: {
      type: Number,
      default: 0,
    },

    lastViolation: Date,

    // Notes for admins
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes for performance
bannedWordsSchema.index({ word: 1 });
bannedWordsSchema.index({ category: 1 });
bannedWordsSchema.index({ severity: 1 });
bannedWordsSchema.index({ isActive: 1 });

// Virtual for all words (word + variations)
bannedWordsSchema.virtual("allWords").get(function () {
  return [this.word, ...this.variations];
});

// Pre-save middleware to ensure variations don't duplicate the main word
bannedWordsSchema.pre("save", function (next) {
  if (this.variations && this.variations.length > 0) {
    // Remove duplicates and the main word from variations
    this.variations = this.variations
      .filter((v) => v !== this.word)
      .filter((v, index, arr) => arr.indexOf(v) === index); // Remove duplicates
  }
  next();
});

// Helper to safely escape regex special characters in words
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Static method to check if a message contains banned words
bannedWordsSchema.statics.checkMessage = async function (message) {
  const bannedWords = await this.find({ isActive: true });
  const lowerMessage = message.toLowerCase();

  let result = { found: false };

  bannedWords.some((bannedWord) => {
    const allWords = bannedWord.allWords || [];

    return allWords.some((word) => {
      if (!word) return false;

      const safeWord = escapeRegex(String(word).toLowerCase());
      const regex = new RegExp(`\\b${safeWord}\\b`, "i");

      if (regex.test(lowerMessage)) {
        result = {
          found: true,
          bannedWord,
          matchedWord: word,
        };
        return true;
      }

      return false;
    });
  });

  return result;
};

// Static method to get all active banned words
bannedWordsSchema.statics.getActiveWords = function () {
  return this.find({ isActive: true }).select(
    "word variations category severity"
  );
};

// Instance method to increment violation count
bannedWordsSchema.methods.incrementViolation = function () {
  this.violationCount += 1;
  this.lastViolation = new Date();
  return this.save();
};

// Populate addedBy when querying
bannedWordsSchema.pre(/^find/, function (next) {
  this.populate({
    path: "addedBy",
    select: "name email adminType",
  });
  next();
});

module.exports = mongoose.model("BannedWords", bannedWordsSchema);
