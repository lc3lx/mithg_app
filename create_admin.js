const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Admin = require("./models/adminModel");
require("dotenv").config();

// Connect to database
mongoose
  .connect(process.env.DB_URI)
  .then(() => {
    console.log("✅ Connected to database");
  })
  .catch((err) => {
    console.error("❌ Database connection error:", err);
    process.exit(1);
  });

const createAdmin = async () => {
  try {
    console.log("🔄 Creating admin user...");

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      email: "admin@mithaq-syr.com",
    });

    if (existingAdmin) {
      console.log("ℹ️ Admin already exists:");
      console.log(`   Email: ${existingAdmin.email}`);
      console.log(`   Admin Type: ${existingAdmin.adminType}`);
      console.log(`   Is Active: ${existingAdmin.isActive}`);
      console.log("   Password: admin123 (if not changed)");
      process.exit(0);
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash("admin123", salt);

    // Create super admin
    const admin = await Admin.create({
      name: "Super Admin",
      email: "admin@mithaq-syr.com",
      password: hashedPassword, // This will be hashed by pre-save middleware
      adminType: "super",
      phone: "+966500000000",
      isActive: true,
    });

    console.log("✅ Admin created successfully!");
    console.log(`   Name: ${admin.name}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: admin123`);
    console.log(`   Admin Type: ${admin.adminType}`);
    console.log(`   Phone: ${admin.phone}`);
    console.log(`   Is Active: ${admin.isActive}`);

    console.log("\n🎉 You can now login to the admin panel!");
    console.log("   Use these credentials:");
    console.log("   Email: admin@mithaq-syr.com");
    console.log("   Password: admin123");
  } catch (error) {
    console.error("❌ Error creating admin:", error);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from database");
    process.exit(0);
  }
};

createAdmin();
