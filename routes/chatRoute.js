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

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

// Chat routes
router.get("/", getChats);
router.post("/", createChatValidator, createChat);

// Polling for new messages
router.get("/poll", pollMessages);

// Chat specific routes
router.get("/:id", getChatValidator, getChat);
router.delete("/:id", deleteChatValidator, deleteChat);

// Message routes
router.post("/:id/messages", sendMessageValidator, sendMessage);
router.get("/:id/messages", getChatValidator, getChatMessages);

// Mark as read
router.put("/:id/read", markAsReadValidator, markAsRead);

// Friends
router.get("/friends/list", getFriends);

module.exports = router;