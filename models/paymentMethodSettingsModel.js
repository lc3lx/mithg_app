const mongoose = require("mongoose");

const methodSchema = new mongoose.Schema(
  {
    isEnabled: { type: Boolean, default: true },
    title: { type: String, trim: true, default: "" },
    instructions: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true },
    accountName: { type: String, trim: true },
    bankName: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

const paymentMethodSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    bankTransfer: { type: methodSchema, default: () => ({}) },
    shamCash: { type: methodSchema, default: () => ({}) },
    syriatelCash: { type: methodSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "PaymentMethodSettings",
  paymentMethodSettingsSchema
);
