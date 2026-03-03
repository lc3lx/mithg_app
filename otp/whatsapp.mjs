// whatsapp-wweb.mjs
import pkg from "whatsapp-web.js";
import qrcode from "qrcode-terminal";
import mongoose from "mongoose";
import { MongoStore } from "wwebjs-mongo";

const { Client, RemoteAuth } = pkg;

// إعداد مدة الانتظار القصوى (45 ثانية)
const WA_READY_TIMEOUT_MS = 45000;

// ========= إعداد MongoStore للجلسة =========
let mongoStore = null;

async function initMongoForWhatsApp() {
  if (mongoStore) return mongoStore;

  const uri = process.env.MONGO_URI || process.env.DB_URI;
  if (!uri) throw new Error("Missing MONGO_URI/DB_URI for WhatsApp session");

  // التحقق مما إذا كان Mongoose متصلاً بالفعل من مكان آخر في المشروع
  if (mongoose.connection.readyState !== 1) {
    await mongoose
      .connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      })
      .catch((err) => {
        console.error("❌ WhatsApp Mongo connect error:", err.message);
        throw err;
      });
  }

  mongoStore = new MongoStore({ mongoose });
  return mongoStore;
}

// ========= Connection Manager واحد (Singleton) =========
class WhatsAppWWebManager {
  constructor() {
    /** @type {Client | null} */
    this.client = null;
    this.state = "idle"; // idle / connecting / waiting_for_qr / connected / closed / blocked
    this.connectPromise = null;
    this.readyPromise = null;
    this.resolveReady = null;
    this.reconnectAttempts = 0;
    this.blockedUntil = 0;
  }

  _logState(next) {
    if (this.state === next) return;
    console.log(`🔁 WhatsApp(wweb) state: ${this.state} -> ${next}`);
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

  async _initClient() {
    if (this.client) return;

    const store = await initMongoForWhatsApp();

    this.client = new Client({
      authStrategy: new RemoteAuth({
        clientId: "default-whatsapp-session",
        store,
        backupSyncIntervalMs: 60 * 1000,
      }),
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },
    });

    this.client.on("qr", (qr) => {
      this._logState("waiting_for_qr");
      console.log("📱 امسح رمز QR (whatsapp-web.js):");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", () => {
      this.reconnectAttempts = 0;
      this.blockedUntil = 0;
      this._logState("connected");
      console.log("✅ WhatsApp (whatsapp-web.js) جاهز.");
      if (this.resolveReady) this.resolveReady();
    });

    this.client.on("disconnected", (reason) => {
      console.log("❌ WhatsApp (whatsapp-web.js) disconnected:", reason);
      this._handleDisconnect(reason);
    });

    this.client.on("auth_failure", (msg) => {
      console.error("⚠️ WhatsApp auth failure:", msg);
      this._handleDisconnect("AUTH_FAILURE");
    });
  }

