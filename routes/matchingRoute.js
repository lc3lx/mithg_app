const express = require("express");
const {
  getMatches,
  getMatchProfile,
  getMutualFriends,
  likeProfile,
  getProfileLikes,
} = require("../services/matchingService");

const {
  getMatchProfileValidator,
  likeProfileValidator,
  getMutualFriendsValidator,
} = require("../utils/validators/matchingValidator");

const authService = require("../services/authService");

const router = express.Router();

// All routes require authentication
router.use(authService.protect);

// Routes
router.get("/", getMatches);
router.get("/likes", getProfileLikes);
router.post("/:userId/like", likeProfileValidator, likeProfile);
router.get(
  "/:userId/mutual-friends",
  getMutualFriendsValidator,
  getMutualFriends
);
router.get("/:userId", getMatchProfileValidator, getMatchProfile);

module.exports = router;
