const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.submitIdentityVerificationValidator = [
  body("documents")
    .isArray({ min: 1 })
    .withMessage("At least one document is required"),

  body("documents.*.type")
    .isIn(["id_card", "passport", "driving_license", "selfie"])
    .withMessage("Invalid document type"),

  body("documents.*.url").notEmpty().withMessage("Document URL is required"),

  body("adminType")
    .isIn(["male", "female"])
    .withMessage("Admin type must be either male or female"),

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
