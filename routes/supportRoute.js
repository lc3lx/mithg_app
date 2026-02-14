const express = require("express");

const authService = require("../services/authService");
const adminService = require("../services/adminService");
const {
  getUserMessages,
  sendUserMessage,
  getAdminThreads,
  getAdminMessages,
  sendAdminMessage,
} = require("../services/supportService");

const router = express.Router();

// Admin support messages
router.use("/admin", adminService.protectAdmin);
router.get("/admin/threads", getAdminThreads);
router.get("/admin/messages/:userId", getAdminMessages);
router.post("/admin/messages/:userId", sendAdminMessage);

// User support messages (تحقق الهاتف مطلوب)
router.use(authService.protect);
router.use(authService.requirePhoneVerified);
router.route("/messages").get(getUserMessages).post(sendUserMessage);

module.exports = router;

