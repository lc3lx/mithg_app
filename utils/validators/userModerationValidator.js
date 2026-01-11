const { body, param } = require("express-validator");

const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.blockUserValidator = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  body("blockReason")
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage("Block reason must be between 5 and 200 characters"),

  body("blockDurationHours")
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage("Block duration must be between 1 and 168 hours"),

  validatorMiddleware,
];

exports.unblockUserValidator = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  validatorMiddleware,
];

exports.resetUserWarningsValidator = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  validatorMiddleware,
];
