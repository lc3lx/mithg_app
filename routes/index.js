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
const guardianRoute = require("./guardianRoute");
const bannedWordsRoute = require("./bannedWordsRoute");
const userWarningsRoute = require("./userWarningsRoute");
const userModerationRoute = require("./userModerationRoute");

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
  app.use("/api/v1/guardians", guardianRoute);
  app.use("/api/v1/banned-words", bannedWordsRoute);
  app.use("/api/v1/warnings", userWarningsRoute);
  app.use("/api/v1/moderation", userModerationRoute);
};

module.exports = mountRoutes;
