/**
 * File upload validation middleware.
 * Validates file type, size, and content before accepting uploads.
 */
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

// Allowed MIME types for receipt uploads
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf'
];

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${uniqueSuffix}${ext}`);
  }
});

// File filter
function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error(`Invalid file type: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`), false);
  }
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error(`Invalid MIME type: ${file.mimetype}. Allowed: images and PDF only.`), false);
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  }
});

// Error handler for multer
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'fail',
        message: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ status: 'fail', message: 'Too many files. Only 1 file allowed.' });
    }
    return res.status(400).json({ status: 'fail', message: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ status: 'fail', message: err.message });
  }
  next();
}

module.exports = { upload, handleUploadError, ALLOWED_MIME_TYPES, MAX_FILE_SIZE };
