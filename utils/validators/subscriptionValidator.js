const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.createSubscriptionPackageValidator = [
  body("packageType")
    .isIn(["basic", "premium"])
    .withMessage("Package type must be basic or premium"),

  body("name")
    .isLength({ min: 2, max: 100 })
    .withMessage("Package name must be between 2 and 100 characters"),

  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("price")
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),

  body("currency")
    .optional()
    .isIn(["USD", "EUR", "SAR", "AED"])
    .withMessage("Invalid currency"),

  body("features")
    .optional()
    .isArray()
    .withMessage("Features must be an array"),

  body("features.*")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Each feature cannot exceed 100 characters"),

  body("durationDays")
    .optional()
    .isInt({ min: 1, max: 3650 })
    .withMessage("Duration days must be between 1 and 3650"),

  validatorMiddleware,
];

exports.updateSubscriptionPackageValidator = [
  param("id").isMongoId().withMessage("Invalid subscription package ID format"),

  body("name")
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage("Package name must be between 2 and 100 characters"),

  body("description")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Description cannot exceed 500 characters"),

  body("price")
    .optional()
    .isFloat({ min: 0 })
    .withMessage("Price must be a positive number"),

  body("currency")
    .optional()
    .isIn(["USD", "EUR", "SAR", "AED"])
    .withMessage("Invalid currency"),

  body("features")
    .optional()
    .isArray()
    .withMessage("Features must be an array"),

  body("features.*")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Each feature cannot exceed 100 characters"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),

  validatorMiddleware,
];

exports.subscribeWithPaymentRequestValidator = [
  body("subscriptionId")
    .isMongoId()
    .withMessage("Invalid subscription ID format"),

  body("paymentInstructions")
    .notEmpty()
    .withMessage("Payment instructions are required")
    .isLength({ max: 1000 })
    .withMessage("Payment instructions cannot exceed 1000 characters"),

  body("paymentMethod")
    .optional()
    .isIn(["bank_transfer", "cash", "online_payment", "other"])
    .withMessage("Invalid payment method"),

  body("transactionReference")
    .optional()
    .isLength({ max: 100 })
    .withMessage("Transaction reference cannot exceed 100 characters"),

  body("referralCode")
    .optional()
    .trim()
    .isLength({ min: 4, max: 32 })
    .withMessage("Referral code must be between 4 and 32 characters"),

  validatorMiddleware,
];

exports.subscribeWithCodeValidator = [
  body("code")
    .isLength({ min: 12, max: 12 })
    .withMessage("Subscription code must be exactly 12 characters")
    .isAlphanumeric()
    .withMessage("Subscription code must contain only letters and numbers"),

  validatorMiddleware,
];

exports.approvePaymentRequestValidator = [
  param("id").isMongoId().withMessage("Invalid payment request ID format"),

  body("reviewNotes")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Review notes cannot exceed 500 characters"),

  validatorMiddleware,
];

exports.rejectPaymentRequestValidator = [
  param("id").isMongoId().withMessage("Invalid payment request ID format"),

  body("rejectionReason")
    .notEmpty()
    .withMessage("Rejection reason is required")
    .isLength({ max: 500 })
    .withMessage("Rejection reason cannot exceed 500 characters"),

  body("reviewNotes")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Review notes cannot exceed 500 characters"),

  validatorMiddleware,
];

exports.createSubscriptionCodeValidator = [
  body("subscriptionId")
    .isMongoId()
    .withMessage("Invalid subscription ID format"),

  body("expiresAt")
    .isISO8601()
    .withMessage("Invalid expiration date format")
    .custom((value) => {
      if (new Date(value) <= new Date()) {
        throw new Error("Expiration date must be in the future");
      }
      return true;
    }),

  body("maxUses")
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage("Max uses must be between 1 and 1000"),

  body("description")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Description cannot exceed 200 characters"),

  validatorMiddleware,
];

// ============== Referral Code validators ==============

exports.createReferralCodeValidator = [
  body("code")
    .optional()
    .trim()
    .isLength({ min: 4, max: 32 })
    .withMessage("Code must be between 4 and 32 characters"),

  body("discountPercent")
    .isFloat({ min: 1, max: 100 })
    .withMessage("Discount percentage must be between 1 and 100"),

  body("expiresAt")
    .optional()
    .isISO8601()
    .withMessage("Invalid expiration date format"),

  body("maxUses")
    .optional()
    .isInt({ min: 1, max: 100000 })
    .withMessage("Max uses must be between 1 and 100000"),

  body("description")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Description cannot exceed 200 characters"),

  validatorMiddleware,
];

exports.updateReferralCodeValidator = [
  param("id").isMongoId().withMessage("Invalid referral code ID format"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),

  body("expiresAt")
    .optional()
    .isISO8601()
    .withMessage("Invalid expiration date format"),

  body("maxUses")
    .optional()
    .isInt({ min: 1, max: 100000 })
    .withMessage("Max uses must be between 1 and 100000"),

  body("description")
    .optional()
    .isLength({ max: 200 })
    .withMessage("Description cannot exceed 200 characters"),

  validatorMiddleware,
];
