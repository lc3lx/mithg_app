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
  ]);

  console.log(`🎬 Posts fetched: ${posts.length}`);
  if (posts.length > 0) {
    console.log('📹 First post media:', JSON.stringify(posts[0].media, null, 2));
  }

  res.status(200).json({
    results: posts.length,
    paginationResult,
    data: posts,
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

// @desc    Create admin post
// @route   POST  /api/v1/posts
// @access  Private/Admin
exports.createPost = asyncHandler(async (req, res) => {
  // Add user to req.body and mark as admin post
  req.body.admin = req.admin._id;

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

  if (isLiked) {
    // Unlike
    await Post.findByIdAndUpdate(id, {
      $pull: { likes: userId },
      $inc: { likesCount: -1 },
    });

    res.status(200).json({
      message: "Post unliked successfully",
      liked: false,
    });
  } else {
    // Like
    await Post.findByIdAndUpdate(id, {
      $push: { likes: userId },
      $inc: { likesCount: 1 },
    });

    // Create notification for post owner if not liking own post
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
