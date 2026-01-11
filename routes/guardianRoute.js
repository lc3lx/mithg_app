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

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

// User routes for managing their own guardians
router.route("/").get(getUserGuardians).post(addGuardianValidator, addGuardian);

router
  .route("/:id")
  .put(updateGuardianValidator, updateGuardian)
  .delete(removeGuardianValidator, removeGuardian);

router.post(
  "/:id/documents",
  uploadGuardianDocumentsValidator,
  uploadGuardianDocuments
);

router.get("/:id/qr-code", getGuardianQRCodeValidator, getGuardianQRCode);
router.post(
  "/:id/regenerate-qr",
  regenerateGuardianQRValidator,
  regenerateGuardianQRCode
);

// Public route for QR code access (doesn't require user authentication)
router.post("/access-chat", accessChatWithQRValidator, accessChatWithQRCode);

// Admin only routes
router.use(adminService.protectAdmin);

router.get("/admin/verifications", getPendingGuardianVerifications);
router.get("/admin/stats", getGuardianStats);
router.put(
  "/admin/:id/verify",
  reviewGuardianVerificationValidator,
  reviewGuardianVerification
);
router.get(
  "/admin/:id/details",
  getGuardianDetailsValidator,
  getGuardianDetails
);

module.exports = router;
