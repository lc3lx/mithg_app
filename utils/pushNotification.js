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
  // صوت الإشعار عند وصوله (التطبيق مغلق أو في الخلفية)
  ios_sound: "default",
  android_sound: "default",
  priority: 10,
  data: {
    notificationId: notification._id?.toString(),
    type: notification.type,
    relatedChat: notification.relatedChat?.toString(),
    relatedUser: notification.relatedUser?.toString(),
    relatedPost: notification.relatedPost?.toString(),
  },
});

exports.sendPushToUser = async (userId, notification) => {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn(
      "[Push] OneSignal not configured: set ONESIGNAL_APP_ID and ONESIGNAL_REST_API_KEY in .env"
    );
    return false;
  }

  const tokens = await DeviceToken.find({
    user: userId,
    isActive: true,
  }).select("playerId");

  const playerIds = tokens.map((token) => token.playerId).filter(Boolean);
  if (playerIds.length === 0) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[Push] No device tokens for user ${userId}; user must open app and log in to register device.`
      );
    }
    return false;
  }

  try {
    const payload = buildPayload(notification, playerIds);
    await sendOneSignalRequest(payload);
    return true;
  } catch (err) {
    console.error("[Push] OneSignal send failed:", err.message);
    return false;
  }
};

