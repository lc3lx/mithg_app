const express = require("express");
const rechargeRequestService = require("../services/rechargeRequestService");
const authService = require("../services/authService");

const router = express.Router();

// User routes (protected + phone verified)
router.use(authService.protect);
router.use(authService.requirePhoneVerified);
router.post("/", rechargeRequestService.createRechargeRequest);
router.get("/my", rechargeRequestService.getMyRechargeRequests);

module.exports = router;


