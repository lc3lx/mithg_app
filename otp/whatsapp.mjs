/**
 * WhatsApp connection via Baileys (QR + session).
 * Session saved in MongoDB using useMongoAuthState (no files on disk).
 *
 * واجهات التصدير المتوافقة مع المشروع:
 * - sendWhatsAppMessage(phone, text)
 * - isWhatsAppReady()
 * - getQRForWebOrWait(maxWaitMs?)
 * - forceReconnect()
 */
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import {
  useMongoAuthState,
  clearMongoAuth,
  saveQRToDB,
  clearQRFromDB,
  getQRFromDB,
} from "./authStore.mjs";

// ---------- Helpers ----------

/** Format phone to WhatsApp JID (e.g. +963912345678 -> 963912345678@s.whatsapp.net) */
function phoneToJid(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits.length) return null;
  return `${digits}@s.whatsapp.net`;
}

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

const WA_READY_TIMEOUT_MS = 45000;
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;
const RECONNECT_BLOCK_AFTER = 5;
const QR_WAIT_MAX_MS_DEFAULT = 22000;
const QR_RECENT_MS = 60_000;

const STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  WAITING_FOR_QR: "waiting_for_qr",
  CONNECTED: "connected",
  CLOSED: "closed",
  BLOCKED: "blocked",
};

class BaileysConnectionManager {
  constructor() {
    /** @type {ReturnType<typeof makeWASocket> | null} */
    this.sock = null;
    this.state = STATES.IDLE;
    this.prevState = null;

    this.isReady = false;
    this.readyPromise = null;
    this.resolveReady = null;

    this.connectPromise = null;
    this.reconnectAttempts = 0;
    this.blockedUntil = 0;

    this.lastQRDataUrl = null;
    this.lastQRAt = 0;

    this.qrWaiters = [];
  }

  setState(next) {
    if (this.state === next) return;
    const from = this.state;
    this.prevState = from;
    this.state = next;
    console.log(`🔁 WhatsApp(Baileys) state: ${from} -> ${next}`);
  }

  isBlocked() {
    return this.blockedUntil && Date.now() < this.blockedUntil;
  }

