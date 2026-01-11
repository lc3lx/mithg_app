const express = require("express");
const {
  submitIdentityVerification,
  getUserVerificationStatus,
  getPendingVerificationRequests,
  reviewVerificationRequest,
  getVerificationRequestDetails,
  getUserVerificationHistory,
  getVerificationStats,
} = require("../services/identityVerificationService");

const {
  submitIdentityVerificationValidator,
  reviewVerificationRequestValidator,
} = require("../utils/validators/identityVerificationValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

// User routes
router.post(
  "/submit",
  submitIdentityVerificationValidator,
  submitIdentityVerification
);
router.get("/status", getUserVerificationStatus);
router.get("/history", getUserVerificationHistory);

// Admin only routes
router.use(adminService.protectAdmin);

router.get("/requests", getPendingVerificationRequests);
router.get("/requests/:id", getVerificationRequestDetails);
router.put(
  "/requests/:id/review",
  reviewVerificationRequestValidator,
  reviewVerificationRequest
);
router.get("/stats", getVerificationStats);

module.exports = router;
