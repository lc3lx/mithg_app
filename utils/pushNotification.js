const https = require("https");
const DeviceToken = require("../models/deviceTokenModel");

const sendOneSignalRequest = (payload, restApiKey) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      "https://onesignal.com/api/v1/notifications",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Basic ${restApiKey}`,
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

const buildPayload = (notification, playerIds, appId, relatedUserInfo = null) => {
  const data = {
    notificationId: notification._id?.toString(),
    type: notification.type,
    relatedChat: notification.relatedChat?.toString(),
    relatedUser: notification.relatedUser?.toString(),
    relatedPost: notification.relatedPost?.toString(),
  };
  if (relatedUserInfo) {
    if (relatedUserInfo.relatedUserName != null)
      data.relatedUserName = String(relatedUserInfo.relatedUserName);
    if (relatedUserInfo.relatedUserProfileImg != null)
      data.relatedUserProfileImg = String(relatedUserInfo.relatedUserProfileImg);
  }
  return {
    app_id: appId,
    include_player_ids: playerIds,
    headings: { en: notification.title },
    contents: { en: notification.message },
    ios_sound: "default",
    android_sound: "default",
    priority: 10,
    data,
  };
};

exports.sendPushToUser = async (userId, notification, relatedUserInfo = null) => {
  const appId = process.env.ONESIGNAL_APP_ID;
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !restApiKey) {
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
    const payload = buildPayload(
      notification,
      playerIds,
      appId,
      relatedUserInfo
    );
    await sendOneSignalRequest(payload, restApiKey);
    return true;
  } catch (err) {
    console.error("[Push] OneSignal send failed:", err.message);
    return false;
  }
};

