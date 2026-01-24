const https = require("https");
const DeviceToken = require("../models/deviceTokenModel");

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

const sendOneSignalRequest = (payload) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      "https://onesignal.com/api/v1/notifications",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Basic ${ONESIGNAL_REST_API_KEY}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString();
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseBody);
          } else {
            reject(
              new Error(
                `OneSignal error ${res.statusCode}: ${responseBody || ""}`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });

const buildPayload = (notification, playerIds) => ({
  app_id: ONESIGNAL_APP_ID,
  include_player_ids: playerIds,
  headings: { en: notification.title },
  contents: { en: notification.message },
  data: {
    notificationId: notification._id,
    type: notification.type,
    relatedChat: notification.relatedChat,
    relatedUser: notification.relatedUser,
    relatedPost: notification.relatedPost,
  },
});

exports.sendPushToUser = async (userId, notification) => {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    return false;
  }

  const tokens = await DeviceToken.find({
    user: userId,
    isActive: true,
  }).select("playerId");

  const playerIds = tokens.map((token) => token.playerId).filter(Boolean);
  if (playerIds.length === 0) {
    return false;
  }

  const payload = buildPayload(notification, playerIds);
  await sendOneSignalRequest(payload);
  return true;
};