  _ensureReadyPromise() {
    if (this.readyPromise && this.resolveReady) return;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  async ensureConnecting({ forceNewSession = false } = {}) {
    if (this.isBlocked()) {
      this.setState(STATES.BLOCKED);
      const mins = Math.round((this.blockedUntil - Date.now()) / 60000);
      console.log(
        `⏳ WhatsApp(Baileys) blocked backoff ~${mins} دقيقة. لن نحاول الاتصال الآن.`,
      );
      return;
    }

    if (this.sock && this.state === STATES.CONNECTED) {
      return;
    }

    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._connectInternal({ forceNewSession }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async _connectInternal({ forceNewSession = false } = {}) {
    if (this.sock) return;

    this.setState(STATES.CONNECTING);
    this.isReady = false;
    this._ensureReadyPromise();

    if (forceNewSession) {
      await clearMongoAuth().catch(() => {});
      this.lastQRDataUrl = null;
      this.lastQRAt = 0;
    }

    let authState;
    try {
      authState = await useMongoAuthState();
    } catch (err) {
      console.error("❌ فشل تحميل حالة واتساب من MongoDB:", err.message);
      this.setState(STATES.CLOSED);
      throw err;
    }

    try {
      this.sock = makeWASocket({
        auth: authState.state,
        logger: baileysLogger,
        printQRInTerminal: false,
        syncFullHistory: false,
      });
    } catch (err) {
      console.error("❌ فشل تهيئة سوكيت واتساب (Baileys):", err.message);
      this.sock = null;
      this.setState(STATES.CLOSED);
      throw err;
    }

    this.sock.ev.on("creds.update", authState.saveCreds);
    this.sock.ev.on("connection.update", (update) => this._handleConnectionUpdate(update));
  }

  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const now = Date.now();
      if (!this.lastQRDataUrl || now - this.lastQRAt > QR_RECENT_MS) {
        try {
          const dataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          this.lastQRDataUrl = dataUrl;
          this.lastQRAt = now;
          saveQRToDB(dataUrl).catch(() => {});

          const qrText = await QRCode.toString(qr, { type: "terminal", small: true });
          console.log("\n📱 امسح رمز QR بواسطة واتساب (WhatsApp > Linked Devices):\n");
          console.log(qrText);
          console.log("\n   أو افتح في المتصفح: GET /api/v1/otp/qr\n");
        } catch (e) {
          console.log("QR (raw):", qr);
        }
      }
      if (this.state !== STATES.CONNECTED) {
        this.setState(STATES.WAITING_FOR_QR);
        this._notifyQrWaiters();
      }
    }

    if (connection === "open") {
      this._onOpen();
      return;
    }

    if (connection === "close") {
      await this._onClose(lastDisconnect);
    }
  }

  _onOpen() {
    this.isReady = true;
    this.reconnectAttempts = 0;
    this.blockedUntil = 0;
    this.lastQRDataUrl = null;
    this.lastQRAt = 0;
    clearQRFromDB().catch(() => {});
    this.setState(STATES.CONNECTED);
    if (this.resolveReady) this.resolveReady();
    console.log("✅ واتساب (Baileys) متصل وجاهز لإرسال OTP.");
  }

  async _onClose(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
    const errMsg = lastDisconnect?.error?.message || "";
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
    const isForbidden = statusCode === 403;

    this.isReady = false;
    this.sock = null;
    this._ensureReadyPromise();

    const isBadAuth =
      isLoggedOut ||
      isForbidden ||
      /Invalid private key|Uint8Array|invalid.*key|bad.*auth/i.test(errMsg);

    if (isBadAuth) {
      console.log(
        "⚠️ جلسة واتساب (Baileys) تالفة أو منتهية. مسح الجلسة وطلب QR جديد:",
        errMsg || statusCode,
      );
      await clearMongoAuth().catch((e) => {
        console.error("❌ فشل مسح الجلسة من MongoDB:", e.message);
      });
      this.lastQRDataUrl = null;
      this.lastQRAt = 0;
      this.setState(STATES.CLOSED);
      return;
    }

    this.reconnectAttempts += 1;
    const isConnectionTerminated = /Connection Terminated|Connection Closed/i.test(errMsg);

    if (this.reconnectAttempts >= RECONNECT_BLOCK_AFTER && isConnectionTerminated) {
      const blockMs = 5 * 60 * 1000;
      this.blockedUntil = Date.now() + blockMs;
      this.setState(STATES.BLOCKED);
      console.log(
        "⚠️ واتساب يغلق الاتصال بشكل متكرر (غالباً بسبب IP السيرفر). " +
          `إيقاف المحاولات لمدة ${blockMs / 60000} دقيقة (محاولات متتالية: ${this.reconnectAttempts}).`,
      );
      console.log(
        "💡 إن استمر: جرّب تشغيل البوت من شبكة منزلية؛ عناوين VPS/داتاسنتر قد تُقيّد من واتساب.",
      );
      this.setState(STATES.CLOSED);
      return;
    }

    const baseDelay =
      isConnectionTerminated && this.reconnectAttempts <= 3
        ? 20_000
        : RECONNECT_BASE_DELAY_MS;
    const delay = Math.min(
      baseDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)),
      RECONNECT_MAX_DELAY_MS,
    );

    this.setState(STATES.CLOSED);
    console.log(
      "🔄 انقطع الاتصال بواتساب (Baileys) (",
      errMsg || statusCode || "Connection Failure",
      "). إعادة المحاولة بعد",
      Math.round(delay / 1000),
      "ثانية (محاولة",
      this.reconnectAttempts,
      ").",
    );

