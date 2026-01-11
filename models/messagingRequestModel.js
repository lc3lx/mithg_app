const mongoose = require("mongoose");

const messagingRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Messaging request must have a sender"],
    },
    receiver: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Messaging request must have a receiver"],
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    message: {
      type: String,
      maxlength: [200, "Message too long"],
      trim: true,
    },
    // Track if chat was created when request was accepted
    chatCreated: {
      type: Boolean,
      default: false,
    },
    chat: {
      type: mongoose.Schema.ObjectId,
      ref: "Chat",
    },
  },
  { timestamps: true }
);

// Prevent duplicate messaging requests
messagingRequestSchema.index({ sender: 1, receiver: 1 }, { unique: true });

// Prevent self-messaging requests
messagingRequestSchema.pre("save", function (next) {
  if (this.sender.toString() === this.receiver.toString()) {
    return next(new Error("Cannot send messaging request to yourself"));
  }
  next();
});

// Populate users when querying
messagingRequestSchema.pre(/^find/, function (next) {
  this.populate({
    path: "sender",
    select: "name profileImg isOnline lastSeen age location bio about gender",
  })
    .populate({
      path: "receiver",
      select: "name profileImg isOnline lastSeen age location bio about gender",
    })
    .populate({
      path: "chat",
      select: "isActive lastMessage lastMessageTime",
    });
  next();
});

module.exports = mongoose.model("MessagingRequest", messagingRequestSchema);
