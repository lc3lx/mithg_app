// backend/set_admin_password.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Admin = require('./models/adminModel');
require('dotenv').config({ path: './config.env' });

const TARGET_EMAIL = 'omar1@gmail.com';
const NEW_PASSWORD = 'admin123';

(async () => {
  try {
    await mongoose.connect(process.env.DB_URI);
    const salt = await bcrypt.genSalt(12);
    const hashed = await bcrypt.hash(NEW_PASSWORD, salt);
    const r = await Admin.updateOne({ email: TARGET_EMAIL }, { $set: { password: hashed } });
    console.log('Updated:', r);
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
  }
})();