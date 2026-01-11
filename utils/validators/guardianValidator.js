const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.addGuardianValidator = [
  body("relationship")
    .isIn(["mother", "father", "brother", "sister"])
    .withMessage("Relationship must be mother, father, brother, or sister"),

  body("firstName")
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters"),

  body("lastName")
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters"),

  body("phone")
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),

  body("dateOfBirth")
    .isISO8601()
    .withMessage("Please provide a valid date of birth")
    .custom((value) => {
      const birthDate = new Date(value);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 18 || age > 100) {
        throw new Error("Guardian must be between 18 and 100 years old");
      }
      return true;
    }),

  body("identityDocuments")
    .isArray({ min: 1 })
    .withMessage("At least one identity document is required"),

  body("identityDocuments.*.type")
    .isIn(["id_card", "passport", "birth_certificate", "family_card"])
    .withMessage("Invalid document type"),

  body("identityDocuments.*.url")
    .notEmpty()
    .withMessage("Document URL is required"),

  validatorMiddleware,
];

exports.updateGuardianValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  body("firstName")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("First name must be between 2 and 50 characters"),

  body("lastName")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("Last name must be between 2 and 50 characters"),

  body("phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid phone number"),

  body("email")
    .optional()
    .isEmail()
    .withMessage("Please provide a valid email")
    .normalizeEmail(),

  body("emergencyContact.name")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage("Emergency contact name must be between 2 and 50 characters"),

  body("emergencyContact.phone")
    .optional()
    .isMobilePhone()
    .withMessage("Please provide a valid emergency contact phone"),

  body("emergencyContact.relationship")
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage(
      "Emergency contact relationship must be between 2 and 50 characters"
    ),

  validatorMiddleware,
];

exports.removeGuardianValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  validatorMiddleware,
];

exports.uploadGuardianDocumentsValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  validatorMiddleware,
];

exports.getGuardianQRCodeValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  validatorMiddleware,
];

exports.regenerateGuardianQRValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  validatorMiddleware,
];

exports.accessChatWithQRValidator = [
  body("qrData").notEmpty().withMessage("QR code data is required"),

  body("chatId").isMongoId().withMessage("Invalid chat ID format"),

  validatorMiddleware,
];

exports.reviewGuardianVerificationValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  body("action")
    .isIn(["approve", "reject"])
    .withMessage("Action must be either approve or reject"),

  body("reviewNotes")
    .optional()
    .isLength({ max: 500 })
    .withMessage("Review notes cannot exceed 500 characters"),

  body("rejectionReason")
    .if(body("action").equals("reject"))
    .notEmpty()
    .withMessage("Rejection reason is required when rejecting")
    .isLength({ max: 500 })
    .withMessage("Rejection reason cannot exceed 500 characters"),

  validatorMiddleware,
];

exports.getGuardianDetailsValidator = [
  param("id").isMongoId().withMessage("Invalid guardian ID format"),

  validatorMiddleware,
];
