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
  unverifyUserIdentity,
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
  warnChatParticipants,
} = require("../services/chatService");

const {
  createAdminValidator,
  updateAdminValidator,
  adminLoginValidator,
} = require("../utils/validators/adminValidator");

const {
  cleanupChatMessagesValidator,
  warnChatParticipantsValidator,
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

// Bootstrap أدمن افتراضي: معطّل في الإنتاج. فعّل فقط بـ ALLOW_DEFAULT_ADMIN_BOOTSTRAP=true ثم عطّله بعد الاستخدام.
if (process.env.ALLOW_DEFAULT_ADMIN_BOOTSTRAP === "true") {
  router.post("/create-default-admin", async (req, res) => {
    try {
      const Admin = require("../models/adminModel");
      const bcrypt = require("bcryptjs");
      const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
      if (
        !bootstrapSecret ||
        req.headers["x-bootstrap-secret"] !== bootstrapSecret
      ) {
        return res.status(404).json({ message: "Not found" });
      }

      const existingAdmin = await Admin.findOne({
        email: "admin@mithaq-syr.com",
      });
      if (existingAdmin) {
        return res.status(400).json({ message: "Admin already exists" });
      }

      const initialPassword =
        process.env.DEFAULT_ADMIN_INITIAL_PASSWORD || "admin123";
      const salt = await bcrypt.genSalt(12);
      const hashedPassword = await bcrypt.hash(initialPassword, salt);

      const defaultAdmin = await Admin.create({
        name: "Super Admin",
        email: "admin@mithaq-syr.com",
        password: hashedPassword,
        adminType: "super",
        phone: "+966500000000",
        isActive: true,
      });

      res.status(201).json({
        message: "Admin created successfully",
        admin: {
          id: defaultAdmin._id,
          name: defaultAdmin.name,
          email: defaultAdmin.email,
          adminType: defaultAdmin.adminType,
        },
      });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error creating admin", error: error.message });
    }
  });
}

// Protected admin routes
router.use(adminService.protectAdmin);

// Device tokens for push notifications (Admin)
router.post("/device-tokens", async (req, res, next) => {
  try {
    const { playerId, platform } = req.body;
    const adminId = req.admin._id;

    if (!playerId || !platform) {
      return res.status(400).json({ message: "playerId و platform مطلوبين" });
    }

    const DeviceToken = require("../models/deviceTokenModel");
    const token = await DeviceToken.findOneAndUpdate(
      { user: adminId, playerId },
      {
        platform,
        isActive: true,
        lastSeenAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ data: token });
  } catch (error) {
    next(error);
  }
});

router.delete("/device-tokens/:playerId", async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const adminId = req.admin._id;

    const DeviceToken = require("../models/deviceTokenModel");
    await DeviceToken.findOneAndUpdate(
      { user: adminId, playerId },
      { isActive: false, lastSeenAt: new Date() }
    );

    res.status(200).json({ message: "تم إزالة الرمز المرجعي للجهاز" });
  } catch (error) {
    next(error);
  }
});

// WhatsApp QR & OTP (admin only)
router.get("/whatsapp-qr", async (req, res) => {
  try {
    const { getQRForWebOrWait } = await import("../otp/whatsapp.mjs");
    const data = await getQRForWebOrWait(22000);
    return res.json({
      connected: data.connected,
      qrDataUrl: data.qrDataUrl || null,
      connectionError: data.connectionError || undefined,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "WhatsApp module error" });
  }
});
router.post("/whatsapp-reconnect", async (req, res) => {
  try {
    const { forceReconnect } = await import("../otp/whatsapp.mjs");
    await forceReconnect();
    return res.json({ message: "تم طلب إعادة ربط واتساب. امسح رمز QR الجديد." });
  } catch (err) {
    return res.status(500).json({ message: err.message || "WhatsApp reconnect failed" });
  }
});
router.get("/otp-records", async (req, res) => {
  try {
    const { getOtpRecords } = await import("../otp/otp.service.mjs");
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const records = await getOtpRecords(limit);
    return res.json({ records });
  } catch (err) {
    return res.status(500).json({ message: err.message || "OTP records error" });
  }
});

const {
  getPaymentMethodSettings,
  updatePaymentMethodSettings,
} = require("../services/paymentMethodSettingsService");
router.get("/payment-methods", getPaymentMethodSettings);
router.put("/payment-methods", updatePaymentMethodSettings);

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
router.put(
  "/users/:id/unverify",
  (req, res, next) => {
    if (!req.admin.permissions.verifyIdentities) {
      return res.status(403).json({
        message: "You don't have permission to verify identities",
      });
    }
    next();
  },
  unverifyUserIdentity
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

const requireManageWallets = (req, res, next) => {
  if (!req.admin.permissions.manageWallets) {
    return res.status(403).json({
      message: "You don't have permission to manage wallets",
    });
  }
  next();
};

router.get("/wallets/stats", requireManageWallets, walletService.getWalletStats);
router.get("/wallets/app", requireManageWallets, walletService.getAppWallet);
router.get(
  "/wallets/user/:userId",
  requireManageWallets,
  walletService.getUserWallet,
);
router.post("/wallets/app", requireManageWallets, walletService.createAppWallet);
router.post(
  "/wallets/user/:userId",
  requireManageWallets,
  walletService.createUserWallet,
);
router.put("/wallets/:id/credit", requireManageWallets, walletService.addCredit);
router.put("/wallets/:id/debit", requireManageWallets, walletService.addDebit);
router.post(
  "/wallets/transfer",
  requireManageWallets,
  walletService.transferBetweenWallets,
);
router.get(
  "/wallets/:id/transactions",
  requireManageWallets,
  walletService.getWalletTransactions,
);

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

const requireManageRechargeCodes = (req, res, next) => {
  if (!req.admin.permissions.manageRechargeCodes) {
    return res.status(403).json({
      message: "You don't have permission to manage recharge codes",
    });
  }
  next();
};

router.post(
  "/recharge-codes/generate",
  requireManageRechargeCodes,
  rechargeService.generateRechargeCodes,
);
router.get(
  "/recharge-codes/stats",
  requireManageRechargeCodes,
  rechargeService.getRechargeStats,
);
router.get(
  "/recharge-codes/export",
  requireManageRechargeCodes,
  rechargeService.exportRechargeCodes,
);
router.get(
  "/recharge-codes/:id",
  requireManageRechargeCodes,
  rechargeService.getRechargeCode,
);
router.put(
  "/recharge-codes/:id",
  requireManageRechargeCodes,
  rechargeService.updateRechargeCode,
);
router.delete(
  "/recharge-codes/:id",
  requireManageRechargeCodes,
  rechargeService.deleteRechargeCode,
);

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

router.post(
  "/chats/:id/warn-participants",
  warnChatParticipantsValidator,
  (req, res, next) => {
    if (!req.admin.permissions.moderateContent) {
      return res.status(403).json({
        message: "You don't have permission to send warnings",
      });
    }
    next();
  },
  warnChatParticipants
);

module.exports = router;
