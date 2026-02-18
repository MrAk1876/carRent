const multer = require("multer");

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".jfif", ".webp"]);
const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/webp",
]);

const path = require("path");
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = String(file.mimetype || "").toLowerCase();
    const isAllowed = allowedExtensions.has(ext) || allowedMimeTypes.has(mimeType);

    if (!isAllowed) {
      const error = new Error("Only PNG, JPG, JPEG, JFIF, and WEBP images are allowed");
      error.status = 422;
      error.statusCode = 422;
      return cb(error);
    }

    cb(null, true);
  },
});

module.exports = upload;
