/**
 * تخزين حالة اتصال واتساب (Baileys) في MongoDB بدل الملفات.
 * يستخدم موديل WhatsappAuth (وثيقة واحدة _id: 'default').
 */
import { createRequire } from "module";
import { BufferJSON } from "@whiskeysockets/baileys/lib/Utils/generics.js";
import { proto } from "@whiskeysockets/baileys/WAProto/index.js";

const require = createRequire(import.meta.url);
const WhatsappAuth = require("../models/whatsappAuthModel.js");

const DOC_ID = "default";
const MUTEX_WAIT_MS = 5000;
let writeLock = null;

async function withLock(fn) {
  while (writeLock) {
    await new Promise((r) => setTimeout(r, 50));
  }
  writeLock = Promise.resolve()
    .then(fn)
    .finally(() => {
      writeLock = null;
    });
  return writeLock;
}

async function loadDoc() {
  const doc = await WhatsappAuth.findById(DOC_ID).lean();
  return doc || { _id: DOC_ID, creds: null, keys: {} };
}

async function saveDoc(update) {
  await withLock(async () => {
    await WhatsappAuth.findOneAndUpdate(
      { _id: DOC_ID },
      { $set: update },
      { upsert: true, new: true },
    );
  });
}

/**
 * يُرجع state + saveCreds متوافقة مع Baileys (بدل useMultiFileAuthState).
 * creds و keys يُخزّنان في MongoDB.
 */
export async function useMongoAuthState() {
  const raw = await loadDoc();
  const creds = raw.creds
    ? JSON.parse(JSON.stringify(raw.creds), BufferJSON.reviver)
    : null;
  const keysStore = raw.keys && typeof raw.keys === "object" ? raw.keys : {};

  const keys = {
    get: async (type, ids) => {
      const data = {};
      for (const id of ids) {
        const key = `${type}-${id}`.replace(/\//g, "__").replace(/:/g, "-");
        let value = keysStore[key];
        if (value == null) {
          data[id] = null;
          continue;
        }
        if (typeof value === "string") {
          try {
            value = JSON.parse(value, BufferJSON.reviver);
          } catch {
            data[id] = null;
            continue;
          }
        }
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        data[id] = value;
      }
      return data;
    },
    set: async (data) => {
      const flat = {};
      for (const category of Object.keys(data)) {
        for (const id of Object.keys(data[category])) {
          const value = data[category][id];
          const file = `${category}-${id}`
            .replace(/\//g, "__")
            .replace(/:/g, "-");
          flat[file] =
            value == null ? null : JSON.stringify(value, BufferJSON.replacer);
        }
      }
      await WhatsappAuth.findOneAndUpdate(
        { _id: DOC_ID },
        { $set: { keys: flat } },
        { upsert: true },
      );
    },
  };

  const saveCreds = async () => {
    const toSave = creds ? JSON.stringify(creds, BufferJSON.replacer) : null;
    const parsed = toSave ? JSON.parse(toSave, BufferJSON.reviver) : null;
    await saveDoc({ creds: parsed });
  };

  return {
    state: {
      creds: creds || initAuthCreds(),
      keys,
    },
    saveCreds,
  };
}

/**
 * مسح جلسة واتساب من قاعدة البيانات (لإعادة الربط وعرض QR من جديد).
 */
export async function clearMongoAuth() {
  await WhatsappAuth.findOneAndUpdate(
    { _id: DOC_ID },
    { $set: { creds: null, keys: {} } },
    { upsert: true },
  );
}

function initAuthCreds() {
  return {
    noiseKey: { public: new Uint8Array(32), private: new Uint8Array(32) },
    pairingEphemeralKeyPair: {
      public: new Uint8Array(32),
      private: new Uint8Array(32),
    },
    signedIdentityKey: {
      public: new Uint8Array(32),
      private: new Uint8Array(32),
    },
    signedPreKey: {
      keyPair: { public: new Uint8Array(32), private: new Uint8Array(32) },
      signature: new Uint8Array(64),
      keyId: 0,
    },
    registrationId: 0,
    advSecretKey: "",
    me: null,
    account: null,
    signalIdentities: [],
    firstUnuploadedPreKeyId: 0,
    nextPreKeyId: 0,
    accountSyncCounter: 0,
    accountSettings: { unarchiveChats: true },
    processedHistoryMessages: [],
    registered: false,
    pairingCode: undefined,
    lastPropHash: undefined,
    routingInfo: undefined,
  };
}
