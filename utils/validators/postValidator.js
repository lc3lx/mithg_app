const { body, param } = require("express-validator");
const validatorMiddleware = require("../../middlewares/validatorMiddleware");
const Post = require("../../models/postModel");

exports.getPostValidator = [
  param("id").isMongoId().withMessage("Invalid post ID format"),
  validatorMiddleware,
];

exports.createPostValidator = [
  body("content")
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Content must be at most 2000 characters"),
  validatorMiddleware,
];

exports.updatePostValidator = [
  param("id").isMongoId().withMessage("Invalid post ID format"),

  body("title")
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("Title must be between 1 and 100 characters"),

  body("content")
    .optional()
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage("Content must be between 1 and 2000 characters"),

  body("postType")
    .optional()
    .isIn(["profile", "story", "interest"])
    .withMessage("Post type must be profile, story, or interest"),

  body("lookingFor")
    .optional()
    .isIn(["friendship", "relationship", "marriage", "casual"])
    .withMessage(
      "Looking for must be friendship, relationship, marriage, or casual"
    ),

  body("interests")
    .optional()
    .isArray({ max: 10 })
    .withMessage("Interests must be an array with max 10 items"),

  body("interests.*")
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Each interest must be between 1 and 50 characters"),

  body("isActive")
    .optional()
    .isBoolean()
    .withMessage("isActive must be a boolean"),

  validatorMiddleware,
];

exports.deletePostValidator = [
  param("id").isMongoId().withMessage("Invalid post ID format"),
  validatorMiddleware,
];

exports.toggleLikeValidator = [
  param("id").isMongoId().withMessage("Invalid post ID format"),
  validatorMiddleware,
];

exports.getUserPostsValidator = [
  param("userId").isMongoId().withMessage("Invalid user ID format"),
  validatorMiddleware,
];
