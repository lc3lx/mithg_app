/**
 * GET /api/whatsapp/qr — إرجاع QR لاستهلاكه من تطبيق Flutter.
 * لا يتطلب توكن أدمن (يمكن حمايته لاحقاً إن رغبت).
 */
const express = require("express");
const router = express.Router();

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
