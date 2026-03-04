/**
 * WhatsApp connection via whatsapp-web.js.
 * Session in MongoDB only: database "whatsapp", collection "sessions", sessionId "main-wa".
 * QR عرض عبر API فقط (لا طباعة في التيرمنال).
 *
 * Exports: sendWhatsAppMessage, isWhatsAppReady, forceReconnect, getQRForWebOrWait, getQRForWeb
 */
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { Client, RemoteAuth } = require("whatsapp-web.js");
const mongoose = require("mongoose");
const QRCode = require("qrcode");
const MongoSessionStore = require("./mongoSessionStore");

const SESSION_ID = "main-wa";
const QR_WAIT_MAX_MS_DEFAULT = 22000;

// ----- In-memory state (لا تخزين على القرص) -----
let client = null;
let isReady = false;
let lastQRRaw = null;
let lastQRDataUrl = null;
let lastQRAt = 0;
let initPromise = null;
let qrWaiters = [];
const QR_RECENT_MS = 60_000;

function getStore() {
  return new MongoSessionStore({ mongoose });
}

function createClient() {
  const store = getStore();
  const authStrategy = new RemoteAuth({
    clientId: SESSION_ID,
    store,
    backupSyncIntervalMs: 300000,
  });

  const c = new Client({
    authStrategy,
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  c.on("qr", async (qr) => {
    console.log("[WhatsApp] حدث: qr — تم توليد رمز QR (عرضه عبر API فقط).");
    lastQRRaw = qr;
    lastQRAt = Date.now();
    try {
      lastQRDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
    } catch (e) {
      lastQRDataUrl = null;
    }
    qrWaiters.forEach(({ resolve }) =>
      resolve({ connected: false, qrDataUrl: lastQRDataUrl, qrRaw: qr || null })
    );
    qrWaiters = [];
  });

  c.on("authenticated", () => {
    console.log("[WhatsApp] حدث: authenticated — تم المصادقة.");
  });

  c.on("ready", () => {
    console.log("[WhatsApp] حدث: ready — واتساب جاهز للإرسال.");
    isReady = true;
    lastQRRaw = null;
    lastQRDataUrl = null;
    qrWaiters.forEach(({ resolve }) => resolve({ connected: true, qrDataUrl: null, qrRaw: null }));
    qrWaiters = [];
  });

  c.on("auth_failure", (msg) => {
    console.log("[WhatsApp] حدث: auth_failure —", msg || "فشل المصادقة.");
    isReady = false;
  });

  c.on("disconnected", (reason) => {
    console.log("[WhatsApp] حدث: disconnected —", reason || "انقطع الاتصال.");
    isReady = false;
    client = null;
    // لا نمسح الجلسة من MongoDB إلا عند logout فعلي (يتم عبر forceReconnect أو client.logout)
  });

  return c;
}

export async function ensureInitialized() {
  if (client && isReady) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (client) return;
    client = createClient();
    await client.initialize();
  })().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

// ----- واجهات التصدير (متوافقة مع المشروع) -----

/** إرسال رسالة نصية عبر واتساب */
export async function sendWhatsAppMessage(phone, text) {
  await ensureInitialized();
  if (!isReady || !client) throw new Error("WhatsApp غير جاهز. يرجى ربط الحساب عبر QR.");
  const digits = String(phone).replace(/\D/g, "");
  if (!digits.length) throw new Error("Invalid phone number");
  const chatId = `${digits}@c.us`;
  await client.sendMessage(chatId, text);
}

/** هل واتساب متصل وجاهز */
export function isWhatsAppReady() {
  return isReady && client !== null;
}

/** إرجاع فوري للحالة الحالية و QR إن وُجد (لـ GET /otp/qr) */
export function getQRForWeb() {
  const now = Date.now();
  if (isReady) return { connected: true, qrDataUrl: null };
  if (lastQRDataUrl && now - lastQRAt <= QR_RECENT_MS) return { connected: false, qrDataUrl: lastQRDataUrl };
  return { connected: false, qrDataUrl: lastQRDataUrl || null };
}

/** انتظار حتى الاتصال أو ظهور QR (لـ GET /admins/whatsapp-qr و GET /api/whatsapp/qr) */
export async function getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS_DEFAULT) {
  await ensureInitialized();

  if (isReady) return { connected: true, qrDataUrl: null, qrRaw: null };
  const now = Date.now();
  if (lastQRDataUrl && now - lastQRAt <= QR_RECENT_MS)
    return { connected: false, qrDataUrl: lastQRDataUrl, qrRaw: lastQRRaw || null };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      const idx = qrWaiters.findIndex((w) => w.resolve === resolve);
      if (idx !== -1) qrWaiters.splice(idx, 1);
      if (isReady) resolve({ connected: true, qrDataUrl: null, qrRaw: null });
      else resolve({ connected: false, qrDataUrl: lastQRDataUrl, qrRaw: lastQRRaw || null });
    }, maxWaitMs);
    qrWaiters.push({
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
    });
  });
}

/** إعادة ربط واتساب (مسح الجلسة من MongoDB وطلب QR جديد) */
export async function forceReconnect() {
  if (client) {
    try {
      await client.destroy();
    } catch (e) {
      console.warn("[WhatsApp] forceReconnect: destroy:", e?.message);
    }
    client = null;
  }
  isReady = false;
  lastQRRaw = null;
  lastQRDataUrl = null;
  initPromise = null;
  const store = getStore();
  try {
    await store.delete({ session: `RemoteAuth-${SESSION_ID}` }); // نفس الاسم الذي يستخدمه RemoteAuth
  } catch (e) {
    console.warn("[WhatsApp] forceReconnect: delete session:", e?.message);
  }
  console.log("[WhatsApp] تم طلب إعادة الربط. الجلسة محذوفة من MongoDB. سيُطلب QR عند الطلب التالي.");
}
