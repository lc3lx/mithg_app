/**
 * REST routes for OTP: POST /send, POST /verify, GET /qr (لربط واتساب على VPS)
 */
import express from "express";
import { createRequire } from "module";
import { sendOTP, verifyOTP } from "./otp.service.mjs";

const require = createRequire(import.meta.url);
const User = require("../models/userModel.js");

const router = express.Router();

/**
 * GET /api/v1/otp/qr
 * عرض رمز QR لربط واتساب (افتح هذا الرابط من جوالك أو المتصفح وامسح الرمز من واتساب)
 */
router.get("/qr", async (req, res) => {
  try {
    const { getQRForWeb } = await import("./whatsapp.mjs");
    const { connected, qrDataUrl } = getQRForWeb();
    if (connected) {
      return res.send(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>واتساب OTP</title>
        <style>body{font-family:sans-serif;background:#1a1a2e;color:#eee;text-align:center;padding:2rem;}
        .ok{color:#4ade80;font-size:1.2rem;margin:1rem 0;}</style></head>
        <body>
          <h1>واتساب OTP</h1>
          <p class="ok">✅ واتساب متصل. لا حاجة لمسح QR.</p>
        </body></html>
      `);
    }
    if (!qrDataUrl) {
      return res.send(`
        <!DOCTYPE html>
        <html dir="rtl" lang="ar">
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
        <title>واتساب OTP</title>
        <style>body{font-family:sans-serif;background:#1a1a2e;color:#eee;text-align:center;padding:2rem;}
        .wait{color:#fbbf24;}</style></head>
        <body>
          <h1>واتساب OTP</h1>
          <p class="wait">⏳ جاري توليد رمز QR... حدّث الصفحة خلال ثوانٍ.</p>
        </body></html>
      `);
    }
    return res.send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ربط واتساب - امسح الرمز</title>
      <style>body{font-family:sans-serif;background:#1a1a2e;color:#eee;text-align:center;padding:2rem;}
      img{border-radius:12px;margin:1rem 0;max-width:100%;}
      p{color:#94a3b8;}</style></head>
      <body>
        <h1>ربط واتساب</h1>
        <p>افتح واتساب على جوالك → الإعدادات → الأجهزة المرتبطة → ربط جهاز → امسح الرمز</p>
        <img src="${qrDataUrl}" alt="QR Code" width="300" height="300" />
      </body></html>
    `);
  } catch (err) {
    return res.status(500).send(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head><meta charset="utf-8"><title>خطأ</title></head>
      <body style="font-family:sans-serif;background:#1a1a2e;color:#eee;text-align:center;padding:2rem;">
        <h1>خطأ</h1><p>${err.message || "فشل تحميل واتساب."}</p>
      </body></html>
    `);
  }
});

/**
 * POST /api/otp/send
 * Body: { "phone": "+9639xxxxxxxx" }
 */
router.post("/send", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف مطلوب (phone)",
    });
  }
  const result = await sendOTP(phone.trim());
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }
  return res.status(200).json({
    success: true,
    message: "تم إرسال رمز التحقق إلى واتساب.",
  });
});

/**
 * قواعد نداء الدول وطول الرقم الوطني (بعد إزالة الصفر من البداية إن وُجد)
 * يستخدم لبناء كل الصيغ الممكنة للرقم المخزن في DB (0997.. أو +963997.. أو 997..)
 */
const DIAL_RULES = [
  { prefix: "963", len: 3 },
  { prefix: "966", len: 3 },
  { prefix: "962", len: 3 },
  { prefix: "971", len: 3 },
  { prefix: "965", len: 3 },
  { prefix: "974", len: 3 },
  { prefix: "973", len: 3 },
  { prefix: "968", len: 3 },
  { prefix: "961", len: 3 },
  { prefix: "964", len: 3 },
  { prefix: "972", len: 3 },
  { prefix: "967", len: 3 },
  { prefix: "20", len: 2 },
  { prefix: "90", len: 2 },
  { prefix: "213", len: 3 },
  { prefix: "212", len: 3 },
  { prefix: "216", len: 3 },
  { prefix: "218", len: 3 },
  { prefix: "249", len: 3 },
];

function phoneVariants(phone) {
  const p = String(phone).trim().replace(/\s/g, "").replace(/^\+/, "");
  const variants = new Set();
  variants.add(phone.trim());
  variants.add(p);
  if (p.startsWith("0")) {
    variants.add(p.slice(1));
    variants.add(p.replace(/^0+/, ""));
    if (p.length >= 10 && p.startsWith("09")) variants.add("+963" + p.slice(1));
    if (p.length >= 10 && p.startsWith("05")) variants.add("+966" + p.slice(1));
  }
  for (const { prefix, len } of DIAL_RULES) {
    if (p.length >= prefix.length && p.startsWith(prefix)) {
      let national = p.slice(prefix.length).replace(/^0+/, "");
      if (national) {
        variants.add("0" + national);
        variants.add(national);
        variants.add("+" + prefix + national);
      }
    }
  }
  if (/^\d{9,}$/.test(p)) {
    variants.add("0" + p);
    variants.add("+963" + p);
  }
  return [...variants];
}

/**
 * إرجاع صيغة E.164 للرقم (مثل +963997278481) لاستخدامها في تحديث حقل phone في المستند وتوحيد التخزين
 */
function normalizeToE164(phone) {
  const p = String(phone).trim().replace(/\s/g, "").replace(/^\+/, "");
  if (!p || !/^\d+$/.test(p)) return null;
  for (const { prefix } of DIAL_RULES) {
    if (p.startsWith(prefix)) {
      let national = p.slice(prefix.length).replace(/^0+/, "");
      if (national) return "+" + prefix + national;
    }
  }
  if (p.startsWith("0")) return "+963" + p.replace(/^0+/, "");
  if (p.length >= 9) return "+963" + p;
  return null;
}

/**
 * POST /api/otp/verify
 * Body: { "phone": "+9639xxxxxxxx", "code": "123456" }
 * على النجاح: تحديث المستخدم المرتبط بهذا الرقم إلى phoneVerified: true (يبحث بعدة صيغ للرقم).
 */
router.post("/verify", async (req, res) => {
  const phone = req.body?.phone;
  const code = req.body?.code;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف مطلوب (phone)",
    });
  }
  if (code === undefined || code === null) {
    return res.status(400).json({
      success: false,
      message: "رمز التحقق مطلوب (code)",
    });
  }
  const result = verifyOTP(phone.trim(), String(code));
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }
  const trimmed = phone.trim();
  const variants = phoneVariants(trimmed);
  const e164 = normalizeToE164(trimmed);
  const updatePayload = {
    phoneVerified: true,
    registrationStep: 6,
    ...(e164 && { phone: e164 }),
  };
  let updated = await User.findOneAndUpdate(
    { phone: { $in: variants } },
    { $set: updatePayload },
    { new: true },
  );
  if (!updated) {
    updated = await User.findOneAndUpdate(
      { phone: trimmed },
      { $set: updatePayload },
      { new: true },
    );
  }
  return res.status(200).json({
    success: true,
    message: "تم التحقق بنجاح.",
  });
});

export default router;