  async ensureConnected() {
    if (this.isBlocked()) {
      this._logState("blocked");
      const mins = Math.round((this.blockedUntil - Date.now()) / 60000);
      console.log(
        `⏳ WhatsApp(wweb) blocked backoff ~${mins} دقيقة. لن نحاول الآن.`,
      );
      return;
    }

    if (this.client && this.state === "connected") return;

    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this._connectInternal().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async _connectInternal() {
    this._logState("connecting");
    this._ensureReadyPromise();

    await this._initClient();

    try {
      await this.client.initialize();
    } catch (err) {
      console.error("❌ فشل initialize whatsapp-web.js:", err.message);
      this._handleDisconnect(err?.message || "INIT_ERROR");
      throw err;
    }
  }

  _handleDisconnect(reason) {
    this._logState("closed");
    this.reconnectAttempts += 1;
    this.client = null; // تفريغ الكلاينت لإعادة البناء

    const isConnectionTerminated =
      /CONNECTION_CLOSED|CONNECTION_LOST|AUTH_FAILURE/i.test(reason || "");

    if (this.reconnectAttempts >= 5 && isConnectionTerminated) {
      const blockMs = 5 * 60 * 1000;
      this.blockedUntil = Date.now() + blockMs;
      this._logState("blocked");
      console.log(
        `⚠️ إيقاف المحاولات لـ ${blockMs / 60000} دقيقة بسبب الفشل المتكرر.`,
      );
      return;
    }

    const base =
      isConnectionTerminated && this.reconnectAttempts <= 3 ? 20000 : 5000;
    const delay = Math.min(
      base * Math.pow(2, Math.min(this.reconnectAttempts - 1, 4)),
      60000,
    );

    console.log(
      `🔄 محاولة إعادة الاتصال بعد ${Math.round(delay / 1000)} ثانية. (محاولة ${
        this.reconnectAttempts
      })`,
    );

    setTimeout(() => {
      this.ensureConnected().catch((err) =>
        console.error("❌ فشل إعادة الاتصال whatsapp-web.js:", err.message),
      );
    }, delay);
  }

  async ensureReadyForSend() {
    if (this.client && this.state === "connected") return;

    await this.ensureConnected();

    await Promise.race([
      this.readyPromise,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("WhatsApp timeout (45s). حاول مرة أخرى.")),
          WA_READY_TIMEOUT_MS,
        ),
      ),
    ]);

    if (!this.client || this.state !== "connected") {
      throw new Error("WhatsApp is not ready");
    }
  }

  async sendText(phone, text) {
    await this.ensureReadyForSend();

    // استخراج الأرقام فقط وتنسيقها بصيغة واتساب ويب
    const digits = String(phone).replace(/\D/g, "");
    if (!digits) throw new Error("رقم الهاتف غير صالح");

    const chatId = `${digits}@c.us`;

    await this.client.sendMessage(chatId, text);
  }
}

// Singleton
const manager = new WhatsAppWWebManager();

// ========= واجهات التصدير المتوافقة مع المشروع =========

// 1) إرسال رسالة OTP (نصية) عبر WhatsApp
export async function sendWhatsAppMessage(phone, text) {
  await manager.sendText(phone, text);
}

// 2) حالة الجاهزية (متصل أم لا)
export function isWhatsAppReady() {
  return manager.state === "connected";
}

// 3) إعادة ضبط الجلسة لإجبار ربط جديد (تستخدمها لوحة الأدمن في /whatsapp-reconnect)
export async function forceReconnect() {
  manager.blockedUntil = 0;
  manager.reconnectAttempts = 0;

  if (manager.client) {
    try {
      await manager.client.logout();
      await manager.client.destroy();
    } catch {
      // تجاهل الأخطاء أثناء التدمير
    }
    manager.client = null;
  }

  manager._logState("idle");
  console.log("🔄 تم مسح جلسة whatsapp-web.js. سيتطلب QR جديد عند أول اتصال.");
}

// 4) واجهة متوافقة مع Baileys لعرض حالة الاتصال من لوحة الأدمن
//    (الآن لا نرجع QR كصورة، بل فقط حالة الاتصال؛ QR يُعرض في الترمينال).
export async function getQRForWebOrWait(maxWaitMs = 20000) {
  // نحاول الاتصال إن لم نكن في حالة blocked
  if (!manager.isBlocked()) {
    await manager.ensureConnected();
  }

  // ننتظر حتى يتصل أو تنتهي المهلة
  try {
    await Promise.race([
      (async () => {
        if (manager.state === "connected") return;
        manager._ensureReadyPromise();
        await manager.readyPromise;
      })(),
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("WhatsApp (whatsapp-web.js) QR wait timeout")),
          maxWaitMs,
        ),
      ),
    ]);
  } catch {
    // نتجاهل الخطأ هنا، ونرجع الحالة فقط
  }

  const connected = manager.state === "connected";
  return { connected, qrDataUrl: null };
}
