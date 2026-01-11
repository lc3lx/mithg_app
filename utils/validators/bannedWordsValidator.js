const { body } = require("express-validator");

const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.addBannedWordValidator = [
  body("word")
    .trim()
    .notEmpty()
    .withMessage("Word is required")
    .isLength({ min: 1, max: 50 })
    .withMessage("Word must be between 1 and 50 characters")
    .matches(/^[a-zA-Z\u0600-\u06FF\s]+$/)
    .withMessage("Word can only contain letters and spaces"),

  body("variations")
    .optional()
    .isArray()
    .withMessage("Variations must be an array"),

  body("variations.*")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Each variation must be between 1 and 50 characters")
    .matches(/^[a-zA-Z\u0600-\u06FF\s]+$/)
    .withMessage("Variations can only contain letters and spaces"),

  body("category")
    .optional()
    .isIn([
      "profanity",
      "hate_speech",
      "sexual_content",
      "violence",
      "spam",
      "harassment",
      "other",
    ])
    .withMessage("Invalid category"),

  body("severity")
    .optional()
    .isIn(["low", "medium", "high", "critical"])
    .withMessage("Invalid severity level"),

  body("warningMessage")
    .optional()
    .trim()
    .isLength({ min: 10, max: 200 })
    .withMessage("Warning message must be between 10 and 200 characters"),

  body("autoBlockThreshold")
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage("Auto block threshold must be between 1 and 10"),

  body("blockDurationHours")
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage("Block duration must be between 1 and 168 hours"),

  body("notes")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Notes cannot exceed 500 characters"),

  validatorMiddleware,
];

exports.updateBannedWordValidator = [
  body("word")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Word cannot be empty")
    .isLength({ min: 1, max: 50 })
    .withMessage("Word must be between 1 and 50 characters")
    .matches(/^[a-zA-Z\u0600-\u06FF\s]+$/)
    .withMessage("Word can only contain letters and spaces"),

  body("variations")
    .optional()
    .isArray()
    .withMessage("Variations must be an array"),

  body("variations.*")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Each variation must be between 1 and 50 characters")
    .matches(/^[a-zA-Z\u0600-\u06FF\s]+$/)
    .withMessage("Variations can only contain letters and spaces"),

  body("category")
    .optional()
    .isIn([
      "profanity",
      "hate_speech",
      "sexual_content",
      "violence",
      "spam",
      "harassment",
      "other",
    ])
    .withMessage("Invalid category"),

  body("severity")
    .optional()
    .isIn(["low", "medium", "high", "critical"])
    .withMessage("Invalid severity level"),

  body("warningMessage")
    .optional()
    .trim()
    .isLength({ min: 10, max: 200 })
    .withMessage("Warning message must be between 10 and 200 characters"),

  body("autoBlockThreshold")
    .optional()
    .isInt({ min: 1, max: 10 })
    .withMessage("Auto block threshold must be between 1 and 10"),

  body("blockDurationHours")
    .optional()
    .isInt({ min: 1, max: 168 })
    .withMessage("Block duration must be between 1 and 168 hours"),

  body("notes")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Notes cannot exceed 500 characters"),

  validatorMiddleware,
];

exports.bulkAddBannedWordsValidator = [
  body("words")
    .isArray({ min: 1, max: 100 })
    .withMessage("Words must be an array with 1-100 items"),

  body("words.*.word")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Word must be between 1 and 50 characters")
    .matches(/^[a-zA-Z\u0600-\u06FF\s]+$/)
    .withMessage("Word can only contain letters and spaces"),

  body("words.*").custom((wordData) => {
    // If wordData is a string, convert to object
    if (typeof wordData === "string") {
      return true;
    }
    // If object, validate structure
    if (typeof wordData !== "object" || !wordData.word) {
      throw new Error(
        "Each word must be a string or object with word property"
      );
    }
    return true;
  }),

  body("category")
    .optional()
    .isIn([
      "profanity",
      "hate_speech",
      "sexual_content",
      "violence",
      "spam",
      "harassment",
      "other",
    ])
    .withMessage("Invalid default category"),

  body("severity")
    .optional()
    .isIn(["low", "medium", "high", "critical"])
    .withMessage("Invalid default severity level"),

  validatorMiddleware,
];
