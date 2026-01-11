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
} = require("../services/notificationService");

const {
  getNotificationValidator,
  markAsReadValidator,
  deleteNotificationValidator,
  createNotificationValidator,
} = require("../utils/validators/notificationValidator");

const authService = require("../services/authService");

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

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

// Admin routes for creating notifications (optional)
router.use(authService.allowedTo("admin"));
router.post("/", createNotificationValidator, createNotification);

module.exports = router;
