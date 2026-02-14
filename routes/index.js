const userRoute = require("./userRoute");
const authRoute = require("./authRoute");
const postRoute = require("./postRoute");
const chatRoute = require("./chatRoute");
const messagingRequestRoute = require("./messagingRequestRoute");
const notificationRoute = require("./notificationRoute");
const matchingRoute = require("./matchingRoute");
const userProfileRoute = require("./userProfileRoute");
const subscriptionRoute = require("./subscriptionRoute");
const identityVerificationRoute = require("./identityVerificationRoute");
const adminRoute = require("./adminRoute");
const rechargeRequestRoute = require("./rechargeRequestRoute");
const guardianRoute = require("./guardianRoute");
const userWarningsRoute = require("./userWarningsRoute");
const userModerationRoute = require("./userModerationRoute");
const supportRoute = require("./supportRoute");
const deviceTokenRoute = require("./deviceTokenRoute");
const rechargeService = require("../services/rechargeService");
const authService = require("../services/authService");

const mountRoutes = (app) => {
  app.use("/api/v1/users", userRoute);
  app.use("/api/v1/auth", authRoute);
  app.use("/api/v1/posts", postRoute);
  app.use("/api/v1/chats", chatRoute);
  app.use("/api/v1/messaging-requests", messagingRequestRoute);
  app.use("/api/v1/notifications", notificationRoute);
  app.use("/api/v1/matches", matchingRoute);
  app.use("/api/v1/profile", userProfileRoute);
  app.use("/api/v1/subscriptions", subscriptionRoute);
  app.use("/api/v1/verification", identityVerificationRoute);
  app.use("/api/v1/admins", adminRoute);
  app.use("/api/v1/recharge-requests", rechargeRequestRoute);
  app.use("/api/v1/guardians", guardianRoute);
  app.use("/api/v1/warnings", userWarningsRoute);
  app.use("/api/v1/moderation", userModerationRoute);
  app.use("/api/v1/support", supportRoute);
  app.use("/api/v1/device-tokens", deviceTokenRoute);

  // Recharge codes for users (authenticated + phone verified)
  app.post(
    "/api/v1/recharge-codes/use",
    authService.protect,
    authService.requirePhoneVerified,
    rechargeService.useRechargeCode
  );
};

module.exports = mountRoutes;
