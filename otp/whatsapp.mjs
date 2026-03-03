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
/** منع تشغيل connect() أكثر من مرة في نفس الوقت */
let connecting = false;
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

const QR_WAIT_INTERVAL_MS = 400;
const QR_WAIT_MAX_MS = 16000;

/**
 * مثل getQRForWeb لكن ينتظر حتى يظهر رمز QR (أو اتصال ناجح) لمدة محدودة.
 * مناسب لطلب واحد من الواجهة حتى لا يرجع null في أول طلب.
 * @param {number} maxWaitMs - أقصى انتظار بالميلي ثانية (افتراضي 16 ثانية)
 * @returns {Promise<{ connected: boolean, qrDataUrl: string | null }>}
 */
export async function getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS) {
  if (isReady) return { connected: true, qrDataUrl: null };
  if (lastQRDataUrl) return { connected: false, qrDataUrl: lastQRDataUrl };
  if (sock === null) connect().catch((err) => console.error("❌ بدء واتساب للـ QR:", err.message));

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, QR_WAIT_INTERVAL_MS));
    if (isReady) return { connected: true, qrDataUrl: null };
    if (lastQRDataUrl) return { connected: false, qrDataUrl: lastQRDataUrl };
  }
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
  if (connecting) return;
  connecting = true;
  sock = null;
  isReady = false;
  readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  try {
    const { state, saveCreds } = await useMongoAuthState();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: baileysLogger,
      syncFullHistory: false,
      getMessage: async () => undefined,
    });
  } catch (err) {
    connecting = false;
    console.error("❌ فشل تهيئة واتساب:", err.message);
    throw err;
  }

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
      connecting = false;
      if (skipNextCloseReconnect) {
        skipNextCloseReconnect = false;
        return;
      }
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
      const errMsg = lastDisconnect?.error?.message || "";
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isForbidden = statusCode === 403;
      isReady = false;

      const isBadAuthError =
        /Invalid private key|Uint8Array|invalid.*key|bad.*auth/i.test(errMsg);
      if (isBadAuthError) {
        console.log("⚠️ جلسة تالفة أو غير متوافقة. مسح الجلسة وطلب QR جديد:", errMsg);
        skipNextCloseReconnect = true;
        clearMongoAuth()
          .then(() => {
            lastQRDataUrl = null;
            reconnectAttempts = 0;
            setTimeout(() => connect(), 1500);
          })
          .catch((e) => {
            console.error("❌ فشل مسح الجلسة:", e.message);
            setTimeout(() => connect(), 5000);
          });
        return;
      }

      const shouldReconnect = !isLoggedOut && !isForbidden;
      if (shouldReconnect) {
        const isConnectionTerminated = /Connection Terminated|Connection Closed/i.test(errMsg);
        const baseDelay = isConnectionTerminated && reconnectAttempts < 3
          ? 20000
          : RECONNECT_DELAY_MS;
        const delay = Math.min(
          baseDelay * Math.pow(2, Math.min(reconnectAttempts, 4)),
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
      connecting = false;
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
  connecting = false;
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
  await new Promise((r) => setTimeout(r, 1500));
  connect().catch((err) => {
    console.error("❌ فشل إعادة اتصال واتساب:", err.message);
  });
  console.log("🔄 تم مسح الجلسة. امسح رمز QR من لوحة الأدمن (ربط واتساب و OTP).");
}

// Start connection on load (بعد تأخير قصير لتفادي تضارب مع أي استيراد آخر)
setTimeout(() => {
  connect().catch((err) => {
    console.error("❌ فشل بدء واتساب:", err.message);
  });
}, 2000);
