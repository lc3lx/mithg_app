const mongoose = require("mongoose");
const dotenv = require("dotenv");
const User = require("./models/userModel");
const { createFriendRequestNotification, createSecurityNotification } = require("./services/notificationService");
const dbConnection = require("./config/database");

dotenv.config({ path: "./config.env" });
dbConnection();

const testNotifications = async () => {
  try {
    console.log("🧪 Testing Notifications System...");

    // Get test users
    const users = await User.find().limit(2);
    if (users.length < 2) {
      console.log("❌ Need at least 2 users for testing. Please create users first.");
      process.exit(1);
    }

    const [user1, user2] = users;
    console.log(`👤 Testing with users: ${user1.name || user1.email} and ${user2.name || user2.email}`);

    // Test friend request notification
    console.log("📨 Creating friend request notification...");
    const friendRequestNotification = await createFriendRequestNotification(user1._id, user2._id);
    if (friendRequestNotification) {
      console.log("✅ Friend request notification created successfully");
      console.log(`   📝 Title: ${friendRequestNotification.title}`);
      console.log(`   📝 Message: ${friendRequestNotification.message}`);
    }

    // Test security notification
    console.log("🔒 Creating security notification...");
    const securityNotification = await createSecurityNotification(
      user1._id,
      "تحديث أمني مهم",
      "تم تحديث كلمة المرور الخاصة بك بنجاح"
    );
    if (securityNotification) {
      console.log("✅ Security notification created successfully");
      console.log(`   📝 Title: ${securityNotification.title}`);
      console.log(`   📝 Message: ${securityNotification.message}`);
    }

    console.log("🎉 All notification tests completed successfully!");
    console.log("💡 You can now test the API endpoints:");
    console.log("   GET /api/v1/notifications - Get user notifications");
    console.log("   PUT /api/v1/notifications/mark-all-read - Mark all as read");
    console.log("   POST /api/v1/notifications/test - Create test notifications");

    process.exit();
  } catch (error) {
    console.error("❌ Error testing notifications:", error);
    process.exit(1);
  }
};

testNotifications();
