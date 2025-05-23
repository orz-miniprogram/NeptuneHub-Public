// backend/utils/multerConfig.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure where to store uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create the uploads directory if it doesn't exist
    // This path should be relative to your project root or a stable location
    const uploadDir = path.join(__dirname, '../../uploads'); // Adjust path as needed
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true }); // recursive: true creates parent directories too
    }
    cb(null, uploadDir); // Save files to the 'uploads' directory
  },
  filename: function (req, file, cb) {
    // Define the filename: use original name + timestamp to avoid conflicts
    cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
  }
});

// Create the multer instance
const upload = multer({ storage: storage });

module.exports = upload;
