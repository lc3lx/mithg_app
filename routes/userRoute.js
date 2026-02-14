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

const authService = require("../services/authService");
const {
  requireSubscriptionAndVerification,
  requireSubscriptionForFriendRequest,
  requireSubscriptionForMessaging
} = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

router.use(authService.protect);

// getMe فقط يُستثنى — لمعرفة حالة التحقق وتوجيه المستخدم لشاشة OTP إن لزم
router.get("/getMe", getLoggedUserData, getUser);

// منع الدخول لبقية مسارات المستخدم دون إكمال التحقق من الهاتف (OTP)
router.use(authService.requirePhoneVerified);

router.put("/changeMyPassword", updateLoggedUserPassword);
router.put("/updateMe", updateLoggedUserValidator, updateLoggedUserData);
router.put(
  "/updateProfileInfo",
  updateLoggedUserValidator,
  updateLoggedUserProfileInfo
);
router.delete("/deleteMe", deleteLoggedUserData);
router.put("/freezeAccount", freezeAccount);
router.delete("/permanentDelete", permanentDeleteAccount);

// Image upload routes
router.post(
  "/uploadProfileImage",
  uploadUserImage,
  resizeImage,
  updateLoggedUserData
);
router.post(
  "/uploadCoverImage",
  uploadCoverImage,
  resizeImage,
  updateLoggedUserData
);

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
  .post(uploadUserImage, resizeImage, createUserValidator, createUser);
router
  .route("/:id")
  .get(getUserValidator, getUser)
  .put(uploadUserImage, resizeImage, updateUserValidator, updateUser)
  .delete(deleteUserValidator, deleteUser);

// Friends routes

module.exports = router;
