const { body, param } = require("express-validator");

const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.blockUserValidator = [
  param("id").isMongoId().withMessage("Invalid user ID format"),

  body("blockReason")
    .optional()
    .trim()
    .isLength({ min: 0, max: 200 })
    .withMessage("Block reason must be at most 200 characters"),

  body("blockDurationHours")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Block duration must be a positive number of hours"),

  body("fullBlock")
    .optional()
    .isBoolean()
    .withMessage("fullBlock must be true or false"),

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
