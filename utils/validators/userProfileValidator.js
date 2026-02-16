const { body, param, query } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");

exports.updateAboutValidator = [
  body("about")
    .optional()
    .trim()
    .isLength({ min: 0, max: 1000 })
    .withMessage("About section must be between 0 and 1000 characters"),
  validatorMiddleware,
];

exports.addToGalleryValidator = [
  body("caption")
    .optional()
    .trim()
    .isLength({ min: 0, max: 200 })
    .withMessage("Caption must be between 0 and 200 characters"),

  body("type")
    .optional()
    .isIn(["image", "video"])
    .withMessage("Type must be image or video"),
  validatorMiddleware,
];

exports.updateGalleryItemValidator = [
  param("itemId").isMongoId().withMessage("Invalid gallery item ID format"),

  body("caption")
    .optional()
    .trim()
    .isLength({ min: 0, max: 200 })
    .withMessage("Caption must be between 0 and 200 characters"),
  validatorMiddleware,
];

exports.setPrimaryGalleryItemValidator = [
  param("itemId").isMongoId().withMessage("Invalid gallery item ID format"),
  validatorMiddleware,
];

exports.deleteGalleryItemValidator = [
  param("itemId").isMongoId().withMessage("Invalid gallery item ID format"),
  validatorMiddleware,
];

exports.getUserGalleryValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];

exports.getUserProfileValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];

exports.getAllProfilesValidator = [
  query("search")
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage("Search term must be at most 100 characters"),
  query("city").optional().trim().isLength({ max: 80 }),
  query("country").optional().trim().isLength({ max: 80 }),
  query("nationality").optional().trim().isLength({ max: 80 }),
  query("ageMin").optional().isInt({ min: 18, max: 80 }),
  query("ageMax").optional().isInt({ min: 18, max: 80 }),
  query("heightMin").optional().isInt({ min: 100, max: 250 }),
  query("heightMax").optional().isInt({ min: 100, max: 250 }),
  query("hairColor").optional().trim().isLength({ max: 50 }),
  query("religion").optional().trim().isLength({ max: 50 }),
  validatorMiddleware,
];