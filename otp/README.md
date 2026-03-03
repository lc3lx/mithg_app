# WhatsApp OTP (Baileys)

- **أول تشغيل**: الجلسة تُحفظ في **قاعدة البيانات (MongoDB)** فقط — لا يوجد ملف أو مجلد لحذفه.
- **ربط واتساب**: من **لوحة الأدمن** → «ربط واتساب و OTP» يعرض رمز QR وسجلات OTP.

## كيف ترجع تشبّك مرة ثانية؟

بعد إعادة تشغيل السيرفر لا تحتاج حذف أي ملف. إذا انقطع واتساب أو أردت ربط رقم/جهاز جديد:

1. **من لوحة الأدمن (مستحسن)**  
   ادخل إلى **ربط واتساب و OTP** واضغط **«إعادة ربط واتساب»** ثم امسح رمز QR الجديد من واتساب (الأجهزة المرتبطة → ربط جهاز).

2. **من الـ API (مع توكن أدمن)**  
   - **POST** `/api/v1/admins/whatsapp-reconnect` — لمسح الجلسة وطلب QR جديد.  
   - **GET** `/api/v1/admins/whatsapp-qr` — لجلب `{ connected, qrDataUrl }` لعرض QR.

## Endpoints

### OTP (تطبيق/مستخدم)

| Method | Path | Body | وصف |
|--------|------|------|-----|
| POST | `/api/v1/otp/send` | `{ "phone": "+9639xxxxxxxx" }` | إنشاء OTP وإرساله عبر واتساب |
| POST | `/api/v1/otp/verify` | `{ "phone": "+9639xxxxxxxx", "code": "123456" }` | التحقق من الرمز |

- OTP: 6 أرقام، صلاحية دقيقتين.
- حد الطلبات: 100 طلب OTP لكل رقم في الساعة.
- الرسالة المرسلة للمستخدم بالعربية.

### أدمن (QR + سجلات OTP)

| Method | Path | وصف |
|--------|------|-----|
| GET | `/api/v1/admins/whatsapp-qr` | حالة الاتصال ورمز QR (يحتاج توكن أدمن) |
| POST | `/api/v1/admins/whatsapp-reconnect` | إعادة ربط واتساب (يظهر QR جديد) |
| GET | `/api/v1/admins/otp-records?limit=50` | سجلات OTP (آخر الإرسالات) |

## الملفات (ESM)

- `authStore.mjs` — تخزين/استرجاع الجلسة من MongoDB (WhatsappAuth).
- `whatsapp.mjs` — اتصال Baileys، QR، لا يستخدم ملفات.
- `otp.service.mjs` — إنشاء/تخزين/تحقق OTP، حد 100 طلب/رقم/ساعة.
- `otp.routes.mjs` — مسارات Express لـ send/verify.
