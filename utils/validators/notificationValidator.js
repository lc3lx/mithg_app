const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.getNotificationValidator = [
  param("id").isMongoId().withMessage("Invalid notification ID format"),
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
    .isIn([
      "friend_request",
      "friend_request_accepted",
      "friend_request_rejected",
      "new_message",
      "post_like",
      "post_comment",
      "profile_view",
      "match_suggestion",
    ])
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
