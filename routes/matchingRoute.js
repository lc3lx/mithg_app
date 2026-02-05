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
const { requireSubscriptionAndVerification } = require("../middlewares/subscriptionMiddleware");

const router = express.Router();

router.use(authService.protect);

// التطابقات والإعجابات متاحة فقط للمشتركين الموثقين (تحقق باك + فرونت)
router.get("/", requireSubscriptionAndVerification, getMatches);
router.get("/likes", requireSubscriptionAndVerification, getProfileLikes);
router.post("/:userId/like", requireSubscriptionAndVerification, likeProfileValidator, likeProfile);
router.get(
  "/:userId/mutual-friends",
  requireSubscriptionAndVerification,
  getMutualFriendsValidator,
  getMutualFriends
);
router.get("/:userId", requireSubscriptionAndVerification, getMatchProfileValidator, getMatchProfile);

module.exports = router;
