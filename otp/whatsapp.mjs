/**
 * WhatsApp connection via Baileys (QR + session).
 * Session saved locally so QR is only required once.
 */
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FOLDER = path.join(__dirname, "auth_info_wa");

let sock = null;
let isReady = false;
let resolveReady = null;
/** Promise تُحل عند اتصال واتساب (تُعاد إنشاؤها عند كل إعادة اتصال) */
let readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});
/** آخر رمز QR كـ Data URL (للعرض في المتصفح على الـ VPS) */
let lastQRDataUrl = null;

/**
 * للحصول على رمز QR للعرض في صفحة ويب (مفيد عند التشغيل على VPS)
 * @returns {{ connected: boolean, qrDataUrl: string | null }}
 */
export function getQRForWeb() {
  if (isReady) return { connected: true, qrDataUrl: null };
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
  readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
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
    } else {
      lastQRDataUrl = null;
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isForbidden = statusCode === 403;
      const shouldReconnect =
        statusCode === DisconnectReason.restartRequired ||
        statusCode === DisconnectReason.connectionLost ||
        statusCode === DisconnectReason.connectionClosed ||
        statusCode === 408 ||
        statusCode === 428;
      isReady = false;
      if (shouldReconnect && !isLoggedOut && !isForbidden) {
        console.log("🔄 انقطع الاتصال بواتساب (", statusCode, "). إعادة الاتصال...");
        connect();
      } else if (!isLoggedOut) {
        console.log("❌ انقطع الاتصال بواتساب:", lastDisconnect?.error?.message || statusCode);
      }
      return;
    }

    if (connection === "open") {
      isReady = true;
      lastQRDataUrl = null;
      if (resolveReady) resolveReady();
      console.log("✅ واتساب متصل وجاهز لإرسال OTP.");
    }
  });
}

// Start connection on load
connect().catch((err) => {
  console.error("❌ فشل بدء واتساب:", err.message);
});
