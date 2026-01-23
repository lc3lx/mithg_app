const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.createAdminValidator = [
  body("name")
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters"),

  body("email")
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),

  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long"),

  body("phone")
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("adminType")
    .isIn(["male", "female", "super"])
    .withMessage("Admin type must be male, female, or super"),

  validatorMiddleware,
];

exports.updateAdminValidator = [
  param("id").isMongoId().withMessage("Invalid admin ID format"),

  body("name")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters"),

  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),

  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("adminType")
    .optional()
    .isIn(["male", "female", "super"])
    .withMessage("Admin type must be male, female, or super"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),

  body("permissions")
    .optional()
    .isObject()
    .withMessage("Permissions must be an object"),

  body("password")
    .optional()
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long"),

  validatorMiddleware,
];

// Middleware لتنظيف البريد الإلكتروني قبل الـ validation
const sanitizeEmail = (req, res, next) => {
  if (req.body && req.body.email && typeof req.body.email === 'string') {
    // إزالة النقاط والمسافات الزائدة في النهاية
    req.body.email = req.body.email.replace(/\.+$/, '').trim();
  }
  next();
};

exports.adminLoginValidator = [
  sanitizeEmail,
  body("email")
    .trim()
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),

  body("password")
    .trim()
    .notEmpty()
    .withMessage("Password is required"),

  validatorMiddleware,
];

// Chat monitoring validators
exports.getAllChatsValidator = [
  validatorMiddleware,
];

exports.archiveOldMessagesValidator = [
  body("daysOld")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Days old must be between 1 and 365"),

  validatorMiddleware,
];

exports.getMessageStatsValidator = [
  validatorMiddleware,
];

exports.cleanupChatMessagesValidator = [
  body("daysOld")
    .optional()
    .isInt({ min: 1, max: 365 })
    .withMessage("Days old must be between 1 and 365"),

  validatorMiddleware,
];