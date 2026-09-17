const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const developmentSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const jwtSecret = () => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET is required in production");
  return developmentSecret;
};

function signUser(user) {
  return jwt.sign(
    { id: user._id, email: user.email || "", phone: user.phone || "", role: user.role, name: user.name },
    jwtSecret(),
    { expiresIn: "7d" }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    req.user = jwt.verify(token, jwtSecret());
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ message: "Admin access required" });
  next();
}

module.exports = { signUser, requireAuth, requireAdmin };
