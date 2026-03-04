# WhatsApp OTP (whatsapp-web.js)

- **الجلسة**: تُحفظ في **MongoDB فقط** — database: `whatsapp`, collection: `sessions`, document: `main-wa`. لا تخزين session على القرص (مصدر الحقيقة هو MongoDB).
- **QR**: يُعرض **عبر API فقط** (لا طباعة في التيرمنال). استهلاكه من تطبيق Flutter أو من لوحة الأدمن.

## تشغيل السيرفر

- عند التشغيل: إن وُجدت جلسة في MongoDB تُستَرجع تلقائياً ولا يُطلب QR.
- إن لم تكن الجلسة موجودة: يُولَّد QR من حدث `qr` ويُحفظ آخر QR في الذاكرة ويُعاد عبر API.

## إعادة الربط

- **من لوحة الأدمن**: «ربط واتساب و OTP» → «إعادة ربط واتساب» ثم امسح رمز QR الجديد.
- **من API (مع توكن أدمن)**: **POST** `/api/v1/admins/whatsapp-reconnect` لمسح الجلسة من MongoDB وطلب QR جديد.

## Endpoints

### QR للتطبيق (Flutter)

| Method | Path | وصف |
|--------|------|-----|
| GET | `/api/whatsapp/qr` | إرجاع `{ connected, qr, qrRaw }` — صورة QR base64 أو النص الخام. استهلاك من Flutter. |

- `qr`: صورة بصيغة Data URL (base64).
- `qrRaw`: النص الخام للـ QR إن وُجد.

### أدمن (QR + سجلات OTP)

| Method | Path | وصف |
|--------|------|-----|
| GET | `/api/v1/admins/whatsapp-qr` | حالة الاتصال ورمز QR (يحتاج توكن أدمن) |
| POST | `/api/v1/admins/whatsapp-reconnect` | إعادة ربط واتساب (يظهر QR جديد) |
| GET | `/api/v1/admins/otp-records?limit=50` | سجلات OTP |

### OTP (تطبيق/مستخدم)

| Method | Path | Body | وصف |
|--------|------|------|-----|
| POST | `/api/v1/otp/send` | `{ "phone": "+9639xxxxxxxx" }` | إنشاء OTP وإرساله عبر واتساب |
| POST | `/api/v1/otp/verify` | `{ "phone", "code" }` | التحقق من الرمز |

## الملفات

- `mongoSessionStore.js` — مخزن جلسة مخصص: db `whatsapp`, collection `sessions`, id `main-wa`.
- `whatsapp.mjs` — اتصال whatsapp-web.js + RemoteAuth، QR في الذاكرة فقط، تصدير: `sendWhatsAppMessage`, `isWhatsAppReady`, `forceReconnect`, `getQRForWebOrWait`, `getQRForWeb`, `ensureInitialized`.
- `otp.service.mjs` — إنشاء/تحقق OTP وإرسال عبر واتساب.
- `otp.routes.mjs` — مسارات send/verify و GET /otp/qr (صفحة HTML).

## Puppeteer (VPS)

- `headless: true`
- `args: ['--no-sandbox', '--disable-setuid-sandbox']`

## أحداث واتساب (Logs)

- `qr` — تم توليد QR (عرضه عبر API فقط).
- `authenticated` — تم المصادقة.
- `ready` — واتساب جاهز للإرسال.
- `auth_failure` — فشل المصادقة.
- `disconnected` — انقطع الاتصال (الجلسة لا تُحذف من MongoDB إلا عند logout فعلي أو إعادة ربط من الأدمن).
