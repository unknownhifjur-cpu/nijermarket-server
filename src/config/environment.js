const configuredOrigins = [process.env.CLIENT_URL, process.env.CORS_ORIGINS]
  .filter(Boolean)
  .flatMap(value => value.split(","))
  .map(value => value.trim().replace(/\/$/, ""))
  .filter(Boolean);
const corsOrigins = process.env.NODE_ENV === "production"
  ? configuredOrigins
  : [...configuredOrigins, "http://localhost:5173", "http://localhost:5174", "http://127.0.0.1:5173", "http://127.0.0.1:5174"];

function validateProductionEnvironment() {
  if (process.env.NODE_ENV !== "production") return;
  const required = ["MONGO_URI", "JWT_SECRET", "ADMIN_EMAIL", "ADMIN_PASSWORD", "CLIENT_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "UPI_ID", "UPI_QR_CODE_URL"];
  const missing = required.filter(name => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error(`Missing production environment variables: ${missing.join(", ")}`);
  if (String(process.env.JWT_SECRET).length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production");
}

module.exports = { corsOrigins, validateProductionEnvironment };
