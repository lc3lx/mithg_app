/**
 * OTP service: generate, store in DB, verify, rate limit.
 * OTP 6 digits, 2 min expiry. Max 100 OTP per phone per hour (in-memory).
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const OtpRecord = require("../models/otpRecordModel.js");

const OTP_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 100; // 100 OTP per phone per hour

/** phone -> [timestamp, ...] of send requests */
const rateLimitMap = new Map();

function generateOTP() {
  const n = Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

function isRateLimited(phone) {
  const key = String(phone).trim();
  let timestamps = rateLimitMap.get(key) || [];
  const now = Date.now();
  timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  rateLimitMap.set(key, timestamps);
  return timestamps.length >= RATE_LIMIT_MAX;
}

function recordSend(phone) {
  const key = String(phone).trim();
  const timestamps = rateLimitMap.get(key) || [];
  timestamps.push(Date.now());
  rateLimitMap.set(key, timestamps);
}

/**
 * Generate OTP, store it, send via WhatsApp (Arabic message).
 * @param {string} phone - e.g. +9639xxxxxxxx
 * @returns {{ success: boolean, message?: string }}
 */
export async function sendOTP(phone) {
  const key = String(phone).trim();
  if (!key) return { success: false, message: "رقم الهاتف مطلوب" };

  if (isRateLimited(phone)) {
    return {
      success: false,
      message:
        "تم تجاوز الحد المسموح. حاول بعد ساعة (100 طلب كحد أقصى لكل رقم في الساعة).",
    };
  }

  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
  await OtpRecord.create({ phone: key, code, expiresAt });
  recordSend(phone);

  // طباعة الرمز في الـ console للتطوير واللوج
  console.log("[OTP] الرمز للمطور (لوج):", code, "| رقم:", key);

  const arabicMessage = `رمز التحقق الخاص بك: *${code}*\nصالح لمدة دقيقتين.\nلا تشارك هذا الرمز مع أحد.`;

  try {
    console.log("[OTP] إرسال رمز إلى:", key);
    const { sendWhatsAppMessage } = await import("./whatsapp.mjs");
    await sendWhatsAppMessage(phone, arabicMessage);
    console.log("[OTP] تم إرسال الرمز بنجاح إلى:", key);
    return { success: true };
  } catch (err) {
    // عدم حذف الرمز عند فشل واتساب: يبقى الرمز في الـ store ويُطبع في اللوج فيمكن التحقق به
    const msg = err.message || "فشل إرسال الرسالة عبر واتساب.";
    console.error("[OTP] فشل الإرسال إلى", key, ":", msg);
    console.log("[OTP] يمكنك التحقق باستخدام الرمز أعلاه من لوج السيرفر:", code);
    return {
      success: true,
      message:
        "لم نتمكن من إرسال الرمز عبر واتساب. استخدم الرمز الظاهر في لوج السيرفر للتحقق.",
    };
  }
}

/**
 * Verify OTP and delete on success.
 * @param {string} phone - e.g. +9639xxxxxxxx
 * @param {string} code - 6 digits
 * @returns {{ success: boolean, message?: string }}
 */
export async function verifyOTP(phone, code) {
  const key = String(phone).trim();
  const entry = await OtpRecord.findOne({ phone: key })
    .sort({ createdAt: -1 })
    .lean();
  if (!entry) {
    return {
      success: false,
      message: "لم يتم إرسال رمز لهذا الرقم أو انتهت صلاحية الرمز.",
    };
  }
  if (Date.now() > new Date(entry.expiresAt).getTime()) {
    await OtpRecord.deleteOne({ _id: entry._id });
    return {
      success: false,
      message: "انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً.",
    };
  }
  const codeStr = String(code).trim();
  if (codeStr !== entry.code) {
    return { success: false, message: "رمز التحقق غير صحيح." };
  }
  await OtpRecord.deleteOne({ _id: entry._id });
  return { success: true };
}

/**
 * قائمة آخر سجلات OTP (للأدمن).
 * @param {number} limit
 * @returns {Promise<Array<{ phone: string, code: string, expiresAt: Date, createdAt: Date }>>}
 */
export async function getOtpRecords(limit = 50) {
  const list = await OtpRecord.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return list.map((r) => ({
    phone: r.phone,
    code: r.code,
    expiresAt: r.expiresAt,
    createdAt: r.createdAt,
  }));
}
