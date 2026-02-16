/**
 * REST routes for OTP: POST /send, POST /verify, GET /qr (لربط واتساب على VPS)
 */
import express from "express";
import { createRequire } from "module";
import { sendOTP, verifyOTP } from "./otp.service.mjs";

const require = createRequire(import.meta.url);
const User = require("../models/userModel.js");
const jwt = require("jsonwebtoken");

const router = express.Router();

/**
 * إذا وُجد توكن صالح، يُرجَع المستخدم الحالي (للتحديث بالـ _id بدل البحث بالرقم).
 * لا يرمي خطأ إن لم يكن هناك توكن أو كان غير صالح.
 */
async function optionalAuthUser(req) {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.split(" ")[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
    const user = await User.findById(decoded.userId);
    return user && user.active !== false ? user : null;
  } catch {
    return null;
  }
}

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
 * إرجاع قائمة صيغ محتملة للرقم لربطها بالمستخدم في DB (قد يكون الرقم محفوظاً كـ 0997.. أو +963997..)
 */
function phoneVariants(phone) {
  const p = String(phone).trim().replace(/\s/g, "");
  const variants = new Set([p]);
  if (p.startsWith("+")) {
    const withoutPlus = p.slice(1);
    variants.add(withoutPlus);
    if (/^963\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^966\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^962\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^971\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^965\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^974\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^973\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^968\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^961\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^20\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(2));
    if (/^964\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^972\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(3));
    if (/^90\d+$/.test(withoutPlus)) variants.add("0" + withoutPlus.slice(2));
  } else if (p.startsWith("0")) {
    variants.add(p.slice(1));
    if (p.length === 10 && p.startsWith("09")) variants.add("+963" + p.slice(1));
    if (p.length === 10 && p.startsWith("05")) variants.add("+966" + p.slice(1));
  } else if (/^\d{9,}$/.test(p)) {
    variants.add("0" + p);
    variants.add("+963" + p);
  }
  return [...variants];
}

/**
 * POST /api/otp/verify
 * Body: { "phone": "+9639xxxxxxxx", "code": "123456" }
 * إذا أُرسل توكن (Authorization: Bearer ...): يُحدَّث المستخدم الحالي بالـ _id (لا بحث بالرقم).
 * وإلا: يبحث عن المستخدم بعدة صيغ للرقم ويحدّثه.
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

  const currentUser = await optionalAuthUser(req);
  if (currentUser) {
    await User.findByIdAndUpdate(currentUser._id, {
      $set: { phoneVerified: true, registrationStep: 6 },
    });
    return res.status(200).json({
      success: true,
      message: "تم التحقق بنجاح.",
    });
  }

  const variants = phoneVariants(phone.trim());
  const updated = await User.findOneAndUpdate(
    { phone: { $in: variants } },
    { $set: { phoneVerified: true, registrationStep: 6 } },
    { new: true },
  );
  if (!updated) {
    await User.findOneAndUpdate(
      { phone: phone.trim() },
      { $set: { phoneVerified: true, registrationStep: 6 } },
    );
  }
  return res.status(200).json({
    success: true,
    message: "تم التحقق بنجاح.",
  });
});

export default router;