    setTimeout(() => {
      this.ensureConnecting().catch((err) => {
        console.error("❌ فشل إعادة محاولة اتصال واتساب (Baileys):", err.message);
      });
    }, delay);
  }

  _notifyQrWaiters() {
    if (!this.qrWaiters.length) return;
    const payload = {
      connected: this.isReady,
      qrDataUrl: this.lastQRDataUrl,
    };
    for (const { resolve } of this.qrWaiters) {
      resolve(payload);
    }
    this.qrWaiters = [];
  }

  async getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS_DEFAULT) {
    if (this.isReady && this.sock) {
      return { connected: true, qrDataUrl: null };
    }

    const now = Date.now();
    if (this.lastQRDataUrl && now - this.lastQRAt <= QR_RECENT_MS) {
      return { connected: false, qrDataUrl: this.lastQRDataUrl };
    }

    if (!this.lastQRDataUrl) {
      const dbQr = await getQRFromDB().catch(() => null);
      if (dbQr) {
        this.lastQRDataUrl = dbQr;
        this.lastQRAt = Date.now();
        return { connected: false, qrDataUrl: dbQr };
      }
    }

    if (!this.isBlocked()) {
      await this.ensureConnecting();
    } else {
      this.setState(STATES.BLOCKED);
    }

    if (this.isReady && this.sock) {
      return { connected: true, qrDataUrl: null };
    }
    if (this.lastQRDataUrl) {
      return { connected: false, qrDataUrl: this.lastQRDataUrl };
    }

    return new Promise((resolve) => {
      const waiter = { resolve };
      this.qrWaiters.push(waiter);

      const timeout = setTimeout(() => {
        const idx = this.qrWaiters.indexOf(waiter);
        if (idx !== -1) this.qrWaiters.splice(idx, 1);

        if (this.isReady && this.sock) {
          resolve({ connected: true, qrDataUrl: null });
        } else {
          resolve({ connected: false, qrDataUrl: this.lastQRDataUrl });
        }
      }, maxWaitMs);

      const originalResolve = waiter.resolve;
      waiter.resolve = (value) => {
        clearTimeout(timeout);
        originalResolve(value);
      };
    });
  }

  async ensureReadyForSend() {
    if (this.isReady && this.sock) return;

    await this.ensureConnecting();

    await Promise.race([
      (async () => {
        this._ensureReadyPromise();
        await this.readyPromise;
      })(),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("WhatsApp connection timeout (45s). حاول مرة أخرى.")),
          WA_READY_TIMEOUT_MS,
        ),
      ),
    ]);

    if (!this.isReady || !this.sock) {
      throw new Error("WhatsApp not ready");
    }
  }

  async forceReconnect() {
    this.blockedUntil = 0;
    this.reconnectAttempts = 0;
    this.isReady = false;
    this.lastQRDataUrl = null;
    this.lastQRAt = 0;

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }

    await clearMongoAuth().catch((e) => {
      console.error("❌ فشل مسح الجلسة في forceReconnect:", e.message);
    });
    await clearQRFromDB().catch(() => {});

    this.setState(STATES.IDLE);
    console.log("🔄 تم مسح جلسة واتساب (Baileys). سيتم طلب QR جديد عند فتح صفحة الربط أو عند الإرسال.");
  }
}

// Singleton
const manager = new BaileysConnectionManager();

// ========= واجهات التصدير المتوافقة مع المشروع =========

/** إرسال OTP كنص عبر واتساب */
export async function sendWhatsAppMessage(phone, text) {
  const jid = phoneToJid(phone);
  if (!jid) throw new Error("Invalid phone number");

  await manager.ensureReadyForSend();
  await manager.sock.sendMessage(jid, { text });
}

/** حالة الجاهزية */
export function isWhatsAppReady() {
  return manager.isReady && manager.sock !== null;
}

/** إعادة ضبط الجلسة (تستخدمها لوحة الأدمن في /whatsapp-reconnect) */
export async function forceReconnect() {
  await manager.forceReconnect();
}

