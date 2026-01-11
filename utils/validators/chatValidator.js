const { body, param, query } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");
const Chat = require("../../models/chatModel");
const User = require("../../models/userModel");

// Validation for getting chats
exports.getChatsValidator = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
  query("limit").optional().isInt({ min: 1, max: 50 }).withMessage("Limit must be between 1 and 50"),
  validatorMiddleware,
];

// Validation for getting single chat
exports.getChatValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  validatorMiddleware,
];

// Validation for creating chat
exports.createChatValidator = [
  body("participantId")
    .isMongoId()
    .withMessage("Invalid participant ID format")
    .custom(async (participantId, { req }) => {
      // Check if participant exists
      const participant = await User.findById(participantId);
      if (!participant) {
        throw new Error("Participant not found");
      }

      // Check if participant is not the same as current user
      if (participantId === req.user._id.toString()) {
        throw new Error("Cannot create chat with yourself");
      }

      return true;
    }),
  body("chatType")
    .optional()
    .isIn(["direct", "group", "dating"])
    .withMessage("Chat type must be direct, group, or dating"),
  validatorMiddleware,
];

// Validation for sending message
exports.sendMessageValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  body("content")
    .optional()
    .isLength({ min: 1, max: 1000 })
    .withMessage("Message content must be between 1 and 1000 characters"),
  body("messageType")
    .optional()
    .isIn(["text", "image", "video", "file", "voice"])
    .withMessage("Invalid message type"),
  body("mediaUrl")
    .optional()
    .isURL()
    .withMessage("Invalid media URL"),
  body("mediaName")
    .optional()
    .isLength({ min: 1, max: 255 })
    .withMessage("Media name too long"),
  body("mediaSize")
    .optional()
    .isInt({ min: 0 })
    .withMessage("Invalid media size"),
  validatorMiddleware,
];

// Validation for marking messages as read
exports.markAsReadValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  validatorMiddleware,
];

// Validation for deleting chat
exports.deleteChatValidator = [
  param("id").isMongoId().withMessage("Invalid chat ID format"),
  validatorMiddleware,
];