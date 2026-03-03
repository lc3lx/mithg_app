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