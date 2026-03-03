/**
 * WhatsApp connection via Baileys (QR + session).
 * Session saved in MongoDB so no file deletion needed after server restart.
 */
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { useMongoAuthState, clearMongoAuth } from "./authStore.mjs";

/** تخفيف لوقات Baileys (لا نعرض JSON و stack trace)، نعتمد على connection.update للرسائل */
const noop = () => {};
const baileysLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => baileysLogger,
};

let sock = null;
let isReady = false;
let resolveReady = null;
/** عند true: الإغلاق القادم من سوكيت قديم (مثلاً بعد forceReconnect) فلا نجدول إعادة اتصال */
let skipNextCloseReconnect = false;
/** Promise تُحل عند اتصال واتساب (تُعاد إنشاؤها عند كل إعادة اتصال) */
let readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});
/** آخر رمز QR كـ Data URL (للعرض في المتصفح على الـ VPS) */
let lastQRDataUrl = null;

/**
 * للحصول على رمز QR للعرض في صفحة ويب (مفيد عند التشغيل على VPS)
 * إذا لم يكن هناك اتصال ولا QR، نُشغّل connect() حتى يظهر رمز في الطلبات التالية.
 * @returns {{ connected: boolean, qrDataUrl: string | null }}
 */
export function getQRForWeb() {
  if (isReady) return { connected: true, qrDataUrl: null };
  if (sock === null) connect().catch((err) => console.error("❌ بدء واتساب للـ QR:", err.message));
  return { connected: false, qrDataUrl: lastQRDataUrl };
}

/**
 * Format phone to WhatsApp JID (e.g. +963912345678 -> 963912345678@s.whatsapp.net)
 */
export function phoneToJid(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits.length) return null;
  return `${digits}@s.whatsapp.net`;
}

const WA_READY_TIMEOUT_MS = 45000; // 45s (أطول من 20s AwaitingInitialSync)
const RECONNECT_DELAY_MS = 5000;  // تأخير أساسي قبل إعادة الاتصال
const RECONNECT_MAX_DELAY_MS = 60000; // أقصى تأخير (دقيقة)
let reconnectAttempts = 0; // يُصفّر عند اتصال ناجح. إن استمر Connection Failure: استخدم «إعادة ربط واتساب» من لوحة الأدمن (أو POST /api/v1/admins/whatsapp-reconnect).

/**
 * Send a WhatsApp text message. Resolves when connection is ready and message is sent.
 * If WhatsApp is still connecting, waits up to WA_READY_TIMEOUT_MS for it to become ready.
 * @param {string} phone - E.164 style e.g. +963912345678
 * @param {string} text - Message body (e.g. Arabic OTP text)
 * @returns {Promise<void>}
 */
export async function sendWhatsAppMessage(phone, text) {
  if (!sock || !isReady) {
    await Promise.race([
      readyPromise,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("WhatsApp connection timeout (45s). حاول مرة أخرى.")),
          WA_READY_TIMEOUT_MS
        )
      ),
    ]);
  }
  if (!sock) throw new Error("WhatsApp not initialized");
  if (!isReady) throw new Error("WhatsApp not ready");
  const jid = phoneToJid(phone);
  if (!jid) throw new Error("Invalid phone number");
  await sock.sendMessage(jid, { text });
}

/**
 * Whether the WhatsApp client is connected and ready to send.
 */
export function isWhatsAppReady() {
  return isReady && sock !== null;
}

async function connect() {
  sock = null;
  isReady = false;
  readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const { state, saveCreds } = await useMongoAuthState();

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: baileysLogger,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        lastQRDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        const qrText = await QRCode.toString(qr, { type: "terminal", small: true });
        console.log("\n📱 امسح رمز QR بواسطة واتساب (WhatsApp > Linked Devices):\n");
        console.log(qrText);
        console.log("\n   أو افتح في المتصفح: GET /api/v1/otp/qr\n");
      } catch (e) {
        console.log("QR (raw):", qr);
      }
    }
    // لا نمسح lastQRDataUrl هنا عند عدم وجود qr — نبقيه حتى اتصال ناجح أو QR جديد

    if (connection === "close") {
      if (skipNextCloseReconnect) {
        skipNextCloseReconnect = false;
        return;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
      const errMsg = lastDisconnect?.error?.message || "";
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isForbidden = statusCode === 403;
      // إعادة الاتصال لأي انقطاع ما عدا تسجيل خروج أو 403
      const shouldReconnect = !isLoggedOut && !isForbidden;
      isReady = false;
      if (shouldReconnect) {
        const delay = Math.min(
          RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
          RECONNECT_MAX_DELAY_MS
        );
        reconnectAttempts += 1;
        console.log(
          "🔄 انقطع الاتصال بواتساب (",
          errMsg || statusCode || "Connection Failure",
          "). إعادة المحاولة بعد",
          delay / 1000,
          "ثانية (محاولة",
          reconnectAttempts,
          ")."
        );
        setTimeout(() => connect(), delay);
      } else {
        console.log("❌ انقطع الاتصال بواتساب:", errMsg || statusCode);
      }
      return;
    }

    if (connection === "open") {
      reconnectAttempts = 0;
      isReady = true;
      lastQRDataUrl = null; // اتصال ناجح — لا حاجة لـ QR
      if (resolveReady) resolveReady();
      console.log("✅ واتساب متصل وجاهز لإرسال OTP.");
    }
  });
}

/**
 * مسح الجلسة من قاعدة البيانات وإعادة الربط من الصفر (يظهر QR جديد).
 * استخدمه عندما تريد ربط واتساب من جديد.
 */
export async function forceReconnect() {
  skipNextCloseReconnect = true;
  if (sock) {
    try {
      sock.end(undefined);
    } catch (_) {}
    sock = null;
  }
  isReady = false;
  reconnectAttempts = 0;
  lastQRDataUrl = null;
  readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  await clearMongoAuth();
  // تأخير قصير حتى ينتهي إغلاق السوكيت ثم نطلب QR جديد من واتساب
  await new Promise((r) => setTimeout(r, 800));
  connect().catch((err) => {
    console.error("❌ فشل إعادة اتصال واتساب:", err.message);
  });
  console.log("🔄 تم مسح الجلسة. افتح /api/v1/otp/qr وامسح الرمز (أو انتظر التحديث التلقائي).");
}

// Start connection on load
connect().catch((err) => {
  console.error("❌ فشل بدء واتساب:", err.message);
});
