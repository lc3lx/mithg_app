const nodemailer = require("nodemailer");

/**
 * إرسال بريد إلكتروني (مثل رمز استعادة كلمة المرور)
 * يتطلب في .env: EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS
 * Gmail: استخدم كلمة مرور التطبيق (App Password) وليس كلمة مرور الحساب
 */
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: parseInt(process.env.EMAIL_PORT, 10) || 587,
    secure: process.env.EMAIL_PORT === "465",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOpts = {
    from: process.env.EMAIL_FROM || `Mithaq <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html || options.message.replace(/\n/g, "<br>"),
  };

  await transporter.sendMail(mailOpts);
};

module.exports = sendEmail;
