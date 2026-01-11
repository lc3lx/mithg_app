const { param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.getMatchProfileValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];

exports.likeProfileValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];

exports.getMutualFriendsValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];
