const express = require("express");
const {
  getMessagingRequests,
  sendMessagingRequest,
  respondToMessagingRequest,
  cancelMessagingRequest,
  getUserChats,
} = require("../services/messagingRequestService");

const {
  sendMessagingRequestValidator,
  respondToMessagingRequestValidator,
  cancelMessagingRequestValidator,
} = require("../utils/validators/messagingRequestValidator");

const authService = require("../services/authService");
const {
  requireSubscriptionAndVerification,
  requireSubscriptionForMessaging
} = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

// All routes require authentication and phone verification
router.use(authService.protect);
router.use(authService.requirePhoneVerified);

// Messaging requests management
router
  .route("/")
  .get(getMessagingRequests)
  .post(requireSubscriptionAndVerification, sendMessagingRequestValidator, sendMessagingRequest);

router.put(
  "/:id/respond",
  respondToMessagingRequestValidator,
  respondToMessagingRequest
);
router.delete(
  "/:id/cancel",
  cancelMessagingRequestValidator,
  cancelMessagingRequest
);

// User chats (from accepted messaging requests)
router.get("/chats", getUserChats);

module.exports = router;
