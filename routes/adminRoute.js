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
  getUsersGrowthChart,
  getRevenueGrowthChart,
  getAdminUsers,
  toggleUserSubscription,
  toggleUserActive,
  verifyUserIdentity,
  getAdminActivity,
} = require("../services/adminService");

const { getReportsSummary, getUserReports } = require("../services/reportsService");

const {
  getChatForAdmin,
  getChatMessagesForAdmin,
  getAllChats,
  archiveOldMessages,
  getMessageStats,
  cleanupChatMessages,
  getChatViolations,
  blockChatParticipant,
  blockBothParticipants,
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

// Import routes
const bannedWordsRoute = require("./bannedWordsRoute");
const walletService = require("../services/walletService");
const rechargeService = require("../services/rechargeService");
const rechargeRequestService = require("../services/rechargeRequestService");

const router = express.Router();

// Public routes
router.post("/login", adminLoginValidator, adminLogin);

// Temporary route to create default admin (remove after first use)
router.post("/create-default-admin", async (req, res) => {
  try {
    const Admin = require('../models/adminModel');
    const bcrypt = require('bcryptjs');

    const existingAdmin = await Admin.findOne({ email: 'admin@mithaq-syr.com' });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists' });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    const defaultAdmin = await Admin.create({
      name: 'Super Admin',
      email: 'admin@mithaq-syr.com',
      password: hashedPassword,
      adminType: 'super',
      phone: '+966500000000',
      isActive: true,
    });

    res.status(201).json({
      message: 'Admin created successfully',
      admin: {
        id: defaultAdmin._id,
        name: defaultAdmin.name,
        email: defaultAdmin.email,
        adminType: defaultAdmin.adminType
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating admin', error: error.message });
  }
});

// Protected admin routes
router.use(adminService.protectAdmin);

// Profile management
router.get("/profile", getAdminProfile);

// Reports (require viewReports permission)
router.get(
  "/reports",
  (req, res, next) => {
    if (!req.admin.permissions.viewReports) {
      return res.status(403).json({
        message: "You don't have permission to view reports",
      });
    }
    next();
  },
  getReportsSummary
);
router.get(
  "/user-reports",
  (req, res, next) => {
    if (!req.admin.permissions.viewReports) {
      return res.status(403).json({
        message: "You don't have permission to view reports",
      });
    }
    next();
  },
  getUserReports
);

// Verify user identity (require verifyIdentities permission)
router.put(
  "/users/:id/verify",
  (req, res, next) => {
    if (!req.admin.permissions.verifyIdentities) {
      return res.status(403).json({
        message: "You don't have permission to verify identities",
      });
    }
    next();
  },
  verifyUserIdentity
);

// Super admin only routes
router.use(adminService.restrictToSuperAdmin);
router.route("/").get(getAdmins).post(createAdminValidator, createAdmin);
router.get("/:id/activity", getAdminActivity);
router.route("/:id").put(updateAdminValidator, updateAdmin).delete(deleteAdmin);

// Dashboard routes (all admin types)
router.use(adminService.protectAdmin);
router.get("/dashboard", getDashboardStats);
router.get("/activity", getRecentActivity);
router.get("/charts/users-growth", getUsersGrowthChart);
router.get("/charts/revenue-growth", getRevenueGrowthChart);

// User management routes (all admin types with gender filtering)
router.get("/users", getAdminUsers);
router.put("/users/:id/subscription", toggleUserSubscription);
router.put("/users/:id/active", toggleUserActive);

// Banned words management routes (require manageBannedWords permission)
router.use("/banned-words", bannedWordsRoute);

// Wallet management routes (require manageWallets permission)
router.get(
  "/wallets",
  (req, res, next) => {
    if (!req.admin.permissions.manageWallets) {
      return res.status(403).json({
        message: "You don't have permission to manage wallets",
      });
    }
    next();
  },
  walletService.getWallets
);

router.get("/wallets/stats", walletService.getWalletStats);
router.get("/wallets/app", walletService.getAppWallet);
router.get("/wallets/user/:userId", walletService.getUserWallet);
router.post("/wallets/app", walletService.createAppWallet);
router.post("/wallets/user/:userId", walletService.createUserWallet);
router.put("/wallets/:id/credit", walletService.addCredit);
router.put("/wallets/:id/debit", walletService.addDebit);
router.post("/wallets/transfer", walletService.transferBetweenWallets);
router.get("/wallets/:id/transactions", walletService.getWalletTransactions);

// Recharge codes management routes (require manageRechargeCodes permission)
router.get(
  "/recharge-codes",
  (req, res, next) => {
    if (!req.admin.permissions.manageRechargeCodes) {
      return res.status(403).json({
        message: "You don't have permission to manage recharge codes",
      });
    }
    next();
  },
  rechargeService.getRechargeCodes
);

router.post("/recharge-codes/generate", rechargeService.generateRechargeCodes);
router.get("/recharge-codes/stats", rechargeService.getRechargeStats);
router.get("/recharge-codes/export", rechargeService.exportRechargeCodes);
router.get("/recharge-codes/:id", rechargeService.getRechargeCode);
router.put("/recharge-codes/:id", rechargeService.updateRechargeCode);
router.delete("/recharge-codes/:id", rechargeService.deleteRechargeCode);

// Recharge requests management (require manageSubscriptions permission)
router.get(
  "/recharge-requests",
  (req, res, next) => {
    if (!req.admin.permissions.manageSubscriptions) {
      return res.status(403).json({ message: "You don't have permission to manage recharge requests" });
    }
    next();
  },
  rechargeRequestService.getAllRechargeRequests
);

router.put(
  "/recharge-requests/:id/approve",
  (req, res, next) => {
    if (!req.admin.permissions.manageSubscriptions) {
      return res.status(403).json({ message: "You don't have permission to manage recharge requests" });
    }
    next();
  },
  rechargeRequestService.approveRechargeRequest
);

router.put(
  "/recharge-requests/:id/reject",
  (req, res, next) => {
    if (!req.admin.permissions.manageSubscriptions) {
      return res.status(403).json({ message: "You don't have permission to manage recharge requests" });
    }
    next();
  },
  rechargeRequestService.rejectRechargeRequest
);

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

// Get chats with violations (banned words)
router.get(
  "/chats/violations",
  (req, res, next) => {
    if (!req.admin.permissions.monitorChats) {
      return res.status(403).json({
        message: "You don't have permission to monitor chats",
      });
    }
    next();
  },
  getChatViolations
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
  getChatForAdmin
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
  getChatMessagesForAdmin
);

// Block a participant from a chat permanently
router.put(
  "/chats/:id/block-participant/:userId",
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to block users",
      });
    }
    next();
  },
  blockChatParticipant
);

// Block both participants from a chat permanently
router.put(
  "/chats/:id/block-both",
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to block users",
      });
    }
    next();
  },
  blockBothParticipants
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
