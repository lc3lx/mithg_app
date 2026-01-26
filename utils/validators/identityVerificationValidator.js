const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.submitIdentityVerificationValidator = [
  body("adminType")
    .isIn(["male", "female"])
    .withMessage("Admin type must be either male or female"),

  // Custom validation for documents
  body("documents").custom((value, { req }) => {
    // Check if files are uploaded
    const files = req.files || {};
    let hasFiles = false;
    
    for (let i = 0; i < 3; i++) {
      const fileKey = `documents[${i}][url]`;
      if (files[fileKey] && files[fileKey].length > 0) {
        hasFiles = true;
        break;
      }
    }
    
    if (!hasFiles) {
      throw new Error("At least one document file is required");
    }
    
    // Validate document types if provided
    if (value && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] && value[i].type) {
          const validTypes = ["id_card", "passport", "driving_license", "selfie"];
          if (!validTypes.includes(value[i].type)) {
            throw new Error(`Invalid document type at index ${i}`);
          }
        }
      }
    }
    
    return true;
  }),

  validatorMiddleware,
];

exports.reviewVerificationRequestValidator = [
  param("id").isMongoId().withMessage("Invalid verification request ID format"),

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
