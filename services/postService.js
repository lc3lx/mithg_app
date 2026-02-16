const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const ApiFeatures = require("../utils/apiFeatures");

const {
  getAllPopulated,
  createOnePopulated,
  updateOnePopulated,
  getOneMultiplePop,
  deleteOne,
  addToArray,
  removeFromArray,
  incrementField,
} = require("./handlersFactory");

const Post = require("../models/postModel");
const Notification = require("../models/notificationModel");

// Nested route
// GET /api/v1/posts/:postId/likes
exports.createFilterObj = (req, res, next) => {
  let filterObject = {};
  if (req.params.postId) filterObject = { post: req.params.postId };
  req.filterObj = filterObject;
  next();
};

// @desc    Get list of admin posts
// @route   GET /api/v1/posts
// @access  Public
exports.getPosts = asyncHandler(async (req, res) => {
  console.log('📋 Fetching posts...');
  const documentsCounts = await Post.countDocuments();
  console.log(`📊 Found ${documentsCounts} posts`);
  const apiFeatures = new ApiFeatures(Post.find(), req.query)
    .paginate(documentsCounts)
    .filter()
    .search("Post")
    .limitFields()
    .sort();

  // Execute query
  const { mongooseQuery, paginationResult } = apiFeatures;
  const posts = await mongooseQuery.populate([
    { path: "admin", select: "name email adminType" },
    { path: "likes", select: "name profileImg" },
    { path: "dislikes", select: "name profileImg" },
  ]);

  console.log(`🎬 Posts fetched: ${posts.length}`);
  if (posts.length > 0) {
    console.log('📹 First post media:', JSON.stringify(posts[0].media, null, 2));
  }

  const userId = req.user?._id?.toString();
  const data = posts.map((p) => {
    const po = p.toObject ? p.toObject() : { ...p };
    po.isLiked = !!userId && (p.likes || []).some((l) => (l._id || l).toString() === userId);
    po.isDisliked = !!userId && (p.dislikes || []).some((l) => (l._id || l).toString() === userId);
    return po;
  });

  // عند جلب البوستات للمستخدم (الفييد): زيادة المشاهدات لكل بوست ظاهر
  if (req.user && data.length > 0) {
    const postIds = data.map((p) => p._id).filter(Boolean);
    if (postIds.length > 0) {
      await Post.updateMany(
        { _id: { $in: postIds } },
        { $inc: { views: 1 } }
      );
    }
  }

  res.status(200).json({
    results: posts.length,
    paginationResult,
    data,
  });
});

// @desc    Get specific post by id
// @route   GET /api/v1/posts/:id
// @access  Public
exports.getPost = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Increment view count first
  await Post.findByIdAndUpdate(id, { $inc: { views: 1 } });

  // Then get the post with population
  const populations = [
    { path: "admin", select: "name email adminType" },
    { path: "likes", select: "name profileImg" },
  ];

  let query = Post.findById(id);
  populations.forEach((pop) => {
    query = query.populate(pop);
  });

  const post = await query;

  if (!post) {
    return next(new ApiError(`No post for this id ${id}`, 404));
  }

  res.status(200).json({ data: post });
});

// @desc    Create admin post (نص فقط، أو نص + صور/فيديو)
// @route   POST  /api/v1/posts
// @access  Private/Admin
exports.createPost = asyncHandler(async (req, res) => {
  req.body.admin = req.admin._id;
  req.body.media = req.body.media || [];
  // إذا لا ميديا ونص موجود → نوع البوست نص
  if (req.body.media.length === 0 && req.body.content) {
    req.body.postType = "text";
  } else if (req.body.media.length > 0) {
    const hasVideo = req.body.media.some((m) => m.type === "video");
    req.body.postType = hasVideo ? "video" : "image";
  }

  const post = await Post.create(req.body);

  res.status(201).json({ data: post });
});

// @desc    Update specific post
// @route   PUT /api/v1/posts/:id
// @access  Private/Protect (user himself or admin)
exports.updatePost = updateOnePopulated(Post, [
  { path: "admin", select: "name email adminType" },
  { path: "likes", select: "name profileImg" },
]);

// @desc    Delete specific post
// @route   DELETE /api/v1/posts/:id
// @access  Private/Protect (user himself or admin)
exports.deletePost = deleteOne(Post);

