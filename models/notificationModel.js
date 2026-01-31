const mongoose = require("mongoose");
const { sendPushToUser } = require("../utils/pushNotification");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Notification must belong to user"],
    },
    type: {
      type: String,
      enum: [
        // User interaction notifications
        "friend_request",
        "friend_request_accepted",
        "friend_request_rejected",
        "new_message",
        "post_like",
        "post_comment",
        "profile_view",
        "match_suggestion",
        "people_nearby",
        "security_update",
        "messaging_request",
        "messaging_request_accepted",
        "messaging_request_rejected",
        "gallery_view",
        // Admin broadcast notifications
        "update",
        "promotion",
        "security",
        "welcome",
        "maintenance",
        "general",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    recipientType: {
      type: String,
      enum: ["specific", "all", "premium", "new_users", "inactive"],
      default: "specific",
    },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sent", "cancelled"],
      default: "sent",
    },
    scheduledAt: Date,
    sentAt: {
      type: Date,
      default: Date.now,
    },
    recipientsCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    openedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Related entities
    relatedUser: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
    relatedPost: {
      type: mongoose.Schema.ObjectId,
      ref: "Post",
    },
    relatedChat: {
      type: mongoose.Schema.ObjectId,
      ref: "Chat",
    },
    relatedMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },
    // Notification status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,
    openRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Push notification data
    pushSent: {
      type: Boolean,
      default: false,
    },
    pushSentAt: Date,
    // Custom data for the notification
    data: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

// Indexes
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, isRead: 1 });
notificationSchema.index({ type: 1 });
notificationSchema.index({ status: 1 });
notificationSchema.index({ scheduledAt: 1 }, { sparse: true });

// Populate related entities when querying
notificationSchema.pre(/^find/, function (next) {
  this.populate({
    path: "relatedUser",
    select: "name profileImg isOnline",
  }).populate({
    path: "relatedPost",
    select: "title content",
  });
  next();
});

notificationSchema.post("save", async function (doc) {
  try {
    if (doc.pushSent) return;
    await sendPushToUser(doc.user, doc);
    await doc.constructor.updateOne(
      { _id: doc._id },
      { pushSent: true, pushSentAt: new Date() }
    );
  } catch (error) {
    // Avoid crashing on push failures
    await doc.constructor.updateOne(
      { _id: doc._id },
      { pushSent: true, pushSentAt: new Date() }
    );
  }
});

// Auto-delete old notifications (keep only last 100 per user)
notificationSchema.statics.cleanupOldNotifications = async function (userId) {
  const notifications = await this.find({ user: userId })
    .sort({ createdAt: -1 })
    .skip(100);

  if (notifications.length > 0) {
    await this.deleteMany({
      _id: { $in: notifications.map((n) => n._id) },
    });
  }
};

// Create notification method
notificationSchema.statics.createNotification = async function (data) {
  const notification = await this.create(data);

  // Cleanup old notifications
  await this.cleanupOldNotifications(data.user);

  return notification;
};

module.exports = mongoose.model("Notification", notificationSchema);
