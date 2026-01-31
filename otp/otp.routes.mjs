/**
 * REST routes for OTP: POST /send, POST /verify
 */
import express from "express";
import { sendOTP, verifyOTP } from "./otp.service.mjs";

const router = express.Router();

/**
 * POST /api/otp/send
 * Body: { "phone": "+9639xxxxxxxx" }
 */
router.post("/send", async (req, res) => {
  const phone = req.body?.phone;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف مطلوب (phone)",
    });
  }
  const result = await sendOTP(phone.trim());
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }
  return res.status(200).json({
    success: true,
    message: "تم إرسال رمز التحقق إلى واتساب.",
  });
});

/**
 * POST /api/otp/verify
 * Body: { "phone": "+9639xxxxxxxx", "code": "123456" }
 */
router.post("/verify", (req, res) => {
  const phone = req.body?.phone;
  const code = req.body?.code;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({
      success: false,
      message: "رقم الهاتف مطلوب (phone)",
    });
  }
  if (code === undefined || code === null) {
    return res.status(400).json({
      success: false,
      message: "رمز التحقق مطلوب (code)",
    });
  }
  const result = verifyOTP(phone.trim(), String(code));
  if (!result.success) {
    return res.status(400).json({
      success: false,
      message: result.message,
    });
  }
  return res.status(200).json({
    success: true,
    message: "تم التحقق بنجاح.",
  });
});

export default router;
