/**
 * GET /api/whatsapp/qr — يتطلب توكن أدمن (مثل /api/v1/admins/whatsapp-qr).
 */
const express = require("express");
const adminService = require("../services/adminService");
const router = express.Router();

router.use(adminService.protectAdmin);

router.get("/qr", async (req, res) => {
  try {
    const { getQRForWebOrWait } = await import("../otp/whatsapp.mjs");
    const maxWait = Math.min(parseInt(req.query.wait, 10) || 22000, 60000);
    const data = await getQRForWebOrWait(maxWait);

    if (data.connected) {
      return res.json({ connected: true, qr: null, qrRaw: null });
    }

    res.json({
      connected: false,
      qr: data.qrDataUrl || null,
      qrRaw: data.qrRaw || null,
    });
  } catch (err) {
    return res.status(500).json({
      connected: false,
      error: err.message || "WhatsApp module error",
    });
  }
});

module.exports = router;
