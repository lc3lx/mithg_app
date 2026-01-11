const { param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.cleanupChatMessagesValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  validatorMiddleware,
];
