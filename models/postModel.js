const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.ObjectId,
      ref: "Admin",
      required: [true, "Post must belong to Admin"],
    },

    // نوع البوست
    postType: {
      type: String,
      enum: ["image", "video"],
      default: "image",
    },

    // الميديا (صور + فيديو)
    media: [
      {
        url: {
          type: String,
          required: true,
        },
        type: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
      },
    ],

    // Stats
    likes: [
      {
        type: mongoose.Schema.ObjectId,
        ref: "User",
      },
    ],
    likesCount: {
      type: Number,
      default: 0,
    },
    views: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual comments
postSchema.virtual("comments", {
  ref: "Comment",
  foreignField: "post",
  localField: "_id",
});

// Indexes
postSchema.index({ admin: 1, createdAt: -1 });
postSchema.index({ postType: 1, isActive: 1 });
postSchema.index({ likesCount: -1 });

// Set media URLs dynamically based on request
const setMediaURL = (doc) => {
  if (doc.media && doc.media.length > 0) {
    // For now, use a default URL, but ideally this should be dynamic
    // We'll update this to be dynamic in the controller
    const baseUrl = process.env.BASE_URL || 'http://10.2.0.2:8000';
    doc.media = doc.media.map((item) => {
      // If URL is already full URL, keep it; otherwise prepend base URL
      const url = item.url.startsWith('http') ? item.url : `${baseUrl}/uploads/posts/${item.url}`;
      return {
        ...item.toObject(),
        url: url,
      };
    });
  }
};

postSchema.post("init", setMediaURL);
postSchema.post("save", setMediaURL);

module.exports = mongoose.model("Post", postSchema);
