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
messageSchema.index({ sender: 1, createdAt: -1 });
messageSchema.index({ isArchived: 1, archivedAt: 1 });
messageSchema.index({ createdAt: 1, isArchived: 1 });

// Update chat's last message when a new message is created (بدون استدعاء chat.save() لتجنب خطأ التحقق من عدد المشاركين)
messageSchema.post("save", async function () {
  const Chat = mongoose.model("Chat");

  await Chat.findByIdAndUpdate(this.chat, {
    lastMessage: this._id,
    lastMessageTime: this.createdAt,
  });

  // تحديث عداد غير المقروءة عبر findByIdAndUpdate فقط (لا تحميل المستند ولا .save())
  const chatDoc = await Chat.findById(this.chat)
    .select("participants unreadCount")
    .lean();
  if (chatDoc && chatDoc.participants && chatDoc.participants.length) {
    const senderStr = this.sender.toString();
    const otherIds = chatDoc.participants
      .map((p) => (p && p._id ? p._id.toString() : p.toString()))
      .filter((id) => id !== senderStr);

    for (const otherId of otherIds) {
      const otherOid = mongoose.Types.ObjectId.isValid(otherId)
        ? new mongoose.Types.ObjectId(otherId)
        : otherId;
      const hasEntry = (chatDoc.unreadCount || []).some(
        (uc) => (uc.user && uc.user.toString()) === otherId
      );
      if (hasEntry) {
        await Chat.findByIdAndUpdate(
          this.chat,
          { $inc: { "unreadCount.$[elem].count": 1 } },
          { arrayFilters: [{ "elem.user": otherOid }] }
        );
      } else {
        await Chat.findByIdAndUpdate(this.chat, {
          $push: { unreadCount: { user: otherOid, count: 1 } },
        });
      }
    }
  }

  await mongoose.model("User").findByIdAndUpdate(this.sender, {
    $inc: { messageCount: 1 },
  });
});

// Populate sender when querying
messageSchema.pre(/^find/, function (next) {
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
