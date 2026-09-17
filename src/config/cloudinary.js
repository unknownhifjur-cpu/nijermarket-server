const cloudinary = require("cloudinary").v2;

const requiredVariables = ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"];

function getCloudinary() {
  const missing = requiredVariables.filter(name => !String(process.env[name] || "").trim());
  if (missing.length) {
    throw new Error(`Cloudinary is not configured. Missing: ${missing.join(", ")}`);
  }
  if (/\s/.test(process.env.CLOUDINARY_CLOUD_NAME)) {
    throw new Error("Cloudinary cloud name is invalid. Use the exact Cloud name identifier from Cloudinary, not the account display name.");
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  return cloudinary;
}

module.exports = { getCloudinary };
