const multer = require("multer");
const ApiError = require("../utils/apiError");

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/avi",
  "video/mov",
  "video/wmv",
  "video/quicktime",
  "video/x-msvideo",
  "video/x-ms-wmv",
  "video/webm",
  "video/ogg",
  "video/mpeg",
];

const isDev = process.env.NODE_ENV !== "production";

function normalizeClaimedMime(mimetype) {
  if (!mimetype) return mimetype;
  if (mimetype === "image/jpg") return "image/jpeg";
  return mimetype;
}

/**
 * Best-effort magic-byte sniffing (do not trust client-supplied MIME alone).
 */
function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.toString("ascii", 4, 8) === "ftyp") return "video/mp4";
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "video/webm";
  }
  return null;
}

function collectUploadedFiles(req) {
  const files = [];
  const push = (f) => {
    if (f && f.buffer && Buffer.isBuffer(f.buffer)) files.push(f);
  };
  if (req.file) push(req.file);
  if (!req.files) return files;
  if (Array.isArray(req.files)) {
    req.files.forEach(push);
    return files;
  }
  Object.keys(req.files).forEach((key) => {
    const v = req.files[key];
    if (Array.isArray(v)) v.forEach(push);
    else push(v);
  });
  return files;
}

/**
 * After multer (memory storage), verify buffers match allowed types and roughly match claimed MIME.
 */
exports.validateUploadedBuffers = (req, res, next) => {
  try {
    const files = collectUploadedFiles(req);
    if (files.length === 0) return next();

    for (const f of files) {
      const detected = detectMimeFromBuffer(f.buffer);
      if (!detected) {
        return next(new ApiError("File content could not be verified", 400));
      }
      if (!ALLOWED_MIMES.includes(detected)) {
        return next(new ApiError(`Unsupported file type: ${detected}`, 400));
      }

      const claimed = normalizeClaimedMime(f.mimetype);
      if (!ALLOWED_MIMES.includes(claimed)) {
        return next(new ApiError(`File type not allowed: ${claimed}`, 400));
      }

      if (claimed.startsWith("image/") && detected.startsWith("image/")) {
        if (claimed !== detected) {
          return next(
            new ApiError(
              `File type mismatch (claimed ${claimed}, actual ${detected})`,
              400,
            ),
          );
        }
      }

      if (claimed.startsWith("video/") && detected.startsWith("video/")) {
        const bothMp4Family =
          detected === "video/mp4" &&
          (claimed === "video/mp4" ||
            claimed === "video/quicktime" ||
            claimed === "video/mov");
        if (!bothMp4Family && claimed !== detected) {
          return next(
            new ApiError(
              `File type mismatch (claimed ${claimed}, actual ${detected})`,
              400,
            ),
          );
        }
      }
    }
    return next();
  } catch (e) {
    return next(e);
  }
};

const multerOptions = () => {
  const multerStorage = multer.memoryStorage();

  const multerFilter = (req, file, cb) => {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(
        `📎 Multer checking file: ${file.originalname} - mimetype: ${file.mimetype}`,
      );
    }

    if (!ALLOWED_MIMES.includes(file.mimetype)) {
      if (isDev) {
        // eslint-disable-next-line no-console
        console.log(
          `❌ File rejected: ${file.originalname} - mimetype ${file.mimetype} not allowed`,
        );
      }
      return cb(
        new ApiError(`File type not allowed: ${file.mimetype}`, 400),
        false,
      );
    }

    if (isDev) {
      // eslint-disable-next-line no-console
      console.log(`✅ File accepted: ${file.originalname}`);
    }
    cb(null, true);
  };

  return multer({
    storage: multerStorage,
    fileFilter: multerFilter,
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 10,
    },
  });
};

exports.uploadSingleImage = (fieldName) => multerOptions().single(fieldName);

exports.uploadPostMedia = (fieldName) => multerOptions().array(fieldName, 10);

exports.uploadMixOfImages = (arrayOfFields) =>
  multerOptions().fields(arrayOfFields);
