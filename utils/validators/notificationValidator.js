const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

const NOTIFICATION_TYPES = [
  // User interaction notifications
  "friend_request",
  "friend_request_accepted",
  "friend_request_rejected",
  "new_message",
  "post_like",
  "post_comment",
  "profile_view",
  "match_suggestion",
  "security_update",
  "gallery_view_request",
  "gallery_view_accepted",
  "gallery_view_rejected",
  // Admin broadcast notifications
  "update",
  "promotion",
  "security",
  "welcome",
  "maintenance",
  "general",
];

exports.getNotificationValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),
  validatorMiddleware,
];

// For admin broadcast creation (no single user required)
exports.createAdminBroadcastValidator = [
  body("recipientType")
    .isIn(["all", "premium", "new_users", "inactive", "specific"])
    .withMessage("Invalid recipient type"),

  body("type")
    .isIn(NOTIFICATION_TYPES)
    .withMessage("Invalid notification type"),

  body("title")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Title must be between 1 and 100 characters"),

  body("message")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Message must be between 1 and 500 characters"),

  body("status")
    .optional()
    .isIn(["draft", "scheduled", "sent", "cancelled"])
    .withMessage("Invalid notification status"),

  body("scheduledAt")
    .optional()
    .isISO8601()
    .withMessage("scheduledAt must be a valid ISO date"),

  body("userIds")
    .optional()
    .isArray({ min: 1 })
    .withMessage("userIds must be a non-empty array when recipientType is specific"),

  validatorMiddleware,
];

exports.markAsReadValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),
  validatorMiddleware,
];

exports.deleteNotificationValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),
  validatorMiddleware,
];

// For creating notifications (admin/internal use)
exports.createNotificationValidator = [
  body("user").isMongoId().withMessage("Invalid user ID format"),

  body("type")
    .isIn(NOTIFICATION_TYPES)
    .withMessage("Invalid notification type"),

  body("title")
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Title must be between 1 and 100 characters"),

  body("message")
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Message must be between 1 and 500 characters"),

  body("relatedUser")
    .optional()
    .isMongoId()
    .withMessage("Invalid related user ID format"),

  body("relatedPost")
    .optional()
    .isMongoId()
    .withMessage("Invalid related post ID format"),

  body("relatedChat")
    .optional()
    .isMongoId()
    .withMessage("Invalid related chat ID format"),

  body("relatedMessage")
    .optional()
    .isMongoId()
    .withMessage("Invalid related message ID format"),

  validatorMiddleware,
];

exports.updateNotificationValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),

  body("user")
    .optional()
    .isMongoId()
    .withMessage("Invalid user ID format"),

  body("type")
    .optional()
    .isIn(NOTIFICATION_TYPES)
    .withMessage("Invalid notification type"),

  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Title must be between 1 and 100 characters"),

  body("message")
    .optional()
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage("Message must be between 1 and 500 characters"),

  body("relatedUser")
    .optional()
    .isMongoId()
    .withMessage("Invalid related user ID format"),

  body("relatedPost")
    .optional()
    .isMongoId()
    .withMessage("Invalid related post ID format"),

  body("relatedChat")
    .optional()
    .isMongoId()
    .withMessage("Invalid related chat ID format"),

  body("relatedMessage")
    .optional()
    .isMongoId()
    .withMessage("Invalid related message ID format"),

  body("data").optional(),

  body("recipientType")
    .optional()
    .isIn(["all", "premium", "new_users", "inactive", "specific"])
    .withMessage("Invalid recipient type"),

  body("status")
    .optional()
    .isIn(["draft", "scheduled", "sent", "cancelled"])
    .withMessage("Invalid notification status"),

  body("scheduledAt")
    .optional()
    .isISO8601()
    .withMessage("scheduledAt must be a valid ISO date"),

  body("sentAt")
    .optional()
    .isISO8601()
    .withMessage("sentAt must be a valid ISO date"),

  body("isRead")
    .optional()
    .isBoolean()
    .withMessage("isRead must be a boolean value"),

  body("recipientsCount")
    .optional()
    .isInt({ min: 0 })
    .withMessage("recipientsCount must be a non-negative integer"),

  body("openedCount")
    .optional()
    .isInt({ min: 0 })
    .withMessage("openedCount must be a non-negative integer"),

  validatorMiddleware,
];
