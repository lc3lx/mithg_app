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