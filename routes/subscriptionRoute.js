const express = require("express");
const {
  getSubscriptionPackages,
  createSubscriptionPackage,
  updateSubscriptionPackage,
  subscribeWithPaymentRequest,
  subscribeWithCode,
  getUserSubscriptionStatus,
  approvePaymentRequest,
  rejectPaymentRequest,
  getPaymentRequests,
  getUserPaymentRequests,
  createSubscriptionCode,
  getSubscriptionCodes,
} = require("../services/subscriptionService");

const {
  createSubscriptionPackageValidator,
  updateSubscriptionPackageValidator,
  subscribeWithPaymentRequestValidator,
  subscribeWithCodeValidator,
  approvePaymentRequestValidator,
  rejectPaymentRequestValidator,
  createSubscriptionCodeValidator,
} = require("../utils/validators/subscriptionValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// Public routes
router.get("/packages", getSubscriptionPackages);

// Protected user routes
router.use(authService.protect);
router.get("/status", getUserSubscriptionStatus);
router.post(
  "/subscribe/request",
  subscribeWithPaymentRequestValidator,
  subscribeWithPaymentRequest
);
router.post("/subscribe/code", subscribeWithCodeValidator, subscribeWithCode);
router.get("/my-requests", getUserPaymentRequests);

// Admin only routes
router.use(adminService.protectAdmin);

// Subscription packages management
router
  .route("/packages")
  .post(createSubscriptionPackageValidator, createSubscriptionPackage);

router
  .route("/packages/:id")
  .put(updateSubscriptionPackageValidator, updateSubscriptionPackage);

// Payment requests management
router.get("/requests", getPaymentRequests);
router.put(
  "/requests/:id/approve",
  approvePaymentRequestValidator,
  approvePaymentRequest
);
router.put(
  "/requests/:id/reject",
  rejectPaymentRequestValidator,
  rejectPaymentRequest
);

// Subscription codes management
router
  .route("/codes")
  .get(getSubscriptionCodes)
  .post(createSubscriptionCodeValidator, createSubscriptionCode);

module.exports = router;
