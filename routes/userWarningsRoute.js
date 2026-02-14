const express = require("express");

const {
  issueWarning,
  getUserWarnings,
  getUserWarningsById,
  resolveWarning,
  appealWarning,
  getMyWarnings,
  getWarningStats,
  bulkResolveWarnings,
  expireOldWarnings,
} = require("../services/userWarningsService");

const {
  issueWarningValidator,
  resolveWarningValidator,
  appealWarningValidator,
  bulkResolveWarningsValidator,
  getUserWarningsValidator,
} = require("../utils/validators/userWarningsValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// Admin routes (require admin authentication)
const adminRouter = express.Router();

// Apply admin middleware to admin routes
adminRouter.use(authService.protect);
adminRouter.use(adminService.protectAdmin);

// Check for moderateContent permission
adminRouter.use((req, res, next) => {
  if (!req.admin.permissions.moderateContent) {
    return res.status(403).json({
      message: "You don't have permission to moderate content",
    });
  }
  next();
});

// Admin warning management routes
adminRouter
  .route("/")
  .get(getUserWarnings)
  .post(issueWarningValidator, issueWarning);

adminRouter.get("/stats/summary", getWarningStats);

adminRouter.put(
  "/bulk-resolve",
  bulkResolveWarningsValidator,
  bulkResolveWarnings
);

adminRouter.post("/expire-old", expireOldWarnings);

adminRouter.route("/:id/resolve").put(resolveWarningValidator, resolveWarning);

adminRouter.get(
  "/users/:userId",
  getUserWarningsValidator,
  getUserWarningsById
);

// User routes (require user authentication and phone verification)
router.use(authService.protect);
router.use(authService.requirePhoneVerified);

// User can appeal their warnings and view their own warnings
router.get("/my-warnings", getMyWarnings);
router.put("/:id/appeal", appealWarningValidator, appealWarning);

// Mount admin routes
router.use("/admin", adminRouter);

module.exports = router;
