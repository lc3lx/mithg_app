const { param, body } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.cleanupChatMessagesValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  validatorMiddleware,
];

exports.warnChatParticipantsValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  body("warningMessage")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Warning message must be at most 500 characters"),
  validatorMiddleware,
];
