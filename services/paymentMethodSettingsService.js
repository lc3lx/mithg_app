const PaymentMethodSettings = require("../models/paymentMethodSettingsModel");
const asyncHandler = require("express-async-handler");

const DOC_ID = "default";

const defaultSettings = {
  _id: DOC_ID,
  bankTransfer: {
    isEnabled: true,
    title: "تحويل بنكي",
    instructions: "قم بالتحويل إلى الحساب التالي ثم أرسل الطلب مع رقم المرجع.",
    accountNumber: "",
    accountName: "",
    bankName: "",
  },
  shamCash: {
    isEnabled: true,
    title: "شام كاش",
    instructions: "ادفع عبر تطبيق شام كاش إلى الرقم التالي.",
    phone: "",
    accountName: "",
  },
  syriatelCash: {
    isEnabled: true,
    title: "سيرياتيل كاش",
    instructions: "ادفع عبر سيرياتيل كاش إلى الرقم التالي.",
    phone: "",
    accountName: "",
  },
};

exports.getPaymentMethodSettings = asyncHandler(async (req, res) => {
  let doc = await PaymentMethodSettings.findById(DOC_ID).lean();
  if (!doc) {
    doc = await PaymentMethodSettings.create(defaultSettings);
    doc = doc.toObject();
  }
  res.json(doc);
});

exports.updatePaymentMethodSettings = asyncHandler(async (req, res) => {
  const { bankTransfer, shamCash, syriatelCash } = req.body;
  let doc = await PaymentMethodSettings.findById(DOC_ID);
  if (!doc) {
    doc = await PaymentMethodSettings.create(defaultSettings);
  }
  if (bankTransfer != null) {
    if (typeof bankTransfer.isEnabled !== "undefined") doc.bankTransfer.isEnabled = bankTransfer.isEnabled;
    if (bankTransfer.title != null) doc.bankTransfer.title = bankTransfer.title;
    if (bankTransfer.instructions != null) doc.bankTransfer.instructions = bankTransfer.instructions;
    if (bankTransfer.accountNumber != null) doc.bankTransfer.accountNumber = bankTransfer.accountNumber;
    if (bankTransfer.accountName != null) doc.bankTransfer.accountName = bankTransfer.accountName;
    if (bankTransfer.bankName != null) doc.bankTransfer.bankName = bankTransfer.bankName;
    if (bankTransfer.phone != null) doc.bankTransfer.phone = bankTransfer.phone;
  }
  if (shamCash != null) {
    if (typeof shamCash.isEnabled !== "undefined") doc.shamCash.isEnabled = shamCash.isEnabled;
    if (shamCash.title != null) doc.shamCash.title = shamCash.title;
    if (shamCash.instructions != null) doc.shamCash.instructions = shamCash.instructions;
    if (shamCash.phone != null) doc.shamCash.phone = shamCash.phone;
    if (shamCash.accountName != null) doc.shamCash.accountName = shamCash.accountName;
  }
  if (syriatelCash != null) {
    if (typeof syriatelCash.isEnabled !== "undefined") doc.syriatelCash.isEnabled = syriatelCash.isEnabled;
    if (syriatelCash.title != null) doc.syriatelCash.title = syriatelCash.title;
    if (syriatelCash.instructions != null) doc.syriatelCash.instructions = syriatelCash.instructions;
    if (syriatelCash.phone != null) doc.syriatelCash.phone = syriatelCash.phone;
    if (syriatelCash.accountName != null) doc.syriatelCash.accountName = syriatelCash.accountName;
  }
  await doc.save();
  res.json(doc);
});
