const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { signUser, requireAuth, requireAdmin } = require("./src/middleware/auth");
const store = require("./src/services/store");
const { uploadImage, deleteImage } = require("./src/services/cloudinaryService");
const { corsOrigins } = require("./src/config/environment");
const { getPaymentConfig } = require("./src/config/payment");
const { normalizeItems, priceOrder } = require("./src/services/orderPricing");
const { createHash } = require("crypto");

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, !origin || corsOrigins.includes(origin));
    },
    credentials: true,
  })
);

app.use(express.json());

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    callback(null, allowedTypes.includes(file.mimetype));
  }
});

function handleImageUpload(req, res, next) {
  imageUpload.single("image")(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ message: "Image must be 5MB or smaller" });
    }
    return res.status(400).json({ message: "Only JPG, PNG, and WEBP images are allowed" });
  });
}

function sendStoreError(res, error, fallback) {
  const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  res.status(statusCode).json({ message: statusCode === 500 ? fallback : error.message });
}

app.get("/api/health", (req, res) => res.json({ status: "ok", app: "NIJER MARKET API" }));
app.get("/api/payment-config", (req, res) => res.json(getPaymentConfig()));

app.get("/api/products", async (req, res) => {
  try { res.json(await store.listProducts({ search: String(req.query.search || ""), category: String(req.query.category || "") })); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get("/api/products/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 80);
    const category = String(req.query.category || "").trim().slice(0, 60);
    if (!query) return res.json({ success: true, data: { query, suggestions: [], products: [], total: 0 } });
    const data = await store.searchProductCatalog({ query, category });
    res.json({ success: true, data: { query, ...data } });
  } catch (error) {
    res.status(500).json({ message: "Search is temporarily unavailable" });
  }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await store.getProduct(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

async function login(req, res, adminOnly = false) {
  const identifier = String(req.body?.identifier || req.body?.email || "").trim();
  const password = String(req.body?.password || "");
  const user = await store.findUserByIdentifier(identifier);
  if (!user || (adminOnly && user.role !== "admin") || !(await bcrypt.compare(password, user.passwordHash || ""))) {
    return res.status(401).json({ message: adminOnly ? "Invalid admin credentials" : "Invalid credentials" });
  }
  const { passwordHash, ...safeUser } = user;
  res.json({ token: signUser(user), user: safeUser });
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const phone = store.normalizePhone(req.body?.phone);
    const password = String(req.body?.password || "");

    if (name.length < 2 || name.length > 80) return res.status(400).json({ message: "Name must be between 2 and 80 characters" });
    if (!email && !phone) return res.status(400).json({ message: "Enter an email address or phone number" });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address" });
    if (req.body?.phone && !/^\+?[0-9\s()-]{10,15}$/.test(String(req.body.phone))) return res.status(400).json({ message: "Enter a valid phone number" });
    if (password.length < 6) return res.status(400).json({ message: "Password must be at least 6 characters" });
    if (await store.findUserByIdentifier(email || phone)) return res.status(409).json({ message: "An account with this email or phone number already exists" });

    const user = await store.createUser({
      name,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      passwordHash: await bcrypt.hash(password, 12),
      role: "customer"
    });
    const { passwordHash, ...safeUser } = user;
    res.status(201).json({ token: signUser(user), user: safeUser });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "An account with this email already exists" });
    res.status(500).json({ message: error.message || "Registration failed" });
  }
});

app.post("/api/auth/admin-login", (req, res) => login(req, res, true).catch(error => res.status(500).json({ message: error.message })));
app.post("/api/auth/login", (req, res) => login(req, res).catch(error => res.status(500).json({ message: error.message })));
app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await store.findUserById(req.user.id);
  if (!user) return res.status(401).json({ message: "Account no longer exists" });
  const { passwordHash, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.get("/api/orders/my", requireAuth, async (req, res) => {
  try {
    res.json(await store.listOrders({ userId: req.user.id }));
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load orders" });
  }
});

app.post("/api/orders/quote", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store").json(await priceOrder(req.body?.items));
  } catch (error) {
    sendStoreError(res, error, "Unable to calculate checkout total");
  }
});

