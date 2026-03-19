const mongoose = require("mongoose");

const galleryViewRequestSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Gallery owner is required"],
    },
    requesterId: {
      type: mongoose.Schema.ObjectId,
      ref: "User",
      required: [true, "Requester is required"],
    },
    galleryItemId: {
      type: String,
      required: [true, "Gallery item ID is required"],
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

galleryViewRequestSchema.index(
  { ownerId: 1, requesterId: 1, galleryItemId: 1, status: 1 },
  { unique: false }
);
galleryViewRequestSchema.index({ ownerId: 1, createdAt: -1 });
galleryViewRequestSchema.index({ requesterId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "GalleryViewRequest",
  galleryViewRequestSchema
);
