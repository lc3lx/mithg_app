const multer = require("multer");
const ApiError = require("../utils/apiError");

const multerOptions = () => {
  const multerStorage = multer.memoryStorage();

  const multerFilter = (req, file, cb) => {
    const allowedMimes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/avi",
      "video/mov",
      "video/wmv",
      "video/quicktime", // .mov
      "video/x-msvideo", // .avi
      "video/x-ms-wmv", // .wmv
      "video/webm",
      "video/ogg",
      "video/mpeg",
    ];

    console.log(
      `📎 Multer checking file: ${file.originalname} - mimetype: ${file.mimetype}`
    );

    if (!allowedMimes.includes(file.mimetype)) {
      console.log(
        `❌ File rejected: ${file.originalname} - mimetype ${file.mimetype} not allowed`
      );
      return cb(
        new ApiError(`File type not allowed: ${file.mimetype}`, 400),
        false
      );
    }

    console.log(`✅ File accepted: ${file.originalname}`);
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

// 🖼️ صورة واحدة
exports.uploadSingleImage = (fieldName) => multerOptions().single(fieldName);

// 🖼️ + 🎥 عدة ملفات (بوست)
exports.uploadPostMedia = (fieldName) => multerOptions().array(fieldName, 10);

// خليها لو لسه مستخدمها بمكان ثاني
exports.uploadMixOfImages = (arrayOfFields) =>
  multerOptions().fields(arrayOfFields);