// @desc    Toggle post status (active / paused) — أدمن فقط
// @route   PATCH /api/v1/posts/:id/status
// @access  Private/Admin
exports.togglePostStatus = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const isActive = req.body.isActive === true || req.body.isActive === "true";

  const post = await Post.findByIdAndUpdate(
    id,
    { isActive },
    { new: true, runValidators: true }
  );

  if (!post) {
    return next(new ApiError(`No post for this id ${id}`, 404));
  }

  res.status(200).json({
    data: post,
    message: isActive ? "تم تفعيل البوست" : "تم إيقاف البوست",
  });
});

// @desc    Like/Unlike post
// @route   POST /api/v1/posts/:id/like
// @access  Private/Protect
exports.toggleLike = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const post = await Post.findById(id);
  if (!post) {
    return next(new ApiError(`No post for this id ${id}`, 404));
  }

  const isLiked = post.likes.includes(userId);
  const isDisliked = (post.dislikes || []).some((d) => d.toString() === userId.toString());

  if (isLiked) {
    await Post.findByIdAndUpdate(id, {
      $pull: { likes: userId },
      $inc: { likesCount: -1 },
    });
    res.status(200).json({
      message: "Post unliked successfully",
      liked: false,
    });
  } else {
    const update = {
      $push: { likes: userId },
      $inc: { likesCount: 1 },
    };
    if (isDisliked) {
      update.$pull = { dislikes: userId };
      update.$inc.dislikesCount = -1;
    }
    await Post.findByIdAndUpdate(id, update);

    if (post.admin.toString() !== userId.toString()) {
      await Notification.createNotification({
        user: post.admin,
        type: "post_like",
        title: "New Like",
        message: `${req.user.name} liked your post`,
        relatedUser: userId,
        relatedPost: id,
        data: { postId: id },
      });
    }

    res.status(200).json({
      message: "Post liked successfully",
      liked: true,
    });
  }
});

// @desc    Dislike/Undislike post
// @route   POST /api/v1/posts/:id/dislike
// @access  Private/Protect
exports.toggleDislike = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const userId = req.user._id;

  const post = await Post.findById(id);
  if (!post) {
    return next(new ApiError(`No post for this id ${id}`, 404));
  }

  const isDisliked = (post.dislikes || []).some((d) => d.toString() === userId.toString());
  const isLiked = post.likes.includes(userId);

  if (isDisliked) {
    await Post.findByIdAndUpdate(id, {
      $pull: { dislikes: userId },
      $inc: { dislikesCount: -1 },
    });
    res.status(200).json({
      message: "Post undisliked successfully",
      disliked: false,
    });
  } else {
    const update = {
      $push: { dislikes: userId },
      $inc: { dislikesCount: 1 },
    };
    if (isLiked) {
      update.$pull = { likes: userId };
      update.$inc.likesCount = -1;
    }
    await Post.findByIdAndUpdate(id, update);

    res.status(200).json({
      message: "Post disliked successfully",
      disliked: true,
    });
  }
});

// @desc    Upload post images
// @route   POST /api/v1/posts/upload-images
// @access  Private/Protect

exports.processPostMedia = asyncHandler(async (req, res, next) => {
  if (!req.files || req.files.length === 0) return next();

  console.log(
    "📁 Files received:",
    req.files.map((f) => ({
      name: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
    }))
  );

  req.body.media = [];

  await Promise.all(
    req.files.map(async (file, index) => {
      const id = uuidv4();
      const isImage = file.mimetype.startsWith("image");
      const isVideo = file.mimetype.startsWith("video");

      console.log(
        `🔍 File ${index}: ${file.originalname} - ${file.mimetype} - Image: ${isImage}, Video: ${isVideo}`
      );

      if (!isImage && !isVideo) {
        console.log(
          `❌ Skipping file ${file.originalname} - unsupported mimetype: ${file.mimetype}`
        );
        return;
      }

      // 🖼️ IMAGE
      if (isImage) {
        const filename = `post-${id}-${Date.now()}-${index}.jpeg`;

        await sharp(file.buffer)
          .resize(1200, 1200)
          .toFormat("jpeg")
          .jpeg({ quality: 90 })
          .toFile(`uploads/posts/${filename}`);

        req.body.media.push({
          url: filename,
          type: "image",
        });
      }

      // 🎥 VIDEO
      if (isVideo) {
        const ext = file.mimetype.split("/")[1];
        const filename = `post-${id}-${Date.now()}-${index}.${ext}`;

        fs.writeFileSync(`uploads/posts/${filename}`, file.buffer);

        req.body.media.push({
          url: filename,
          type: "video",
        });
      }
    })
  );

  // تحديد نوع البوست تلقائياً
  req.body.postType = req.body.media[0].type;

  console.log("✅ Processed media:", req.body.media);
  console.log("📝 Post type set to:", req.body.postType);

  next();
});
