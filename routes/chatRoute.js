const express = require("express");
const {
  getChats,
  getChat,
  createChat,
  sendMessage,
  getChatMessages,
  markAsRead,
  getFriends,
  pollMessages,
  deleteChat,
} = require("../services/chatService");

const {
  getChatsValidator,
  getChatValidator,
  createChatValidator,
  sendMessageValidator,
  markAsReadValidator,
  deleteChatValidator,
} = require("../utils/validators/chatValidator");

const authService = require("../services/authService");
const {
  requireSubscriptionAndVerification,
  requireSubscriptionForMessaging
} = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

// All routes require authentication + OTP verified
router.use(authService.protect);
router.use(authService.requirePhoneVerified);

// Chat routes — عرض المحادثات والرسائل يتطلب اشتراكاً وتوثيقاً (مثل الفرونت)
router.get("/", requireSubscriptionAndVerification, getChats);
router.post("/", requireSubscriptionAndVerification, createChatValidator, createChat);

// Polling for new messages
router.get("/poll", requireSubscriptionAndVerification, pollMessages);

// Chat specific routes
router.get("/:id", getChatValidator, requireSubscriptionAndVerification, getChat);
router.delete("/:id", deleteChatValidator, requireSubscriptionAndVerification, deleteChat);

// Message routes
router.post("/:id/messages", requireSubscriptionAndVerification, sendMessageValidator, sendMessage);
router.get("/:id/messages", getChatValidator, requireSubscriptionAndVerification, getChatMessages);

// Mark as read
router.put("/:id/read", markAsReadValidator, requireSubscriptionAndVerification, markAsRead);

// Friends
router.get("/friends/list", getFriends);

module.exports = router;