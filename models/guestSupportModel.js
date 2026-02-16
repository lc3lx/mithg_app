const mongoose = require("mongoose");

const guestMessageSchema = new mongoose.Schema(
  {
    senderType: {
      type: String,
      enum: ["guest", "admin"],
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true }
);

const guestSupportConversationSchema = new mongoose.Schema(
  {
    guestName: {
      type: String,
      required: true,
      trim: true,
    },
    guestPhone: {
      type: String,
      required: true,
      trim: true,
    },
    messages: [guestMessageSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "GuestSupportConversation",
  guestSupportConversationSchema
);