/** واجهة GET /admins/whatsapp-qr */
export async function getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS_DEFAULT) {
  return manager.getQRForWebOrWait(maxWaitMs);
}

// whatsapp-baileys.mjs
import { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import readline from 'readline';

// ────────────────────────────────────────────────
// إذا كنت تستخدم حزمة جاهزة لـ MongoDB auth state
// npm install mongo-baileys
// ────────────────────────────────────────────────
// import { useMongoDBAuthState } from 'mongo-baileys';

// أو نكتب دالة بسيطة يدوية (موصى بها للتحكم الأفضل)

const WA_READY_TIMEOUT_MS = 45000;

// ─── MongoDB Auth State Implementation ────────────────────────────────
async function useMongoAuthState() {
  const uri = process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) throw new Error("Missing MONGO_URI / DB_URI");

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db('whatsapp_sessions');
  const collection = db.collection('auth_state_default');

  const KEY_COLLECTION = 'keys';
  const CREDS_KEY = 'creds';

  async function get(key) {
    const doc = await collection.findOne({ _id: key });
    return doc ? doc.value : null;
  }

  async function set(key, value) {
    await collection.updateOne(
      { _id: key },
      { $set: { value } },
      { upsert: true }
    );
  }

  async function remove(key) {
    await collection.deleteOne({ _id: key });
  }

  async function getCreds() {
    return (await get(CREDS_KEY)) || {};
  }

  async function saveCreds() {
    // يتم استدعاؤها داخل Baileys عند تغيير creds
    await set(CREDS_KEY, state.creds);
  }

  const state = {
    creds: await getCreds(),
    keys: {
      get: async (type, ids) => {
        const data = {};
        for (const id of ids) {
          let value = await get(`${type}:${id}`);
          if (type === 'app-state-sync-key') {
            value = value ? Buffer.from(value) : undefined;
          }
          data[id] = value;
        }
        return data;
      },
      set: async (data) => {
        const ops = [];
        for (const category in data) {
          for (const id in data[category]) {
            const value = data[category][id];
            const key = `${category}:${id}`;
            if (value === undefined) {
              ops.push(remove(key));
            } else {
              let storable = value;
              if (category === 'app-state-sync-key') {
                storable = value ? Buffer.from(value).toString('base64') : null;
              }
              ops.push(set(key, storable));
            }
          }
        }
        await Promise.all(ops);
      }
    }
  };

  return { state, saveCreds, client }; // client لإغلاق الاتصال لاحقًا إن لزم
}

// ─── Connection Manager (Singleton) ────────────────────────────────────
class WhatsAppBaileysManager {
  constructor() {
    this.sock = null;
    this.state = 'idle'; // idle / connecting / waiting_for_qr / connected / closed / blocked
    this.connectPromise = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.reconnectAttempts = 0;
    this.blockedUntil = 0;
    this.mongoClient = null;
  }

  _logState(next) {
    if (this.state === next) return;
    console.log(`🔁 WhatsApp(baileys) state: ${this.state} → ${next}`);
    this.state = next;
  }

