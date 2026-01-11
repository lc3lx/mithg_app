const express = require("express");
const {
  createAdmin,
  getAdmins,
  updateAdmin,
  deleteAdmin,
  adminLogin,
  getAdminProfile,
  getDashboardStats,
  getRecentActivity,
} = require("../services/adminService");

const {
  getChat,
  getChatMessages,
  getAllChats,
  archiveOldMessages,
  getMessageStats,
  cleanupChatMessages,
} = require("../services/chatService");

const {
  createAdminValidator,
  updateAdminValidator,
  adminLoginValidator,
} = require("../utils/validators/adminValidator");

const {
  cleanupChatMessagesValidator,
} = require("../utils/validators/messageValidator");

const adminService = require("../services/adminService");

const router = express.Router();

// Public routes
router.post("/login", adminLoginValidator, adminLogin);

// Protected admin routes
router.use(adminService.protectAdmin);

// Profile management
router.get("/profile", getAdminProfile);

// Super admin only routes
router.use(adminService.restrictToSuperAdmin);
router.route("/").get(getAdmins).post(createAdminValidator, createAdmin);

router.route("/:id").put(updateAdminValidator, updateAdmin).delete(deleteAdmin);

// Dashboard routes (all admin types)
router.use(adminService.protectAdmin);
router.get("/dashboard", getDashboardStats);
router.get("/activity", getRecentActivity);

// Chat monitoring routes (require monitorChats permission)
router.get(
  "/chats",
  (req, res, next) => {
    if (!req.admin.permissions.monitorChats) {
      return res.status(403).json({
        message: "You don't have permission to monitor chats",
      });
    }
    next();
  },
  getAllChats
);

// Get specific chat for monitoring
router.get(
  "/chats/:id",
  (req, res, next) => {
    if (!req.admin.permissions.monitorChats) {
      return res.status(403).json({
        message: "You don't have permission to monitor chats",
      });
    }
    next();
  },
  getChat
);

// Get messages from specific chat for monitoring
router.get(
  "/chats/:id/messages",
  (req, res, next) => {
    if (!req.admin.permissions.monitorChats) {
      return res.status(403).json({
        message: "You don't have permission to monitor chats",
      });
    }
    next();
  },
  getChatMessages
);

// Message management routes (require moderateContent permission)
router.post(
  "/messages/archive-old",
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to manage messages",
      });
    }
    next();
  },
  archiveOldMessages
);

router.get(
  "/messages/stats",
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to view message stats",
      });
    }
    next();
  },
  getMessageStats
);

router.post(
  "/chats/:id/cleanup-messages",
  cleanupChatMessagesValidator,
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to cleanup messages",
      });
    }
    next();
  },
  cleanupChatMessages
);

module.exports = router;
