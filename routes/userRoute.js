const express = require("express");
const {
  getUserValidator,
  createUserValidator,
  updateUserValidator,
  deleteUserValidator,
  changeUserPasswordValidator,
  updateLoggedUserValidator,
  addToFavoritesValidator,
  removeFromFavoritesValidator,
  sendFriendRequestValidator,
  acceptFriendRequestValidator,
  rejectFriendRequestValidator,
  cancelFriendRequestValidator,
  removeFriendValidator,
  blockUserValidator,
  reportUserValidator,
  sendGalleryViewRequestValidator,
  acceptGalleryViewRequestValidator,
  rejectGalleryViewRequestValidator,
} = require("../utils/validators/userValidator");

const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  uploadUserImage,
  uploadCoverImage,
  resizeImage,
  updateLoggedUserData,
  updateLoggedUserProfileInfo,
  changeUserPassword,
  getLoggedUserData,
  updateLoggedUserPassword,
  deleteLoggedUserData,
  freezeAccount,
  permanentDeleteAccount,
  addToFavorites,
  getFriends,
  removeFromFavorites,
  getUserFavorites,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getFriendRequests,
  removeFriend,
  blockUser,
  reportUser,
} = require("../services/userService");
const {
  sendGalleryViewRequest,
  getGalleryViewRequests,
  acceptGalleryViewRequest,
  rejectGalleryViewRequest,
} = require("../services/galleryViewRequestService");

const authService = require("../services/authService");
const { validateUploadedBuffers } = require("../middlewares/uploadImageMiddleware");
const {
  requireSubscriptionAndVerification,
  requireSubscriptionForFriendRequest,
  requireSubscriptionForMessaging
} = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

router.use(authService.protect);

// getMe، updateProfileInfo، رفع الصور — بدون اشتراط التحقق من الهاتف (خطوات التسجيل signup1→5 قبل OTP)
router.get("/getMe", getLoggedUserData, getUser);
router.put(
  "/updateProfileInfo",
  updateLoggedUserValidator,
  updateLoggedUserProfileInfo
);
router.post(
  "/uploadProfileImage",
  uploadUserImage,
  validateUploadedBuffers,
  resizeImage,
  updateLoggedUserData
);
router.post(
  "/uploadCoverImage",
  uploadCoverImage,
  validateUploadedBuffers,
  resizeImage,
  updateLoggedUserData
);

router.use(authService.requirePhoneVerified);

router.put("/changeMyPassword", updateLoggedUserPassword);
router.put("/updateMe", updateLoggedUserValidator, updateLoggedUserData);
router.delete("/deleteMe", deleteLoggedUserData);
router.put("/freezeAccount", freezeAccount);
router.delete("/permanentDelete", permanentDeleteAccount);

// Favorites
router.post("/favorites/:userId", addToFavoritesValidator, addToFavorites);
router.delete(
  "/favorites/:userId",
  removeFromFavoritesValidator,
  removeFromFavorites
);
router.get("/favorites", getUserFavorites);

// Friend Requests
router.post(
  "/friend-request/:userId",
  requireSubscriptionAndVerification,
  sendFriendRequestValidator,
  sendFriendRequest
);
router.post(
  "/friend-request/:userId/accept",
  acceptFriendRequestValidator,
  acceptFriendRequest
);
router.post(
  "/friend-request/:userId/reject",
  rejectFriendRequestValidator,
  rejectFriendRequest
);
router.delete(
  "/friend-request/:userId",
  cancelFriendRequestValidator,
  cancelFriendRequest
);
// عرض طلبات الصداقة وقائمة الأصدقاء يتطلب اشتراكاً وتوثيقاً (تحقق باك + فرونت)
router.get("/friend-requests", requireSubscriptionAndVerification, getFriendRequests);
router.get("/friends/list", requireSubscriptionAndVerification, getFriends);

// Gallery view requests (طلب مشاهدة المعرض)
router.post(
  "/gallery-view-request/:userId",
  requireSubscriptionAndVerification,
  sendGalleryViewRequestValidator,
  sendGalleryViewRequest
);
router.get("/gallery-view-requests", getGalleryViewRequests);
router.post(
  "/gallery-view-request/:requestId/accept",
  acceptGalleryViewRequestValidator,
  acceptGalleryViewRequest
);
router.post(
  "/gallery-view-request/:requestId/reject",
  rejectGalleryViewRequestValidator,
  rejectGalleryViewRequest
);
router.delete("/friends/:userId", removeFriendValidator, removeFriend);
router.post("/block/:userId", blockUserValidator, blockUser);
router.post("/report/:userId", reportUserValidator, reportUser);

// Admin
router.use(authService.allowedTo("admin", "manager"));
router.put(
  "/changePassword/:id",
  changeUserPasswordValidator,
  changeUserPassword
);
router
  .route("/")
  .get(getUsers)
  .post(
    uploadUserImage,
    validateUploadedBuffers,
    resizeImage,
    createUserValidator,
    createUser,
  );
router
  .route("/:id")
  .get(getUserValidator, getUser)
  .put(
    uploadUserImage,
    validateUploadedBuffers,
    resizeImage,
    updateUserValidator,
    updateUser,
  )
  .delete(deleteUserValidator, deleteUser);

// Friends routes

module.exports = router;
