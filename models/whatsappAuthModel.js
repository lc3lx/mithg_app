const mongoose = require("mongoose");

/**
 * تخزين حالة اتصال واتساب (Baileys) في قاعدة البيانات بدل الملفات.
 * وثيقة واحدة: _id = 'default'، creds + keys (بدون حذف الملف بعد إعادة التشغيل).
 */
const whatsappAuthSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "default" },
    creds: { type: mongoose.Schema.Types.Mixed },
    /** مفاتيح الإشارة: مفتاح = "type-id" (مثل session-963912345678@s.whatsapp.net)، القيمة = كائن مُسلسَل (مع Buffer كـ base64) */
    keys: { type: mongoose.Schema.Types.Mixed, default: {} },
    /** آخر QR كـ data URL (للعرض من أي instance) */
    lastQRDataUrl: { type: String },
    lastQRAt: { type: Date },
  },
  { _id: true, timestamps: true }
);

module.exports = mongoose.model("WhatsappAuth", whatsappAuthSchema);
