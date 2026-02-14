const express = require("express");
const {
  getSubscriptionPackages,
  getAdminSubscriptionPackages,
  createSubscriptionPackage,
  updateSubscriptionPackage,
  deleteSubscriptionPackage,
  subscribeWithPaymentRequest,
  subscribeWithCode,
  getUserSubscriptionStatus,
  approvePaymentRequest,
  rejectPaymentRequest,
  getPaymentRequests,
  getUserPaymentRequests,
  createSubscriptionCode,
  getSubscriptionCodes,
  createReferralCode,
  getReferralCodes,
  updateReferralCode,
  deleteReferralCode,
} = require("../services/subscriptionService");

const {
  createSubscriptionPackageValidator,
  updateSubscriptionPackageValidator,
  subscribeWithPaymentRequestValidator,
  subscribeWithCodeValidator,
  approvePaymentRequestValidator,
  rejectPaymentRequestValidator,
  createSubscriptionCodeValidator,
  createReferralCodeValidator,
  updateReferralCodeValidator,
} = require("../utils/validators/subscriptionValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// Public routes
router.get("/packages", getSubscriptionPackages);

// Admin only routes
router.use("/admin", adminService.protectAdmin);

// Subscription packages management
router
  .route("/admin/packages")
  .get(getAdminSubscriptionPackages)
  .post(createSubscriptionPackageValidator, createSubscriptionPackage);

router
  .route("/admin/packages/:id")
  .put(updateSubscriptionPackageValidator, updateSubscriptionPackage)
  .delete(deleteSubscriptionPackage);

// Payment requests management
router.get("/admin/requests", getPaymentRequests);
router.put(
  "/admin/requests/:id/approve",
  approvePaymentRequestValidator,
  approvePaymentRequest
);
router.put(
  "/admin/requests/:id/reject",
  rejectPaymentRequestValidator,
  rejectPaymentRequest
);

// Subscription codes management
router
  .route("/admin/codes")
  .get(getSubscriptionCodes)
  .post(createSubscriptionCodeValidator, createSubscriptionCode);

// Referral codes (كود إحالة) management
router
  .route("/admin/referral-codes")
  .get(getReferralCodes)
  .post(createReferralCodeValidator, createReferralCode);

router
  .route("/admin/referral-codes/:id")
  .put(updateReferralCodeValidator, updateReferralCode)
  .delete(deleteReferralCode);

// Protected user routes (تحقق الهاتف مطلوب)
router.use(authService.protect);
router.use(authService.requirePhoneVerified);
router.get("/status", getUserSubscriptionStatus);
router.post(
  "/subscribe/request",
  subscribeWithPaymentRequestValidator,
  subscribeWithPaymentRequest
);
router.post("/subscribe/code", subscribeWithCodeValidator, subscribeWithCode);
router.get("/my-requests", getUserPaymentRequests);

module.exports = router;
