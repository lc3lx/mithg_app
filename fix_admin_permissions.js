const mongoose = require('mongoose');
const Admin = require('./models/adminModel');
// Load backend/config.env regardless of cwd
require('dotenv').config();

const fixPermissions = async () => {
  try {
    await mongoose.connect(process.env.DB_URI);
    console.log('✅ Connected to database');

    // Give manageRechargeCodes and manageWallets permissions to all super admins
    const res = await Admin.updateMany(
      { adminType: 'super' },
      {
        $set: {
          'permissions.manageRechargeCodes': true,
          'permissions.manageWallets': true,
        },
      }
    );

    console.log('Updated permissions:', res);
  } catch (err) {
    console.error('Error updating permissions:', err);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
  }
};

fixPermissions();


