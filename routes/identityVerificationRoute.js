const express = require("express");
const {
  submitIdentityVerification,
  getUserVerificationStatus,
  getPendingVerificationRequests,
  getAllVerificationRequests,
  reviewVerificationRequest,
  getVerificationRequestDetails,
  getUserVerificationHistory,
  getVerificationStats,
} = require("../services/identityVerificationService");

const {
  submitIdentityVerificationValidator,
  reviewVerificationRequestValidator,
} = require("../utils/validators/identityVerificationValidator");

const uploadImageMiddleware = require("../middlewares/uploadImageMiddleware");
const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// User routes - require user authentication
router.post(
  "/submit",
  authService.protect,
  uploadImageMiddleware.uploadMixOfImages([
    { name: 'documents[0][url]', maxCount: 1 },
    { name: 'documents[1][url]', maxCount: 1 },
    { name: 'documents[2][url]', maxCount: 1 },
  ]),
  submitIdentityVerificationValidator,
  submitIdentityVerification
);
router.get("/status", authService.protect, getUserVerificationStatus);
router.get("/history", authService.protect, getUserVerificationHistory);

// Admin only routes - require admin authentication only
router.get("/requests", adminService.protectAdmin, getPendingVerificationRequests);
router.get("/all-requests", adminService.protectAdmin, getAllVerificationRequests);
router.get("/requests/:id", adminService.protectAdmin, getVerificationRequestDetails);
router.put(
  "/requests/:id/review",
  adminService.protectAdmin,
  reviewVerificationRequestValidator,
  reviewVerificationRequest
);
router.get("/stats", adminService.protectAdmin, getVerificationStats);

module.exports = router;
