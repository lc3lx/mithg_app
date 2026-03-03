/**
 * WhatsApp connection via Baileys (QR + session).
 * Session saved in MongoDB so no file deletion needed after server restart.
 *
 * اختياري:
 *  - WHATSAPP_PROXY_URL (مثلاً http://user:pass@host:port) لاستخدام بروكسي عند الاتصال.
 *
 * هذا الملف يعرّف Connection Manager واحد (Singleton) يدير:
 * - حالات الاتصال: idle / connecting / waiting_for_qr / connected / closed / blocked
 * - توليد QR وتخزينه في الذاكرة + MongoDB
 * - استعادة الجلسة من MongoDB أو مسحها عند الفساد/loggedOut
 * - backoff لإعادة المحاولة ومنع محاولات سريعة متكررة
 */
import makeWASocket, { DisconnectReason } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { EventEmitter } from "events";
import {
  useMongoAuthState,
  clearMongoAuth,
  saveQRToDB,
  clearQRFromDB,
  getQRFromDB,
} from "./authStore.mjs";

/** تخفيف لوغات Baileys (لا نعرض JSON و stack trace)، نعتمد على connection.update للرسائل */
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

/**
 * Format phone to WhatsApp JID (e.g. +963912345678 -> 963912345678@s.whatsapp.net)
 */
export function phoneToJid(phone) {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits.length) return null;
  return `${digits}@s.whatsapp.net`;
}

const WA_READY_TIMEOUT_MS = 45000; // 45s (أطول من AwaitingInitialSync)
const RECONNECT_BASE_DELAY_MS = 5000;
const RECONNECT_MAX_DELAY_MS = 60000;
const RECONNECT_BLOCK_AFTER = 5; // بعد 5 فشل متتالي ننتقل لحالة blocked
const QR_WAIT_MAX_MS = 22000;
const QR_RECENT_MS = 60_000; // QR صالح خلال آخر 60 ثانية

const STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  WAITING_FOR_QR: "waiting_for_qr",
  CONNECTED: "connected",
  CLOSED: "closed",
  BLOCKED: "blocked",
};

class WhatsAppConnectionManager {
  constructor() {
    /** @type {ReturnType<typeof makeWASocket> | null} */
    this.sock = null;
    /** @type {string} */
    this.state = STATES.IDLE;
    this.prevState = null;

    this.isReady = false;
    this.readyPromise = null;
    this.resolveReady = null;

    this.connectPromise = null;
    this.reconnectAttempts = 0;
    this.blockedUntil = 0;

    /** آخر QR في الذاكرة */
    this.lastQRDataUrl = null;
    this.lastQRAt = 0;

    /** انتظار الـ QR (قائمة وعود تُحل عند ظهور QR أو اتصال ناجح) */
    this.qrWaiters = [];

    /** لإدارة الأحداث الداخلية (state changes وغيرها) */
    this.emitter = new EventEmitter();
  }

  setState(next) {
    if (this.state === next) return;
    const from = this.state;
    this.prevState = from;
    this.state = next;
    console.log(`🔁 WhatsApp state: ${from} -> ${next}`);
    this.emitter.emit("state_change", { from, to: next });
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

  /**
   * استدعِ هذا قبل أي اتصال جديد. يضمن:
   * - عدم تشغيل أكثر من connect() في نفس الوقت
   * - احترام حالة blocked
   */
  async ensureConnecting({ forceNewSession = false } = {}) {
    if (this.isBlocked()) {
      this.setState(STATES.BLOCKED);
      const waitMin = Math.round((this.blockedUntil - Date.now()) / 60000);
      console.log(
        `⏳ WhatsApp blocked backoff ما يزال فعالاً لـ ~${waitMin} دقيقة. لن نحاول الاتصال الآن.`
      );
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this._connectInternal({ forceNewSession }).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  async _connectInternal({ forceNewSession = false } = {}) {
    if (this.sock) {
      // لدينا سوكيت قائم؛ لا نعيد إنشاءه
      return;
    }

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
        syncFullHistory: false,
        getMessage: async () => undefined,
      });
    } catch (err) {
      console.error("❌ فشل تهيئة سوكيت واتساب:", err.message);
      this.sock = null;
      this.setState(STATES.CLOSED);
      throw err;
    }

    this.sock.ev.on("creds.update", authState.saveCreds);
    this.sock.ev.on("connection.update", (update) => this._handleConnectionUpdate(update));
  }

