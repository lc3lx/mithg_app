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
const readyPromise = new Promise((resolve) => {
  resolveReady = resolve;
});

/**
 * Format phone to WhatsApp JID (e.g. +963912345678 -> 963912345678@s.whatsapp.net)
 */
export function phoneToJid(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits.length) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Send a WhatsApp text message. Resolves when connection is ready and message is sent.
 * @param {string} phone - E.164 style e.g. +963912345678
 * @param {string} text - Message body (e.g. Arabic OTP text)
 * @returns {Promise<void>}
 */
export async function sendWhatsAppMessage(phone, text) {
  if (!sock) throw new Error("WhatsApp not initialized");
  if (!isReady) {
    await Promise.race([
      readyPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("WhatsApp connection timeout")), 30000)),
    ]);
  }
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
        const qrText = await QRCode.toString(qr, { type: "terminal", small: true });
        console.log("\n📱 امسح رمز QR بواسطة واتساب (WhatsApp > Linked Devices):\n");
        console.log(qrText);
        console.log("\n");
      } catch (e) {
        console.log("QR (raw):", qr);
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
      const shouldReconnect = statusCode === DisconnectReason.restartRequired;
      isReady = false;
      if (shouldReconnect) {
        console.log("🔄 إعادة الاتصال بواتساب...");
        connect();
      } else if (statusCode !== DisconnectReason.loggedOut) {
        console.log("❌ انقطع الاتصال بواتساب:", lastDisconnect?.error?.message || statusCode);
      }
      return;
    }

    if (connection === "open") {
      isReady = true;
      if (resolveReady) resolveReady();
      console.log("✅ واتساب متصل وجاهز لإرسال OTP.");
    }
  });
}

// Start connection on load
connect().catch((err) => {
  console.error("❌ فشل بدء واتساب:", err.message);
});
