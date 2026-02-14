const express = require("express");
const {
  getNotifications,
  getNotification,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteReadNotifications,
  getNotificationStats,
  createNotification,
  createTestNotifications,
  getAllNotificationsAdmin,
  getNotificationAdmin,
  updateNotificationAdmin,
  deleteNotificationAdmin,
  getNotificationStatsAdmin,
  createAdminBroadcastNotification,
} = require("../services/notificationService");

const {
  getNotificationValidator,
  markAsReadValidator,
  deleteNotificationValidator,
  createNotificationValidator,
  updateNotificationValidator,
  createAdminBroadcastValidator,
} = require("../utils/validators/notificationValidator");

const authService = require("../services/authService");
const adminService = require("../services/adminService");

const router = express.Router();

// Admin routes - full CRUD and statistics access (mounted BEFORE user protect)
const adminRouter = express.Router({ mergeParams: true });

adminRouter
  .route("/")
  .get(getAllNotificationsAdmin)
  .post(createAdminBroadcastValidator, createAdminBroadcastNotification);

adminRouter.get("/stats", getNotificationStatsAdmin);

adminRouter
  .route("/:id")
  .get(getNotificationAdmin)
  .put(updateNotificationValidator, updateNotificationAdmin)
  .delete(deleteNotificationAdmin);

router.use("/admin", adminService.protectAdmin, adminRouter);

// All user routes require user authentication and phone verification
router.use(authService.protect);
router.use(authService.requirePhoneVerified);

// User notification routes
router.route("/").get(getNotifications);

router
  .route("/:id")
  .get(getNotificationValidator, getNotification)
  .delete(deleteNotificationValidator, deleteNotification);

router.put("/:id/read", markAsReadValidator, markAsRead);
router.put("/mark-all-read", markAllAsRead);
router.delete("/delete-read", deleteReadNotifications);
router.get("/stats", getNotificationStats);

// Test route for development (temporary)
router.post("/test", createTestNotifications);

module.exports = router;
