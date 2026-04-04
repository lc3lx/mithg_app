const express = require("express");
const {
  addGuardian,
  getUserGuardians,
  updateGuardian,
  removeGuardian,
  uploadGuardianDocuments,
  getGuardianQRCode,
  regenerateGuardianQRCode,
  accessChatWithQRCode,
  getPendingGuardianVerifications,
  reviewGuardianVerification,
  getGuardianDetails,
  getGuardianStats,
} = require("../services/guardianService");

const {
  addGuardianValidator,
  updateGuardianValidator,
  removeGuardianValidator,
  uploadGuardianDocumentsValidator,
  getGuardianQRCodeValidator,
  regenerateGuardianQRValidator,
  accessChatWithQRValidator,
  reviewGuardianVerificationValidator,
  getGuardianDetailsValidator,
} = require("../utils/validators/guardianValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

/** مسارات المستخدم فقط — توكن مستخدم + هاتف موثّق (بدون توكن أدمن) */
const guardianUserRouter = express.Router();
guardianUserRouter.use(authService.protect);
guardianUserRouter.use(authService.requirePhoneVerified);

guardianUserRouter.route("/").get(getUserGuardians).post(addGuardianValidator, addGuardian);

guardianUserRouter
  .route("/:id")
  .put(updateGuardianValidator, updateGuardian)
  .delete(removeGuardianValidator, removeGuardian);

guardianUserRouter.post(
  "/:id/documents",
  uploadGuardianDocumentsValidator,
  uploadGuardianDocuments,
);

guardianUserRouter.get("/:id/qr-code", getGuardianQRCodeValidator, getGuardianQRCode);
guardianUserRouter.post(
  "/:id/regenerate-qr",
  regenerateGuardianQRValidator,
  regenerateGuardianQRCode,
);

guardianUserRouter.post("/access-chat", accessChatWithQRValidator, accessChatWithQRCode);

/** مسارات الأدمن فقط — توكن أدمن (لا يُكدّس مع protect المستخدم) */
const guardianAdminRouter = express.Router();
guardianAdminRouter.use(adminService.protectAdmin);

guardianAdminRouter.get("/admin/verifications", getPendingGuardianVerifications);
guardianAdminRouter.get("/admin/stats", getGuardianStats);
guardianAdminRouter.put(
  "/admin/:id/verify",
  reviewGuardianVerificationValidator,
  reviewGuardianVerification,
);
guardianAdminRouter.get(
  "/admin/:id/details",
  getGuardianDetailsValidator,
  getGuardianDetails,
);

module.exports = { guardianUserRouter, guardianAdminRouter };
