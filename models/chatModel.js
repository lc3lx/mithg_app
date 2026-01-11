const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    chatType: {
      type: String,
      enum: ["direct", "group", "dating"],
      default: "direct",
    },
    // For direct chats only (2 participants)
    isActive: {
      type: Boolean,
      default: true,
    },

    // For dating chats (includes guardians)
    isDatingChat: {
      type: Boolean,
      default: false,
    },
    primaryUsers: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ], // The two main users in a dating chat
    guardians: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "Guardian",
      },
    ], // Guardians who can access this chat
    // Last message info for quick display
    lastMessage: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },
    lastMessageTime: {
      type: Date,
      default: Date.now,
    },
    // Unread count for each participant
    unreadCount: [
      {
        user: {
          type: mongoose.Schema.ObjectId,
          ref: "User",
        },
        count: {
          type: Number,
          default: 0,
        },
      },
    ],
    // Group chat fields (if needed later)
    groupName: String,
    groupDescription: String,
    groupImage: String,
    admin: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Validation based on chat type
chatSchema.pre("save", function (next) {
  if (this.chatType === "direct" && this.participants.length !== 2) {
    return next(new Error("Direct chats must have exactly 2 participants"));
  }

  if (this.chatType === "dating") {
    // Dating chats can have 2-4 participants (2 users + their guardians)
    if (this.participants.length < 2 || this.participants.length > 4) {
      return next(new Error("Dating chats must have 2-4 participants"));
    }
    this.isDatingChat = true;
  }

  next();
});

// Indexes
chatSchema.index({ participants: 1 });
chatSchema.index({ lastMessageTime: -1 });
chatSchema.index({ "unreadCount.user": 1 });

// Virtual populate for messages
chatSchema.virtual("messages", {
  ref: "Message",
  foreignField: "chat",
  localField: "_id",
  options: { sort: { createdAt: 1 } },
});

// Populate participants when querying
chatSchema.pre(/^find/, function (next) {
  this.populate({
    path: "participants",
    select: "name profileImg isOnline lastSeen",
  })
    .populate({
      path: "primaryUsers",
      select: "name profileImg isOnline lastSeen",
    })
    .populate({
      path: "guardians",
      select: "firstName lastName relationship phone",
    })
    .populate({
      path: "lastMessage",
      select: "content sender messageType createdAt",
      populate: {
        path: "sender",
        select: "name",
      },
    });
  next();
});

// Set group image URL
chatSchema.post("init", (doc) => {
  if (doc.groupImage) {
    const imageUrl = `${process.env.BASE_URL}/uploads/chats/${doc.groupImage}`;
    doc.groupImage = imageUrl;
  }
});

chatSchema.post("save", (doc) => {
  if (doc.groupImage) {
    const imageUrl = `${process.env.BASE_URL}/uploads/chats/${doc.groupImage}`;
    doc.groupImage = imageUrl;
  }
});

module.exports = mongoose.model("Chat", chatSchema);
