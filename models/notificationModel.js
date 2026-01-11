const mongoose = require("mongoose");

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
        "friend_request",
        "friend_request_accepted",
        "friend_request_rejected",
        "new_message",
        "post_like",
        "post_comment",
        "profile_view",
        "match_suggestion",
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
