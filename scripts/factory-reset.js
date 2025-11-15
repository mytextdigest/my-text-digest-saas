const fs = require("fs");
const path = require("path");

const dbPath = path.join(process.cwd(), "my_text_digest.db");
// adjust this to your actual uploads folder path
const uploadsDir = path.join(process.cwd(), "uploads");

function deleteIfExists(targetPath, isDir = false) {
  if (fs.existsSync(targetPath)) {
    if (isDir) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    console.log(`🗑️  Deleted: ${targetPath}`);
  } else {
    console.log(`ℹ️  Not found: ${targetPath}`);
  }
}

// Delete database
deleteIfExists(dbPath);

// Delete uploads/original files folder
deleteIfExists(uploadsDir, true);

console.log("✅ Factory reset complete! Fresh start on next app launch.");
