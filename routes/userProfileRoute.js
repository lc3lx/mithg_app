const express = require("express");
const {
  updateAbout,
  addToGallery,
  getUserGallery,
  updateGalleryItem,
  setPrimaryGalleryItem,
  deleteGalleryItem,
  getUserProfile,
  getAllProfiles,
} = require("../services/userProfileService");

const {
  updateAboutValidator,
  addToGalleryValidator,
  updateGalleryItemValidator,
  setPrimaryGalleryItemValidator,
  deleteGalleryItemValidator,
  getUserGalleryValidator,
  getUserProfileValidator,
  getAllProfilesValidator,
} = require("../utils/validators/userProfileValidator");

const authService = require("../services/authService");
const uploadImageMiddleware = require("../middlewares/uploadImageMiddleware");

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

// About section
router.put("/about", updateAboutValidator, updateAbout);

// Gallery routes
router.post(
  "/gallery",
  uploadImageMiddleware.uploadSingleImage,
  addToGalleryValidator,
  addToGallery
);

router.get("/:userId/gallery", getUserGalleryValidator, getUserGallery);

router.put("/gallery/:itemId", updateGalleryItemValidator, updateGalleryItem);

router.put(
  "/gallery/:itemId/primary",
  setPrimaryGalleryItemValidator,
  setPrimaryGalleryItem
);

router.delete(
  "/gallery/:itemId",
  deleteGalleryItemValidator,
  deleteGalleryItem
);

// User profile
router.get("/:userId/profile", getUserProfileValidator, getUserProfile);

// All profiles
router.get("/profiles", getAllProfilesValidator, getAllProfiles);

module.exports = router;
