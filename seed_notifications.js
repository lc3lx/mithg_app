const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Notification = require("./models/notificationModel");
const User = require("./models/userModel");
const dbConnection = require("./config/database");

dotenv.config({ path: "./config.env" });
dbConnection();

const seedNotifications = async () => {
  try {
    await Notification.deleteMany({});
    console.log("Existing notifications cleared.");

    // Get some users for testing
    const users = await User.find().limit(5);
    if (users.length < 2) {
      console.log("Not enough users found. Please create some users first.");
      process.exit(1);
    }

    const notifications = [];

    // Create various types of notifications for the first user
    const testUser = users[0];

    if (users.length > 1) {
      notifications.push({
        user: testUser._id,
        type: "friend_request",
        title: "طلب صداقة جديد",
        message: "لديك طلب صداقة جديد من أحمد",
        relatedUser: users[1]._id,
        isRead: false,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });
    }

    notifications.push(
      {
        user: testUser._id,
        type: "new_message",
        title: "رسالة جديدة",
        message: "مرحبا! كيف حالك اليوم؟",
        isRead: false,
        createdAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1 hour ago
      },
      {
        user: testUser._id,
        type: "post_like",
        title: "إعجاب جديد",
        message: "أعجب شخص بمنشورك الأخير",
        isRead: false,
        createdAt: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      },
      {
        user: testUser._id,
        type: "post_comment",
        title: "تعليق جديد",
        message: "رائع! أحب هذا المنشور كثيراً",
        isRead: false,
        createdAt: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      },
      {
        user: testUser._id,
        type: "profile_view",
        title: "زيارة ملف شخصي",
        message: "شخص زار ملفك الشخصي",
        isRead: false,
        createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
      },
      {
        user: testUser._id,
        type: "match_suggestion",
        title: "تطابق جديد!",
        message: "تم العثور على تطابق مناسب لك",
        isRead: false,
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      },
      {
        user: testUser._id,
        type: "security_update",
        title: "تحديث أمني",
        message: "تم تحديث إعدادات الأمان لحسابك",
        isRead: true,
        readAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // read 1 hour ago
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // created 2 hours ago
      },
      {
        user: testUser._id,
        type: "friend_request_accepted",
        title: "تم قبول طلب الصداقة",
        message: "تم قبول طلب صداقتك",
        isRead: true,
        readAt: new Date(Date.now() - 3 * 60 * 60 * 1000), // read 3 hours ago
        createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000), // created 4 hours ago
      }
    );

    await Notification.insertMany(notifications);
    console.log(`✅ Created ${notifications.length} test notifications successfully!`);
    console.log(`📊 Notifications created for user: ${testUser.name || testUser.email}`);

    process.exit();
  } catch (error) {
    console.error("❌ Error seeding notifications:", error);
    process.exit(1);
  }
};

seedNotifications();
