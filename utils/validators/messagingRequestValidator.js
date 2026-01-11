const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.sendMessagingRequestValidator = [
  body("receiverId").isMongoId().withMessage("Invalid receiver ID format"),

  body("message")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Message cannot exceed 200 characters"),

  validatorMiddleware,
];

exports.respondToMessagingRequestValidator = [
  param("id").isMongoId().withMessage("Invalid messaging request ID format"),

  body("action")
    .isIn(["accept", "reject"])
    .withMessage("Action must be either accept or reject"),

  body("includeGuardians")
    .optional()
    .isBoolean()
    .withMessage("includeGuardians must be a boolean"),

  validatorMiddleware,
];

exports.cancelMessagingRequestValidator = [
  param("id").isMongoId().withMessage("Invalid messaging request ID format"),

  validatorMiddleware,
];
