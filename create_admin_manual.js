// Simple script to create admin manually
// Run with: node create_admin_manual.js

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./models/adminModel");

// Replace with your actual MongoDB connection string
const DB_URI = process.env.DB_URI || "mongodb://localhost:27017/mithaq-syr";

async function createAdmin() {
  try {
    console.log("🔄 Connecting to database...");
    await mongoose.connect(DB_URI);
    console.log("✅ Connected to database");

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      email: "admin@mithaq-syr.com",
    });
    if (existingAdmin) {
      console.log("ℹ️ Admin already exists");
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Password: admin123 (if not changed)`);
      process.exit(0);
    }

    // Create admin
    console.log("🔄 Creating admin...");
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash("admin123", salt);

    const admin = new Admin({
      name: "Super Admin",
      email: "admin@mithaq-syr.com",
      password: hashedPassword,
      adminType: "super",
      phone: "+966500000000",
      isActive: true,
    });

    await admin.save();

    console.log("✅ Admin created successfully!");
    console.log(`   Name: ${admin.name}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: admin123`);
    console.log(`   Admin Type: ${admin.adminType}`);
    console.log(`   Phone: ${admin.phone}`);

    console.log("\n🎉 You can now login to the admin panel!");
    console.log("   Go to Settings > Admin Login");
    console.log("   Use the credentials above");
  } catch (error) {
    console.error("❌ Error creating admin:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
    process.exit(0);
  }
}

createAdmin();
