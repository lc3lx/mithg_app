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
const { requireSubscriptionAndVerification } = require("../middlewares/subscriptionMiddleware");

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

// عرض الملف الشخصي وقائمة الملفات متاح فقط للمشتركين الموثقين (تحقق باك + فرونت)
router.get("/profiles", getAllProfilesValidator, requireSubscriptionAndVerification, getAllProfiles);
router.get("/:userId/profile", getUserProfileValidator, requireSubscriptionAndVerification, getUserProfile);

module.exports = router;
