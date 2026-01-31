/**
 * OTP service: generate, store, verify, rate limit.
 * In-memory store (Map). OTP 6 digits, 2 min expiry. Max 3 OTP per phone per hour.
 * WhatsApp is lazy-loaded so server starts even if Baileys fails.
 */

const OTP_EXPIRY_MS = 2 * 60 * 1000; // 2 minutes
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 3;

/** phone -> { code, expiresAt } */
const store = new Map();

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
      message: "تم تجاوز الحد المسموح. حاول بعد ساعة (3 طلبات كحد أقصى لكل رقم في الساعة).",
    };
  }

  const code = generateOTP();
  const expiresAt = Date.now() + OTP_EXPIRY_MS;
  store.set(key, { code, expiresAt });
  recordSend(phone);

  const arabicMessage = `رمز التحقق الخاص بك: *${code}*\nصالح لمدة دقيقتين.\nلا تشارك هذا الرمز مع أحد.`;

  try {
    console.log("[OTP] إرسال رمز إلى:", key);
    const { sendWhatsAppMessage } = await import("./whatsapp.mjs");
    await sendWhatsAppMessage(phone, arabicMessage);
    console.log("[OTP] تم إرسال الرمز بنجاح إلى:", key);
    return { success: true };
  } catch (err) {
    store.delete(key);
    const msg = err.message || "فشل إرسال الرسالة عبر واتساب.";
    console.error("[OTP] فشل الإرسال إلى", key, ":", msg);
    const userMessage =
      msg.includes("timeout") || msg.includes("connection")
        ? "واتساب غير متصل أو انقطع. تأكد من مسح رمز QR واتساب (GET /api/v1/otp/qr) ثم حاول مرة أخرى."
        : msg.includes("Invalid phone")
          ? "رقم الهاتف غير صالح. استخدم صيغة دولية مثل 963912345678."
          : "فشل إرسال الرسالة عبر واتساب. تأكد من اتصال واتساب ومسح رمز QR.";
    return { success: false, message: userMessage };
  }
}

/**
 * Verify OTP and delete on success.
 * @param {string} phone - e.g. +9639xxxxxxxx
 * @param {string} code - 6 digits
 * @returns {{ success: boolean, message?: string }}
 */
export function verifyOTP(phone, code) {
  const key = String(phone).trim();
  const entry = store.get(key);
  if (!entry) {
    return { success: false, message: "لم يتم إرسال رمز لهذا الرقم أو انتهت صلاحية الرمز." };
  }
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return { success: false, message: "انتهت صلاحية رمز التحقق. اطلب رمزاً جديداً." };
  }
  const codeStr = String(code).trim();
  if (codeStr !== entry.code) {
    return { success: false, message: "رمز التحقق غير صحيح." };
  }
  store.delete(key);
  return { success: true };
}
