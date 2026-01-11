const { body, param } = require("express-validator");
const mongoose = require("mongoose");

const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.issueWarningValidator = [
  body("userId").isMongoId().withMessage("Invalid user ID format"),

  body("warningType")
    .optional()
    .isIn([
      "banned_word",
      "inappropriate_content",
      "harassment",
      "spam",
      "other",
    ])
    .withMessage("Invalid warning type"),

  body("severity")
    .optional()
    .isIn(["low", "medium", "high", "critical"])
    .withMessage("Invalid severity level"),

  body("warningMessage")
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage("Warning message must be between 10 and 500 characters"),

  body("bannedWordId")
    .optional()
    .isMongoId()
    .withMessage("Invalid banned word ID format"),

  body("violatedMessageId")
    .optional()
    .isMongoId()
    .withMessage("Invalid message ID format"),

  body("chatId").optional().isMongoId().withMessage("Invalid chat ID format"),

  body("notes")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("Notes cannot exceed 1000 characters"),

  validatorMiddleware,
];

exports.resolveWarningValidator = [
  param("id").isMongoId().withMessage("Invalid warning ID format"),

  body("resolutionNotes")
    .optional()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("Resolution notes must be between 5 and 500 characters"),

  validatorMiddleware,
];

exports.appealWarningValidator = [
  param("id").isMongoId().withMessage("Invalid warning ID format"),

  body("appealReason")
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage("Appeal reason must be between 10 and 1000 characters"),

  validatorMiddleware,
];

exports.bulkResolveWarningsValidator = [
  body("warningIds")
    .isArray({ min: 1, max: 50 })
    .withMessage("Warning IDs must be an array with 1-50 items"),

  body("warningIds.*").isMongoId().withMessage("Invalid warning ID format"),

  body("resolutionNotes")
    .optional()
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage("Resolution notes must be between 5 and 500 characters"),

  validatorMiddleware,
];

exports.getUserWarningsValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),

  validatorMiddleware,
];
