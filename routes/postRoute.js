const express = require("express");

// Controllers
const {
  getPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  togglePostStatus,
  toggleLike,
  toggleDislike,
  processPostMedia,
  createFilterObj,
} = require("../services/postService");

// للمستخدمين: إرجاع البوستات النشطة فقط (المتوقفة لا تظهر في الـ get)
const setActivePostsOnly = (req, res, next) => {
  req.query = { ...req.query, isActive: "true" };
  next();
};

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

// GET all posts for regular users — نشط فقط (المتوقف لا يظهر)
router.get("/user", authService.protect, authService.requirePhoneVerified, setActivePostsOnly, createFilterObj, getPosts);

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
router.get("/:id", authService.protect, authService.requirePhoneVerified, getPostValidator, getPost);

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

// PATCH post status نشط/متوقف (admin only)
router.patch(
  "/:id/status",
  adminService.protectAdmin,
  togglePostStatus
);

// Like / Unlike (users only - not admins)
router.post("/:id/like", authService.protect, authService.requirePhoneVerified, toggleLikeValidator, toggleLike);

// Dislike / Undislike (users only - not admins)
router.post("/:id/dislike", authService.protect, authService.requirePhoneVerified, toggleLikeValidator, toggleDislike);

module.exports = router;