  async _handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // QR جديد
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
    console.log("✅ واتساب متصل وجاهز لإرسال OTP.");
  }

  async _onClose(lastDisconnect) {
    const statusCode = lastDisconnect?.error?.output?.statusCode ?? null;
    const errMsg = lastDisconnect?.error?.message || "";
    const isLoggedOut = statusCode === DisconnectReason.loggedOut;
    const isForbidden = statusCode === 403;

    this.isReady = false;
    this.sock = null;
    this._ensureReadyPromise(); // نعيد إنشاء promise لمرات لاحقة

    // جلسة فاسدة أو loggedOut => امسح الجلسة واجبر QR جديد
    const isBadAuth =
      isLoggedOut ||
      isForbidden ||
      /Invalid private key|Uint8Array|invalid.*key|bad.*auth/i.test(errMsg);

    if (isBadAuth) {
      console.log("⚠️ جلسة واتساب تالفة أو منتهية. مسح الجلسة وطلب QR جديد:", errMsg || statusCode);
      await clearMongoAuth().catch((e) => {
        console.error("❌ فشل مسح الجلسة من MongoDB:", e.message);
      });
      this.lastQRDataUrl = null;
      this.lastQRAt = 0;
      this.setState(STATES.CLOSED);
      // سيتم الاتصال مجدداً عندما يطلب الـ QR أو عند الإرسال.
      return;
    }

    // إعادة محاولة مع backoff
    this.reconnectAttempts += 1;
    const isConnectionTerminated = /Connection Terminated|Connection Closed/i.test(errMsg);

    if (this.reconnectAttempts >= RECONNECT_BLOCK_AFTER && isConnectionTerminated) {
      const blockMs = 5 * 60 * 1000;
      this.blockedUntil = Date.now() + blockMs;
      this.setState(STATES.BLOCKED);
      console.log(
        "⚠️ واتساب يغلق الاتصال بشكل متكرر (غالباً بسبب IP السيرفر أو البروكسي). " +
          `إيقاف المحاولات لمدة ${blockMs / 60000} دقيقة (محاولات متتالية: ${this.reconnectAttempts}).`
      );
      console.log(
        "💡 إن استمر: جرّب تشغيل البوت من شبكة منزلية أو استخدم بروكسي Residential؛ عناوين VPS/داتاسنتر أو بعض البروكسيات قد تُقيّد."
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
      RECONNECT_MAX_DELAY_MS
    );

    this.setState(STATES.CLOSED);
    console.log(
      "🔄 انقطع الاتصال بواتساب (",
      errMsg || statusCode || "Connection Failure",
      "). إعادة المحاولة بعد",
      Math.round(delay / 1000),
      "ثانية (محاولة",
      this.reconnectAttempts,
      ")."
    );

    setTimeout(() => {
      this.ensureConnecting().catch((err) => {
        console.error("❌ فشل إعادة محاولة اتصال واتساب:", err.message);
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

  /**
   * API داخلي للحصول على QR أو حالة الاتصال، مع انتظار event-based.
   * يُستخدم من GET /admins/whatsapp-qr.
   */
  async getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS) {
    // إذا متصل
    if (this.isReady) {
      return { connected: true, qrDataUrl: null };
    }

    // إذا لدينا QR حديث في الذاكرة أو DB
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

    // إذا لسنا في حالة blocked، ابدأ الاتصال إن لم يكن جارياً
    if (!this.isBlocked()) {
      await this.ensureConnecting();
    } else {
      this.setState(STATES.BLOCKED);
    }

    // بعد بدء الاتصال، قد يُفتح أو يظهر QR أو نفشل
    if (this.isReady) {
      return { connected: true, qrDataUrl: null };
    }
    if (this.lastQRDataUrl) {
      return { connected: false, qrDataUrl: this.lastQRDataUrl };
    }

    // الانتظار event-based مع timeout
    return new Promise((resolve) => {
      const waiter = { resolve };
      this.qrWaiters.push(waiter);

      const timeout = setTimeout(() => {
        // إزالة هذا الـ waiter إن لم يكن قد حُل
        const idx = this.qrWaiters.indexOf(waiter);
        if (idx !== -1) this.qrWaiters.splice(idx, 1);

        if (this.isReady) {
          resolve({ connected: true, qrDataUrl: null });
        } else {
          resolve({ connected: false, qrDataUrl: this.lastQRDataUrl });
        }
      }, maxWaitMs);

      // لو تم الحل قبل الـ timeout، نلغي الـ timeout
      const originalResolve = waiter.resolve;
      waiter.resolve = (value) => {
        clearTimeout(timeout);
        originalResolve(value);
      };
    });
  }

  /**
   * التأكد من أن الاتصال جاهز للإرسال؛ لا يُسمح بالإرسال إلا في حالة connected فعلياً.
   */
  async ensureReadyForSend() {
    if (this.isReady && this.sock) return;

    await this.ensureConnecting();

    await Promise.race([
      this.readyPromise,
      new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error("WhatsApp connection timeout (45s). حاول مرة أخرى.")),
          WA_READY_TIMEOUT_MS
        )
      ),
    ]);

    if (!this.isReady || !this.sock) {
      throw new Error("WhatsApp not ready");
    }
  }

  /**
   * مسح الجلسة وإجبار إنشاء QR جديد عند أول طلب.
   */
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
    console.log("🔄 تم مسح جلسة واتساب. سيتم طلب QR جديد عند فتح صفحة الربط أو عند الإرسال.");
  }
}

// Singleton manager
const manager = new WhatsAppConnectionManager();

/**
 * API القديم للحصول على QR (بدون انتظار طويل).
 * يُستخدم داخلياً فقط، لكن نُبقيه متوافقاً.
 */
export function getQRForWeb() {
  if (manager.isReady) {
    return { connected: true, qrDataUrl: null };
  }
  return { connected: false, qrDataUrl: manager.lastQRDataUrl };
}

/**
 * النسخة المحسّنة المطلوبة من getQRForWebOrWait.
 * تُستخدم في GET /api/v1/admins/whatsapp-qr.
 */
export async function getQRForWebOrWait(maxWaitMs = QR_WAIT_MAX_MS) {
  return manager.getQRForWebOrWait(maxWaitMs);
}

/**
 * إرسال رسالة واتساب (OTP).
 * الواجهة لم تتغيّر، لكن المنطق الآن يمر عبر Connection Manager.
 */
export async function sendWhatsAppMessage(phone, text) {
  const jid = phoneToJid(phone);
  if (!jid) throw new Error("Invalid phone number");

  await manager.ensureReadyForSend();

  await manager.sock.sendMessage(jid, { text });
}

/**
 * حالة الجاهزية للإرسال.
 */
export function isWhatsAppReady() {
  return manager.isReady && manager.sock !== null;
}

/**
 * مسح الجلسة وإعادة الربط من الصفر (يظهر QR جديد عند الطلب).
 * تُستخدم من لوحة الأدمن (whatsapp-reconnect).
 */
export async function forceReconnect() {
  await manager.forceReconnect();
}

