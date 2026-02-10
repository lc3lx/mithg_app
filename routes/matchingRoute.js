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

// عرض قائمة التطابقات والبروفايل والإعجابات — متاح لأي مستخدم موقّع
router.get("/", getMatches);
router.get("/likes", getProfileLikes);
router.get("/:userId/mutual-friends", getMutualFriendsValidator, getMutualFriends);
router.get("/:userId", getMatchProfileValidator, getMatchProfile);

// إرسال طلب تعارف (لايك) — يتطلب اشتراكاً وتوثيقاً فقط
router.post("/:userId/like", requireSubscriptionAndVerification, likeProfileValidator, likeProfile);

module.exports = router;