  _ensureReadyPromise() {
    if (this.readyPromise && this.resolveReady) return;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  isBlocked() {
    return this.blockedUntil && Date.now() < this.blockedUntil;
  }

  async _initSocket() {
    if (this.sock) return;

    const { state, saveCreds, client } = await useMongoAuthState();
    this.mongoClient = client;

    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 0] }));

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      markOnlineOnConnect: true,
      logger: { level: 'silent' }, // أو 'debug' للتتبع
    });

    // حفظ التغييرات في creds تلقائيًا
    this.sock.ev.on('creds.update', saveCreds);

    this.sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this._logState('waiting_for_qr');
        console.log('📱 امسح رمز QR (baileys):');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.blockedUntil = 0;
        this._logState('connected');
        console.log('✅ WhatsApp (baileys) جاهز.');
        if (this.resolveReady) this.resolveReady();
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error instanceof Boom)?.output?.statusCode;
        console.log('❌ Baileys disconnected. Reason code:', statusCode);

        const shouldReconnect =
          statusCode !== DisconnectReason.loggedOut &&
          statusCode !== DisconnectReason.badSession;

        this._handleDisconnect(statusCode, shouldReconnect);
      }
    });
  }

  async ensureConnected() {
    if (this.isBlocked()) {
      const mins = Math.round((this.blockedUntil - Date.now()) / 60000);
      console.log(`⏳ Baileys blocked backoff ~${mins} دقيقة`);
      return;
    }

    if (this.sock && this.state === 'connected') return;

    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._connectInternal().finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async _connectInternal() {
    this._logState('connecting');
    this._ensureReadyPromise();

    await this._initSocket();

    // Baileys يبدأ الاتصال تلقائيًا عند إنشاء السوكت
    // لكن ننتظر الـ ready عبر promise
    await Promise.race([
      this.readyPromise,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Baileys init timeout')), 20000)
      )
    ]).catch(() => {});
  }

  _handleDisconnect(code, shouldReconnect = true) {
    this._logState('closed');
    this.sock = null;

    const isBadAuth = [DisconnectReason.loggedOut, DisconnectReason.badSession].includes(code);

    if (isBadAuth) {
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts >= 5) {
        this.blockedUntil = Date.now() + 5 * 60 * 1000;
        console.log('⚠️ إيقاف المحاولات 5 دقائق بسبب فشل متكرر');
        return;
      }
    }

    if (!shouldReconnect) return;

    const delay = Math.min(5000 * Math.pow(2, this.reconnectAttempts), 60000);
    console.log(`🔄 إعادة اتصال بعد ${Math.round(delay/1000)} ثانية (محاولة ${this.reconnectAttempts + 1})`);

    setTimeout(() => {
      this.ensureConnected().catch(console.error);
    }, delay);
  }

  async ensureReadyForSend() {
    await this.ensureConnected();

    await Promise.race([
      this.readyPromise,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('WhatsApp timeout (45s)')), WA_READY_TIMEOUT_MS)
      )
    ]);

    if (!this.sock || this.state !== 'connected') {
      throw new Error('WhatsApp Baileys غير جاهز');
    }
  }

  async sendText(phone, text) {
    await this.ensureReadyForSend();

    const digits = String(phone).replace(/\D/g, '');
    if (!digits) throw new Error('رقم الهاتف غير صالح');

    const jid = `${digits}@s.whatsapp.net`;

    await this.sock.sendMessage(jid, { text });
  }

  async destroy() {
    if (this.sock) {
      await this.sock.logout().catch(() => {});
      this.sock.end();
      this.sock = null;
    }
    if (this.mongoClient) {
      await this.mongoClient.close().catch(() => {});
    }
    this._logState('closed');
  }
}

// Singleton
const manager = new WhatsAppBaileysManager();

// ─── Export Interfaces (متوافقة مع الكود القديم) ────────────────────────

export async function sendWhatsAppMessage(phone, text) {
  await manager.sendText(phone, text);
}

export function isWhatsAppReady() {
  return manager.state === 'connected';
}

export async function forceReconnect() {
  manager.blockedUntil = 0;
  manager.reconnectAttempts = 0;

  if (manager.sock) {
    await manager.destroy();
  }

  manager._logState('idle');
  console.log('🔄 تم مسح جلسة Baileys. سيطلب QR جديد عند الاتصال القادم.');
}

export async function getQRForWebOrWait(maxWaitMs = 20000) {
  if (!manager.isBlocked()) {
    await manager.ensureConnected();
  }

  try {
    await Promise.race([
      (async () => {
        if (manager.state === 'connected') return;
        manager._ensureReadyPromise();
        await manager.readyPromise;
      })(),
      new Promise((_, rej) => setTimeout(() => rej(), maxWaitMs))
    ]);
  } catch {}

  return {
    connected: manager.state === 'connected',
    qrDataUrl: null // يظهر QR في الترمينال فقط
  };
}