app.post("/api/orders", requireAuth, async (req, res) => {
  try {
    const { items, address = "", phone = "", paymentMethod = "COD", utr = "", clientRequestId = "" } = req.body || {};
    if (String(address).trim().length < 5 || String(phone).trim().length < 7) {
      return res.status(400).json({ message: "A valid address and phone number are required" });
    }
    if (!["COD", "UPI"].includes(paymentMethod)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }
    const cleanUtr = String(utr || "").trim();
    if (paymentMethod === "UPI" && cleanUtr && (cleanUtr.length < 6 || cleanUtr.length > 80)) {
      return res.status(400).json({ message: "Enter a valid UTR or transaction reference" });
    }

    const idempotencyKey = typeof clientRequestId === "string" ? clientRequestId.trim() : "";
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(idempotencyKey)) {
      return res.status(400).json({ message: "A valid checkout request ID is required. Refresh checkout." });
    }
    const normalizedItems = normalizeItems(items);
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ items: normalizedItems, address: String(address).trim(), phone: String(phone).trim(), paymentMethod, utr: paymentMethod === "UPI" ? cleanUtr : "" }))
      .digest("hex");
    // Resolve successful retries before checking stock, prices or current payment configuration.
    const existing = await store.findOrderSubmission(req.user.id, idempotencyKey);
    if (existing) return res.json(store.verifyOrderRetry(existing, requestHash));
    if (paymentMethod === "UPI" && !getPaymentConfig().enabled) {
      return res.status(503).json({ message: "UPI payment is not configured. Please use Cash on Delivery or contact the shop." });
    }
    // expectedTotal only detects stale displays; it never determines the saved amount.
    const priced = await priceOrder(normalizedItems);
    const expectedTotal = req.body.expectedTotal;
    if (typeof expectedTotal !== "number" || !Number.isFinite(expectedTotal) || Math.round(expectedTotal * 100) !== Math.round(priced.total * 100)) {
      return res.status(409).json({ message: "The checkout total has changed. Refresh checkout before paying. If you already paid, contact the shop before paying again." });
    }

    const order = await store.createOrder({
      userId: req.user.id,
      customerName: req.user.name,
      customerEmail: req.user.email,
      items: priced.items,
      address: String(address).trim(),
      phone: String(phone).trim(),
      paymentMethod,
      // Only "unpaid" (COD) or "payment_submitted" (UPI) can ever be set here.
      paymentStatus: paymentMethod === "UPI" ? "payment_submitted" : "unpaid",
      utr: paymentMethod === "UPI" ? cleanUtr : "",
      idempotencyKey,
      requestHash,
      ...(paymentMethod === "UPI" ? { paymentSubmittedAt: new Date() } : {}),
      subtotal: priced.subtotal,
      delivery: priced.delivery,
      total: priced.total,
      status: "Placed"
    });
    res.status(201).json(order);
  } catch (error) {
    sendStoreError(res, error, "Failed to create order");
  }
});

app.get("/api/announcements", async (req, res) => {
  try {
    res.json(await store.listAnnouncements());
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load announcements" });
  }
});

app.post("/api/uploads/image", requireAuth, requireAdmin, handleImageUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "An image file is required" });
  try {
    const result = await uploadImage(req.file.buffer, { folder: "nijer-market/products" });
    res.status(201).json({
      success: true,
      message: "Image uploaded successfully",
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format
      }
    });
  } catch (error) {
    console.error("Cloudinary image upload failed:", error.message);
    const missingConfiguration = error.message.startsWith("Cloudinary is not configured");
    const authorizationFailure = error.http_code === 401 || error.http_code === 403 || /status code - (401|403)/.test(error.message);
    const message = missingConfiguration
      ? error.message
      : authorizationFailure
        ? "Cloudinary rejected the API credentials or upload permission for this product environment"
        : "Image upload failed";
    res.status(missingConfiguration ? 503 : 502).json({ message });
  }
});

