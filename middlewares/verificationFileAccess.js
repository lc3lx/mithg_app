const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
const asyncHandler = require("express-async-handler");
const ApiError = require("../utils/apiError");
const User = require("../models/userModel");
const Admin = require("../models/adminModel");
const IdentityVerification = require("../models/identityVerificationModel");

const UPLOAD_ROOT = path.resolve(__dirname, "../uploads/verification");

/**
 * JWT مستخدم أو أدمن — الأدمن يصل لأي ملف؛ المستخدم فقط لملفات طلباته.
 */
exports.protectVerificationFileAccess = asyncHandler(async (req, res, next) => {
  let token;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return next(new ApiError("غير مصرح", 401));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
  } catch {
    return next(new ApiError("توكن غير صالح", 401));
  }

  if (decoded.adminId) {
    const admin = await Admin.findById(decoded.adminId).select("isActive");
    if (!admin || !admin.isActive) {
      return next(new ApiError("غير مصرح", 401));
    }
    req.admin = admin;
    return next();
  }

  if (decoded.userId) {
    const user = await User.findById(decoded.userId);
    if (!user) {
      return next(new ApiError("غير مصرح", 401));
    }
    req.user = user;
    const filename = path.basename(req.params.filename || "");
    const allowed = await IdentityVerification.findOne({
      user: user._id,
      "documents.url": filename,
    }).lean();
    if (!allowed) {
      return next(new ApiError("لا يمكنك الوصول لهذا الملف", 403));
    }
    return next();
  }

  return next(new ApiError("غير مصرح", 401));
});

exports.sendVerificationFile = asyncHandler(async (req, res, next) => {
  const filename = path.basename(req.params.filename || "");
  if (!filename || filename.includes("..")) {
    return next(new ApiError("طلب غير صالح", 400));
  }
  const filePath = path.join(UPLOAD_ROOT, filename);
  if (!filePath.startsWith(UPLOAD_ROOT)) {
    return next(new ApiError("طلب غير صالح", 400));
  }
  if (!fs.existsSync(filePath)) {
    return next(new ApiError("الملف غير موجود", 404));
  }
  res.sendFile(filePath);
});
