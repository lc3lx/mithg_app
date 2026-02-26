// إزالة الفهرس الفريد (unique) من حقل phone في مجموعة users
// التشغيل من مجلد backend: node drop_phone_unique_index.js

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const mongoose = require("mongoose");

const DB_URI =
  process.env.DB_URI || "mongodb://localhost:27017/mithaq-syr";

async function dropPhoneUniqueIndex() {
  try {
    console.log("🔄 الاتصال بقاعدة البيانات...");
    await mongoose.connect(DB_URI);
    console.log("✅ تم الاتصال");

    const db = mongoose.connection.db;
    const collection = db.collection("users");

    const indexes = await collection.indexes();
    const phoneIndex = indexes.find(
      (idx) => idx.name === "phone_1" || (idx.key && idx.key.phone === 1)
    );

    if (!phoneIndex) {
      console.log("ℹ️ لا يوجد فهرس فريد على phone (ربما مُزال مسبقاً).");
      await mongoose.disconnect();
      process.exit(0);
      return;
    }

    await collection.dropIndex(phoneIndex.name);
    console.log("✅ تم إزالة الفهرس الفريد من phone بنجاح.");
  } catch (err) {
    if (err.code === 27 || err.codeName === "IndexNotFound") {
      console.log("ℹ️ الفهرس غير موجود (ربما مُزال مسبقاً).");
    } else {
      console.error("❌ خطأ:", err.message);
    }
  } finally {
    await mongoose.disconnect();
    console.log("🔄 تم قطع الاتصال.");
    process.exit(0);
  }
}

dropPhoneUniqueIndex();