app.get("/api/admin/stats", requireAuth, requireAdmin, async (req, res) => res.json(await store.getStats()));
app.get("/api/admin/customers", requireAuth, requireAdmin, async (req, res) => res.json(await store.listCustomers()));
app.get("/api/admin/orders", requireAuth, requireAdmin, async (req, res) => res.json(await store.listOrders({ all: true })));
app.get("/api/admin/announcements", requireAuth, requireAdmin, async (req, res) => res.json(await store.listAnnouncements()));
app.post("/api/admin/announcements", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { title, message, type } = req.body || {};
    if (!String(title || "").trim()) return res.status(400).json({ message: "Announcement title is required" });
    if (!String(message || "").trim()) return res.status(400).json({ message: "Announcement message is required" });
    const announcement = await store.createAnnouncement({ title, message, type });
    res.status(201).json(announcement);
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to create announcement" });
  }
});
app.delete("/api/admin/announcements/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const removed = await store.deleteAnnouncement(req.params.id);
    if (!removed) return res.status(404).json({ message: "Announcement not found" });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to delete announcement" });
  }
});
app.patch("/api/admin/orders/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const order = await store.updateOrderStatus(req.params.id, req.body.status);
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    sendStoreError(res, error, "Failed to update order status");
  }
});
app.patch("/api/admin/orders/:id/payment/confirm", requireAuth, requireAdmin, async (req, res) => {
  try {
    const order = await store.updatePaymentStatus(req.params.id, "paid", { confirmedBy: req.user.email || req.user.id });
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    sendStoreError(res, error, "Failed to confirm payment");
  }
});
app.patch("/api/admin/orders/:id/payment/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const order = await store.updatePaymentStatus(req.params.id, "payment_rejected");
    if (!order) return res.status(404).json({ message: "Order not found" });
    res.json(order);
  } catch (error) {
    sendStoreError(res, error, "Failed to reject payment");
  }
});
app.post("/api/admin/products", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!String(req.body?.name || "").trim()) return res.status(400).json({ message: "Product name is required" });
    res.status(201).json(await store.createProduct(req.body));
  } catch (error) {
    console.error("Product creation failed:", error.message);
    res.status(500).json({ message: "Product could not be saved" });
  }
});
app.put("/api/admin/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await store.getProduct(req.params.id);
    if (!existing) return res.status(404).json({ message: "Product not found" });
    const product = await store.updateProduct(req.params.id, req.body);
    const imageMetadataProvided = Object.prototype.hasOwnProperty.call(req.body, "imagePublicId");
    if (imageMetadataProvided && existing.imagePublicId && existing.imagePublicId !== req.body.imagePublicId) {
      try { await deleteImage(existing.imagePublicId); } catch (error) { console.error("Old Cloudinary image cleanup failed:", error.message); }
    }
    res.json(product);
  } catch (error) {
    console.error("Product update failed:", error.message);
    res.status(500).json({ message: "Product could not be updated" });
  }
});
app.delete("/api/admin/products/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const existing = await store.getProduct(req.params.id);
    if (!existing || !await store.deleteProduct(req.params.id)) return res.status(404).json({ message: "Product not found" });
    if (existing.imagePublicId) {
      try { await deleteImage(existing.imagePublicId); } catch (error) { console.error("Deleted product image cleanup failed:", error.message); }
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Product deletion failed:", error.message);
    res.status(500).json({ message: "Product could not be deleted" });
  }
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "NIJER MARKET API is running 🚀",
  });
});

// Your routes go here
// app.use("/api/products", productRoutes);
// app.use("/api/auth", authRoutes);
// app.use("/api/orders", orderRoutes);

module.exports = app;