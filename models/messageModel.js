const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    chat: {
      type: mongoose.Schema.ObjectId,
      ref: "Chat",
      required: [true, "Message must belong to a chat"],
    },
    sender: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Message must have a sender"],
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "voice"],
      default: "text",
    },
    content: {
      type: String,
      required: function () {
        return this.messageType === "text";
      },
      trim: true,
      maxlength: [1000, "Message too long"],
    },
    // For media messages
    mediaUrl: {
      type: String,
      required: function () {
        return ["image", "file", "voice"].includes(this.messageType);
      },
    },
    mediaName: String,
    mediaSize: Number, // in bytes

    // Message status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,

    // Archive status
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedAt: Date,

    // Reply functionality
    replyTo: {
      type: mongoose.Schema.ObjectId,
      ref: "Message",
    },

    // Reactions (like, love, etc.)
    reactions: [
      {
        user: {
          type: mongoose.Schema.ObjectId,
          ref: "User",
        },
        reaction: {
          type: String,
          enum: ["like", "love", "laugh", "angry", "sad"],
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

// Indexes for performance
messageSchema.index({ chat: 1, createdAt: 1 });
messageSchema.index({ chat: 1, sender: 1, isRead: 1 }); // mark_as_read hot path
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ isArchived: 1, archivedAt: 1 });
messageSchema.index({ createdAt: 1, isArchived: 1 });

// Post-save: update chat metadata + unread counts.
// NOTE: Socket handler also calls Chat.findByIdAndUpdate for lastMessage/lastMessageTime
// in setImmediate, but this hook ensures REST API message creation also works correctly.
// The hook uses _skipAutoPopulate to avoid triggering heavy Chat populate hooks.
messageSchema.post("save", async function () {
  const Chat = mongoose.model("Chat");

  // Single atomic update for lastMessage + lastMessageTime
  await Chat.findByIdAndUpdate(this.chat, {
    lastMessage: this._id,
    lastMessageTime: this.createdAt,
  });

  // Increment unread counts — use lean + skipAutoPopulate to avoid populating participants
  const chatDoc = await Chat.findById(this.chat)
    .select("participants unreadCount")
    .setOptions({ _skipAutoPopulate: true })
    .lean();

  if (chatDoc && chatDoc.participants && chatDoc.participants.length) {
    const senderStr = this.sender.toString();
    const otherIds = chatDoc.participants
      .map((p) => (p && p._id ? p._id.toString() : p.toString()))
      .filter((id) => id !== senderStr);

    // Batch all unread updates into a single Promise.all
    await Promise.all(
      otherIds.map((otherId) => {
        const otherOid = mongoose.Types.ObjectId.isValid(otherId)
          ? new mongoose.Types.ObjectId(otherId)
          : otherId;
        const hasEntry = (chatDoc.unreadCount || []).some(
          (uc) => (uc.user && uc.user.toString()) === otherId
        );
        if (hasEntry) {
          return Chat.findByIdAndUpdate(
            this.chat,
            { $inc: { "unreadCount.$[elem].count": 1 } },
            { arrayFilters: [{ "elem.user": otherOid }] }
          );
        }
        return Chat.findByIdAndUpdate(this.chat, {
          $push: { unreadCount: { user: otherOid, count: 1 } },
        });
      })
    );
  }

  await mongoose.model("User").findByIdAndUpdate(this.sender, {
    $inc: { messageCount: 1 },
  });
});

// Auto-populate on find queries (REST API).
// Socket handlers set { _skipAutoPopulate: true } to avoid unnecessary joins.
messageSchema.pre(/^find/, function (next) {
  if (this.getOptions && this.getOptions()._skipAutoPopulate) return next();
  this.populate({
    path: "sender",
    select: "name profileImg isOnline",
  }).populate({
    path: "replyTo",
    select: "content sender messageType",
    populate: {
      path: "sender",
      select: "name",
    },
  });
  next();
});

// Set media URL
messageSchema.post("init", (doc) => {
  if (doc.mediaUrl) {
    const mediaUrl = `${process.env.BASE_URL}/uploads/messages/${doc.mediaUrl}`;
    doc.mediaUrl = mediaUrl;
  }
});

messageSchema.post("save", (doc) => {
  if (doc.mediaUrl) {
    const mediaUrl = `${process.env.BASE_URL}/uploads/messages/${doc.mediaUrl}`;
    doc.mediaUrl = mediaUrl;
  }
});

module.exports = mongoose.model("Message", messageSchema);
