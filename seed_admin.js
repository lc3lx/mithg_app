const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Admin = require('./models/adminModel');
const bcrypt = require('bcryptjs');

// Load environment variables
dotenv.config({ path: './config.env' });

// Connect to database
mongoose.connect(process.env.DB_URI).then(() => {
  console.log('Connected to database');
}).catch((err) => {
  console.error('Database connection error:', err);
  process.exit(1);
});

const seedAdmin = async () => {
  try {
    console.log('🌱 Seeding admin user...');

    // Clear existing admins (optional - remove this line if you want to keep existing admins)
    await Admin.deleteMany({});
    console.log('🗑️ Cleared existing admins');

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    // Create super admin
    const superAdmin = await Admin.create({
      name: 'Super Admin',
      email: 'admin@mithaq-syr.com',
      password: hashedPassword,
      adminType: 'super',
      phone: '+966500000000',
      isActive: true,
    });

    console.log('✅ Created super admin:');
    console.log(`   - Name: ${superAdmin.name}`);
    console.log(`   - Email: ${superAdmin.email}`);
    console.log(`   - Password: admin123`);
    console.log(`   - Admin Type: ${superAdmin.adminType}`);

    // Create regular admin
    const hashedRegularPassword = await bcrypt.hash('admin456', salt);
    const regularAdmin = await Admin.create({
      name: 'Regular Admin',
      email: 'admin2@mithaq-syr.com',
      password: hashedRegularPassword,
      adminType: 'male', // or 'female' depending on gender
      phone: '+966511111111',
      isActive: true,
    });

    console.log('✅ Created regular admin:');
    console.log(`   - Name: ${regularAdmin.name}`);
    console.log(`   - Email: ${regularAdmin.email}`);
    console.log(`   - Password: admin456`);
    console.log(`   - Admin Type: ${regularAdmin.adminType}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding admin:', error);
    process.exit(1);
  }
};

seedAdmin();
