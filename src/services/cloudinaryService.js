const { getCloudinary } = require("../config/cloudinary");

function uploadImage(buffer, options = {}) {
  const cloudinary = getCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || "nijer-market/products",
        resource_type: "image",
        transformation: [{ width: 1600, height: 1600, crop: "limit", quality: "auto", fetch_format: "auto" }]
      },
      (error, result) => error ? reject(error) : resolve(result)
    );
    stream.end(buffer);
  });
}

async function deleteImage(publicId) {
  if (!publicId) return null;
  return getCloudinary().uploader.destroy(publicId, { resource_type: "image" });
}

module.exports = { uploadImage, deleteImage };
