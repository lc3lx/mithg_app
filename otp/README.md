# WhatsApp OTP (Baileys)

- **أول تشغيل**: يظهر رمز QR في الطرفية → امسحه من واتساب (Linked Devices).
- **الجلسة**: تُحفظ في `otp/auth_info_wa/` فلا تحتاج QR مرة أخرى إلا بعد تسجيل الخروج.

## Endpoints

| Method | Path | Body | وصف |
|--------|------|------|-----|
| POST | `/api/otp/send` | `{ "phone": "+9639xxxxxxxx" }` | إنشاء OTP وإرساله عبر واتساب |
| POST | `/api/otp/verify` | `{ "phone": "+9639xxxxxxxx", "code": "123456" }` | التحقق من الرمز |

- OTP: 6 أرقام، صلاحية دقيقتين.
- حد الطلبات: 3 طلبات OTP لكل رقم في الساعة.
- الرسالة المرسلة للمستخدم بالعربية.

## الملفات (ESM)

- `whatsapp.mjs` — اتصال Baileys، QR، حفظ الجلسة.
- `otp.service.mjs` — إنشاء/تخزين/تحقق OTP، حد الطلبات.
- `otp.routes.mjs` — مسارات Express.
