const multer = require("multer");

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
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
    const isAllowed = allowedExtensions.has(ext) && allowedMimeTypes.has(file.mimetype);

    if (!isAllowed) {
      return cb(new Error("Only PNG, JPG, JPEG, and WEBP images are allowed"));
    }

    cb(null, true);
  },
});

module.exports = upload;
