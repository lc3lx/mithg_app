/**
 * Custom store for whatsapp-web.js RemoteAuth.
 * Stores session in MongoDB only: database "whatsapp", collection "sessions", document _id "main-wa".
 * No session files on disk; zip is read/written only during save/extract.
 */
const fs = require("fs");
const path = require("path");

const SESSION_ID = "main-wa";
const DB_NAME = "whatsapp";
const COLLECTION_NAME = "sessions";

class MongoSessionStore {
  /**
   * @param {{ mongoose: import('mongoose').Mongoose }} options - mongoose instance (will use connection to db "whatsapp")
   */
  constructor({ mongoose } = {}) {
    if (!mongoose) throw new Error("Mongoose instance is required for MongoSessionStore.");
    this.mongoose = mongoose;
  }

  _getCollection() {
    const db = this.mongoose.connection.useDb(DB_NAME).db;
    return db.collection(COLLECTION_NAME);
  }

  /**
   * RemoteAuth calls with { session: "RemoteAuth-main-wa" } (sessionName).
   */
  async sessionExists(options) {
    const col = this._getCollection();
    const doc = await col.findOne({ _id: SESSION_ID });
    return !!doc;
  }

  /**
   * RemoteAuth calls with { session: path.join(dataPath, sessionName) } (full path to dir; zip is at session + ".zip").
   */
  async save(options) {
    const zipPath = `${options.session}.zip`;
    if (!fs.existsSync(zipPath)) {
      throw new Error(`Session zip not found: ${zipPath}`);
    }
    const data = fs.readFileSync(zipPath);
    const col = this._getCollection();
    await col.updateOne(
      { _id: SESSION_ID },
      { $set: { _id: SESSION_ID, data, updatedAt: new Date() } },
      { upsert: true }
    );
  }

  /**
   * RemoteAuth calls with { session: "RemoteAuth-main-wa", path: compressedSessionPath }.
   */
  async extract(options) {
    const col = this._getCollection();
    const doc = await col.findOne({ _id: SESSION_ID });
    if (!doc || !doc.data) throw new Error("No session found in MongoDB.");
    const dir = path.dirname(options.path);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(options.path, Buffer.from(doc.data));
  }

  /**
   * RemoteAuth calls with { session: "RemoteAuth-main-wa" }.
   */
  async delete(options) {
    const col = this._getCollection();
    await col.deleteOne({ _id: SESSION_ID });
  }
}

module.exports = MongoSessionStore;
