const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Subscription = require('./models/subscriptionModel');
const User = require('./models/userModel');

// Load environment variables
dotenv.config({ path: './config.env' });

// Connect to database
mongoose.connect(process.env.DB_URI).then(() => {
  console.log('Connected to database');
}).catch((err) => {
  console.error('Database connection error:', err);
  process.exit(1);
});

const seedSubscriptions = async () => {
  try {
    console.log('🌱 Seeding subscription packages...');

    // Clear existing subscriptions
    await Subscription.deleteMany({});
    console.log('🗑️ Cleared existing subscription packages');

    // Create Basic and Premium packages
    const subscriptions = await Subscription.insertMany([
      {
        packageType: 'basic',
        name: 'الأساسي',
        description: 'حزمة الاشتراك الأساسية مع الميزات الأساسية',
        price: 9.99,
        currency: 'USD',
        durationDays: 30,
        features: [
          'الوصول إلى التطابق الأساسي',
          'المراسلة المحدودة',
          'ظهور الملف الشخصي'
        ],
        isActive: true,
        maxUsers: null,
        currentUsers: 0,
      },
      {
        packageType: 'premium',
        name: 'المميز',
        description: 'حزمة الاشتراك المميزة مع جميع الميزات',
        price: 19.99,
        currency: 'USD',
        durationDays: 365,
        features: [
          'خوارزميات التطابق المتقدمة',
          'المراسلة غير المحدودة',
          'أولوية ظهور الملف الشخصي',
          'مكالمات الفيديو',
          'عوامل التصفية المتقدمة',
          'رؤية من شاهد ملفك الشخصي'
        ],
        isActive: true,
        maxUsers: null,
        currentUsers: 0,
      }
    ]);

    console.log(`✅ Created ${subscriptions.length} subscription packages`);
    console.log('📦 Available packages:');
    subscriptions.forEach(pkg => {
      console.log(`   - ${pkg.name}: \$${pkg.price} for ${pkg.durationDays} days`);
    });

    // Update an existing user to have a subscription for testing
    const testUser = await User.findOne({ email: 'alice@example.com' });
    if (testUser) {
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      await User.findByIdAndUpdate(testUser._id, {
        isSubscribed: true,
        subscriptionEndDate: oneYearFromNow,
        subscriptionPackage: 'premium'
      });

      console.log('✅ Updated test user (alice@example.com) with premium subscription');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding subscriptions:', error);
    process.exit(1);
  }
};

seedSubscriptions();