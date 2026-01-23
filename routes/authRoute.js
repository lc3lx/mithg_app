const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  signupValidator,
  loginValidator,
} = require("../utils/validators/authValidator");

const {
  signup,
  login,
  forgotPassword,
  verifyPassResetCode,
  resetPassword,
} = require("../services/authService");

const router = express.Router();

// Rate limiting disabled for authentication routes
// const authLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 50, // Increased to 50 attempts per 15 minutes for development
//   message: {
//     error:
//       "Too many authentication attempts, please try again after 15 minutes",
//   },
// });

// Apply auth limiter to all auth routes (disabled)
// router.use(authLimiter);

router.post("/signup", signupValidator, signup);
router.post("/login", loginValidator, login);
router.post("/forgotPassword", forgotPassword);
router.post("/verifyResetCode", verifyPassResetCode);
router.put("/resetPassword", resetPassword);

module.exports = router;
