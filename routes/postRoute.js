const express = require("express");

// Controllers
const {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  processPostMedia,
  createFilterObj,
} = require("../services/postService");

// Validators
const {
  getPostValidator,
  createPostValidator,
  updatePostValidator,
  deletePostValidator,
  toggleLikeValidator,
} = require("../utils/validators/postValidator");

// Auth
const authService = require("../services/authService");
const adminService = require("../services/adminService");

// Upload middleware (multer.array)
const { uploadPostMedia } = require("../middlewares/uploadImageMiddleware");

const router = express.Router();

// ===============================
// 📌 Routes
// ===============================

// GET all posts for regular users (with likes) - يوزرز عاديين فقط
router.get("/user", authService.protect, createFilterObj, getPosts);

// GET all admin posts (admin only)
router.get("/", adminService.protectAdmin, createFilterObj, getPosts);

// POST create admin post (admin only)
router.post(
  "/",
  adminService.protectAdmin,
  uploadPostMedia("media"), // multer.array("media", 10)
  processPostMedia, // sharp للصور + حفظ الفيديو
  createPostValidator,
  createPost
);

// GET single post (public - all authenticated users can view)
router.get("/:id", authService.protect, getPostValidator, getPost);

// PUT update post (admin only)
router.put(
  "/:id",
  adminService.protectAdmin,
  uploadPostMedia("media"),
  processPostMedia,
  updatePostValidator,
  updatePost
);

// DELETE post (admin only)
router.delete(
  "/:id",
  adminService.protectAdmin,
  deletePostValidator,
  deletePost
);

// Like / Unlike (users only - not admins)
router.post("/:id/like", authService.protect, toggleLikeValidator, toggleLike);

module.exports = router;
