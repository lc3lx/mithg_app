# نظام الإشعارات (Notifications System)

## نظرة عامة
نظام إشعارات شامل يدعم أنواع مختلفة من الإشعارات مع إمكانية التفاعل والإدارة.

## الإشعارات الدفعية والبريد الإلكتروني (بدون Firebase)

- **Push (OneSignal):** كل إشعار يُحفظ في قاعدة البيانات يُرسل تلقائياً عبر OneSignal إلى جهاز المستخدم. **لا تحتاج إعداد Firebase** — OneSignal يتولى التسليم حتى لو التطبيق مغلق. المتطلبات في `.env`: `ONESIGNAL_APP_ID` و `ONESIGNAL_REST_API_KEY`.
- **البريد الإلكتروني:** نفس الإشعار يُرسل أيضاً إلى بريد المستخدم (حقل `email` في User). المتطلبات في `.env`: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`.
- **التسلسل:** عند حفظ أي إشعار (post save في notificationModel)، يُرسل أولاً الـ push ثم البريد بشكل غير متزامن حتى لا يعطل الحفظ.

## أنواع الإشعارات المدعومة

### 1. طلبات الصداقة (Friend Requests)
- `friend_request`: إشعار جديد لطلب صداقة
- `friend_request_accepted`: إشعار قبول طلب صداقة
- `friend_request_rejected`: إشعار رفض طلب صداقة

### 2. الرسائل (Messages)
- `new_message`: إشعار رسالة جديدة في الدردشة

### 3. التفاعلات مع المنشورات (Post Interactions)
- `post_like`: إشعار إعجاب بمنشور
- `post_comment`: إشعار تعليق على منشور

### 4. الملف الشخصي (Profile)
- `profile_view`: إشعار زيارة الملف الشخصي

### 5. التطابقات (Matches)
- `match_suggestion`: إشعار اقتراح تطابق جديد

### 6. الأمان والتحديثات (Security & Updates)
- `security_update`: إشعارات أمنية وتحديثات النظام

## API Endpoints

### الحصول على الإشعارات
```http
GET /api/v1/notifications?page=1&limit=20
```
**Response:**
```json
{
  "results": 5,
  "unreadCount": 3,
  "paginationResult": {...},
  "data": [
    {
      "_id": "notification_id",
      "type": "friend_request",
      "title": "طلب صداقة جديد",
      "message": "لديك طلب صداقة جديد",
      "isRead": false,
      "readAt": null,
      "createdAt": "2024-01-01T12:00:00.000Z",
      "relatedUser": {
        "_id": "user_id",
        "name": "أحمد محمد",
        "profileImg": "image_url",
        "isOnline": true
      }
    }
  ]
}
```

### الحصول على إشعار محدد
```http
GET /api/v1/notifications/:id
```

### تحديد إشعار كمقروء
```http
PUT /api/v1/notifications/:id/read
```

### تحديد جميع الإشعارات كمقروءة
```http
PUT /api/v1/notifications/mark-all-read
```

### حذف إشعار
```http
DELETE /api/v1/notifications/:id
```

### حذف جميع الإشعارات المقروءة
```http
DELETE /api/v1/notifications/delete-read
```

### إحصائيات الإشعارات
```http
GET /api/v1/notifications/stats
```
**Response:**
```json
{
  "data": {
    "total": 25,
    "unread": 8,
    "byType": [
      {
        "_id": "friend_request",
        "count": 5,
        "unreadCount": 3
      }
    ]
  }
}
```

## إنشاء إشعارات تجريبية

### للتطوير والاختبار:
```http
POST /api/v1/notifications/test
```
إنشاء إشعارات تجريبية للمستخدم الحالي

### باستخدام Seed Script:
```bash
node seed_notifications.js
```
إنشاء إشعارات تجريبية في قاعدة البيانات

## استخدام دوال المساعدة

### في الخدمات الأخرى:
```javascript
const notificationService = require('./notificationService');

// إنشاء إشعار طلب صداقة
await notificationService.createFriendRequestNotification(senderId, receiverId);

// إنشاء إشعار رسالة جديدة
await notificationService.createMessageNotification(senderId, receiverId, chatId, messageContent);

// إنشاء إشعار إعجاب
await notificationService.createLikeNotification(likerId, postOwnerId, postId);

// إنشاء إشعار تعليق
await notificationService.createCommentNotification(commenterId, postOwnerId, postId, commentContent);

// إنشاء إشعار زيارة ملف شخصي
await notificationService.createProfileViewNotification(viewerId, profileOwnerId);

// إنشاء إشعار تطابق
await notificationService.createMatchNotification(userId1, userId2, matchData);

// إنشاء إشعار أمني
await notificationService.createSecurityNotification(userId, title, message);
```

## التكامل مع الفرونت اند

### 1. نموذج البيانات (NotificationModel)
```dart
class NotificationModel {
  final String id;
  final String type;
  final String title;
  final String message;
  final bool isRead;
  final DateTime? readAt;
  final DateTime createdAt;
  final RelatedUser? relatedUser;
  // ... المزيد من الحقول
}
```

### 2. Repository (NotificationRepo)
```dart
class NotificationRepo {
  Future<Either<String, NotificationsResponse>> getNotifications();
  Future<Either<String, NotificationModel>> markAsRead(String notificationId);
  // ... المزيد من الطرق
}
```

### 3. Cubit لإدارة الحالة (NotificationCubit)
```dart
class NotificationCubit extends Cubit<NotificationState> {
  final NotificationRepo _notificationRepo;

  Future<void> getNotifications();
  Future<void> markAsRead(String notificationId);
  // ... المزيد من الطرق
}
```

## الميزات المتقدمة

### 1. التنظيف التلقائي
- يحتفظ النظام بآخر 100 إشعار لكل مستخدم
- يحذف الإشعارات القديمة تلقائياً

### 2. تجنب التكرار
- إشعارات زيارة الملف الشخصي: مرة واحدة كل 24 ساعة لكل زائر
- إشعارات الرسائل: تمنع الإشعارات المكررة

### 3. الأداء
- فهرسة محسنة للبحث السريع
- استعلامات محسنة مع pagination
- تحميل البيانات ذات الصلة (populate)

## ملاحظات التطوير

1. **الأيقونات**: تأكد من وجود أيقونات SVG لجميع أنواع الإشعارات
2. **الترجمة**: جميع النصوص قابلة للترجمة
3. **الوقت**: عرض الوقت بالتنسيق العربي المناسب
4. **الحالة**: إدارة حالة الإشعارات بشكل صحيح (مقروء/غير مقروء)
5. **الإشعارات الدفعية**: مُفعّلة عبر OneSignal (بدون Firebase). تأكد من تسجيل الجهاز بعد تسجيل الدخول (POST /api/v1/device-tokens) حتى تصل الإشعارات عندما التطبيق مغلق.

## اختبار النظام

1. قم بتشغيل seed script لإنشاء بيانات تجريبية
2. اختبر جميع endpoints من Postman
3. اختبر الفرونت اند مع البيانات الحقيقية
4. اختبر جميع أنواع الإشعارات المختلفة
