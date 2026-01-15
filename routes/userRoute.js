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
  addToFavorites,
  getFriends,
  removeFromFavorites,
  getUserFavorites,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  getFriendRequests,
} = require("../services/userService");

const authService = require("../services/authService");
const {
  requireSubscriptionAndVerification,
  requireSubscriptionForFriendRequest,
  requireSubscriptionForMessaging
} = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

router.use(authService.protect);

router.get("/getMe", getLoggedUserData, getUser);
router.put("/changeMyPassword", updateLoggedUserPassword);
router.put("/updateMe", updateLoggedUserValidator, updateLoggedUserData);
router.put(
  "/updateProfileInfo",
  updateLoggedUserValidator,
  updateLoggedUserProfileInfo
);
router.delete("/deleteMe", deleteLoggedUserData);

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
router.get("/friend-requests", getFriendRequests);
router.get("/friends/list", getFriends);

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
