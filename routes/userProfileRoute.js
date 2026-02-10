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

router.use(authService.protect);

// About section
router.put("/about", updateAboutValidator, updateAbout);

// Gallery routes
router.post(
  "/gallery",
  uploadImageMiddleware.uploadSingleImage("file"),
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

// عرض قائمة البروفايلات والبروفايل الفردي — متاح لأي مستخدم موقّع (بدون اشتراك/توثيق)
router.get("/profiles", getAllProfilesValidator, getAllProfiles);
router.get("/:userId/profile", getUserProfileValidator, getUserProfile);

module.exports = router;
