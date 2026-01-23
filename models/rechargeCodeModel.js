const mongoose = require("mongoose");

const rechargeCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, "Code is required"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: [true, "Amount is required"],
      min: [0.01, "Amount must be greater than 0"],
    },
    currency: {
      type: String,
      enum: ["SAR", "USD", "EUR", "AED"],
      default: "SAR",
    },
    status: {
      type: String,
      enum: ["active", "used", "expired", "disabled"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: [true, "Admin who created the code is required"],
    },
    usedBy: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    usedAt: Date,
    expiresAt: {
      type: Date,
      required: [true, "Expiration date is required"],
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
    maxUses: {
      type: Number,
      default: 1,
      min: [1, "Max uses must be at least 1"],
    },
    currentUses: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      trim: true,
    },
    batchId: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Indexes
rechargeCodeSchema.index({ code: 1 });
rechargeCodeSchema.index({ status: 1 });
rechargeCodeSchema.index({ expiresAt: 1 });
rechargeCodeSchema.index({ createdBy: 1 });
rechargeCodeSchema.index({ batchId: 1 });

// Virtual for formatted amount
rechargeCodeSchema.virtual("formattedAmount").get(function () {
  return `${this.amount.toFixed(2)} ${this.currency}`;
});

// Virtual for is expired
rechargeCodeSchema.virtual("isExpired").get(function () {
  return Date.now() > this.expiresAt;
});

// Instance method to check if code can be used
rechargeCodeSchema.methods.canBeUsed = function () {
  return (
    this.status === "active" &&
    !this.isExpired &&
    this.currentUses < this.maxUses
  );
};

// Instance method to use the code
rechargeCodeSchema.methods.useCode = function (userId) {
  if (!this.canBeUsed()) {
    throw new Error("Code cannot be used");
  }

  this.usedBy = userId;
  this.usedAt = new Date();
  this.currentUses += 1;

  if (this.currentUses >= this.maxUses) {
    this.status = "used";
  }

  return this.save();
};

// Static method to generate unique code
rechargeCodeSchema.statics.generateCode = function () {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // Removed similar chars
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Static method to generate batch of codes
rechargeCodeSchema.statics.generateBatch = async function (
  count,
  amount,
  currency = "SAR",
  expiresAt,
  createdBy,
  description,
  batchId
) {
  const codes = [];

  for (let i = 0; i < count; i++) {
    let code;
    let attempts = 0;

    // Ensure unique code
    do {
      code = this.generateCode();
      attempts++;
      if (attempts > 100) {
        throw new Error("Could not generate unique code");
      }
    } while (await this.findOne({ code }));

    codes.push({
      code,
      amount,
      currency,
      expiresAt: expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      createdBy,
      description,
      batchId,
    });
  }

  return this.insertMany(codes);
};

// Populate related data
rechargeCodeSchema.pre(/^find/, function (next) {
  this.populate({
    path: "createdBy",
    select: "name email adminType",
  }).populate({
    path: "usedBy",
    select: "name email",
  });
  next();
});

module.exports = mongoose.model("RechargeCode", rechargeCodeSchema);
