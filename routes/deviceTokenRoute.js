const express = require("express");
const authService = require("../services/authService");
const {
  registerDeviceToken,
  removeDeviceToken,
} = require("../services/deviceTokenService");

const router = express.Router();

router.use(authService.protect);
router.use(authService.requirePhoneVerified);

router.post("/", registerDeviceToken);
router.delete("/:playerId", removeDeviceToken);

module.exports = router;

