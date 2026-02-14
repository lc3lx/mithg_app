const express = require("express");

const {
  blockUser,
  unblockUser,
  getBlockedUsers,
  unblockExpiredBlocks,
  getModerationStats,
  resetUserWarnings,
} = require("../services/userModerationService");

const {
  blockUserValidator,
  unblockUserValidator,
  resetUserWarningsValidator,
} = require("../utils/validators/userModerationValidator");

const adminService = require("../services/adminService");

const router = express.Router();

// مسار الـ moderation للأدمن فقط — نستخدم protectAdmin فقط (توكن الأدمن فيه adminId وليس userId، فـ authService.protect كان يرجّع 401)
router.use(adminService.protectAdmin);

// Check for moderateContent permission
router.use((req, res, next) => {
  if (!req.admin.permissions.moderateContent) {
    return res.status(403).json({
      message: "You don't have permission to moderate users",
    });
  }
  next();
});

// Routes
router.get("/blocked", getBlockedUsers);
router.get("/stats", getModerationStats);

router.put("/users/:id/block", blockUserValidator, blockUser);
router.put("/users/:id/unblock", unblockUserValidator, unblockUser);
router.put(
  "/users/:id/reset-warnings",
  resetUserWarningsValidator,
  resetUserWarnings
);

router.post("/unblock-expired", unblockExpiredBlocks);

module.exports = router;
