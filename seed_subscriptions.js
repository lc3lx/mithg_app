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

    // باقات بأيام — يمكن إضافة أي عدد (أساسي 15، أساسي 30، بريميوم 15، بريميوم 30، إلخ)
    const subscriptions = await Subscription.insertMany([
      {
        packageType: 'basic',
        name: 'أساسي 30 يوم',
        description: 'حزمة الاشتراك الأساسية لمدة 30 يوماً',
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
        packageType: 'basic',
        name: 'أساسي 15 يوم',
        description: 'حزمة أساسية لمدة 15 يوماً',
        price: 5.99,
        currency: 'USD',
        durationDays: 15,
        features: [
          'الوصول إلى التطابق الأساسي',
          'المراسلة المحدودة'
        ],
        isActive: true,
        maxUsers: null,
        currentUsers: 0,
      },
      {
        packageType: 'premium',
        name: 'بريميوم 30 يوم',
        description: 'حزمة مميزة لمدة 30 يوماً',
        price: 19.99,
        currency: 'USD',
        durationDays: 30,
        features: [
          'خوارزميات التطابق المتقدمة',
          'المراسلة غير المحدودة',
          'أولوية ظهور الملف الشخصي',
          'عوامل التصفية المتقدمة'
        ],
        isActive: true,
        maxUsers: null,
        currentUsers: 0,
      },
      {
        packageType: 'premium',
        name: 'بريميوم 15 يوم',
        description: 'حزمة مميزة لمدة 15 يوماً',
        price: 9.99,
        currency: 'USD',
        durationDays: 15,
        features: [
          'خوارزميات التطابق المتقدمة',
          'المراسلة غير المحدودة',
          'أولوية ظهور الملف الشخصي'
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