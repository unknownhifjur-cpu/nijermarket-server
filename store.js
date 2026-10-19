const dns = require("dns");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const User = require("./models/User");
const Order = require("./models/Order");
const { searchProducts } = require("./src/services/searchService");

let mongoConnected = false;

const seedProducts = [
  { name: "Fresh Potato", nameBn: "আলু", nameBanglish: "alu", aliases: ["aloo", "potato"], category: "Fresh Food", price: 30, mrp: 45, discount: 33, unit: "1 kg", stock: 100, badge: "Fresh", image: "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=80" },
  { name: "Fresh Tomato", nameBn: "টমেটো", nameBanglish: "tomato", aliases: ["tamato", "tameto", "tometo"], category: "Fresh Food", price: 40, mrp: 60, discount: 33, unit: "1 kg", stock: 90, badge: "Fresh", image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=900&q=80" }
];

const demo = {
  products: seedProducts.map((product, index) => ({ ...product, _id: `demo-product-${index + 1}` })),
  users: [],
  orders: [],
  announcements: [
    {
      _id: "demo-announcement-1",
      title: "Free Delivery",
      message: "Free delivery above ₹499 and same-day delivery in selected areas.",
      type: "offer",
      createdAt: new Date().toISOString()
    }
  ]
};

function normalize(document) {
  if (!document) return null;
  if (typeof document.toObject === "function") {
    const value = document.toObject();
    value._id = String(value._id);
    return value;
  }
  return { ...document };
}

async function ensureDemoAdmin() {
  const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email || !process.env.ADMIN_PASSWORD) return;
  if (demo.users.some(user => user.email === email)) return;
  demo.users.push({
    _id: "demo-admin-1",
    name: "NIJER MARKET Admin",
    email,
    passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
    role: "admin"
  });
}

async function initStore() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

  if (!mongoUri) {
    if (process.env.NODE_ENV === "production") throw new Error("MONGO_URI is required in production");
    console.log("⚠️ MongoDB URI not found. Using DEMO memory mode.");
    await ensureDemoAdmin();
    return;
  }

  try {
    const dnsServers = String(process.env.MONGO_DNS_SERVERS || "")
      .split(",")
      .map(server => server.trim())
      .filter(Boolean);
    if (dnsServers.length) dns.setServers(dnsServers);

    await mongoose.connect(mongoUri);

    mongoConnected = true;

    const userIndexes = await User.collection.indexes();
    const legacyEmailIndex = userIndexes.find(index => index.key?.email === 1 && !index.sparse);
    if (legacyEmailIndex) await User.collection.dropIndex(legacyEmailIndex.name);
    await User.syncIndexes();
    // Ensure cross-process checkout retry protection exists before accepting orders.
    await Order.createIndexes();

    console.log("✅ MongoDB connected successfully");

    if (await Product.countDocuments() === 0) await Product.insertMany(seedProducts);
    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail && process.env.ADMIN_PASSWORD && !await User.findOne({ email: adminEmail })) {
      await User.create({
        name: "NIJER MARKET Admin",
        email: adminEmail,
        passwordHash: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
        role: "admin"
      });
    }
  } catch (error) {
    mongoConnected = false;

    if (process.env.NODE_ENV === "production") throw error;

    console.log("⚠️ MongoDB connection failed. Falling back to demo mode.");
    console.log(error.message);
    await ensureDemoAdmin();
  }
}

async function listProducts({ search = "", category = "" } = {}) {
  if (mongoConnected) {
    const query = category && category !== "All" ? { category } : {};
    const products = (await Product.find(query).sort({ createdAt: -1 })).map(normalize);
    return search ? (await searchProducts({ products, query: search, category })).products : products;
  }
  const products = category && category !== "All" ? demo.products.filter(product => product.category === category) : demo.products;
  return search ? (await searchProducts({ products, query: search, category })).products : products;
}

async function searchProductCatalog({ query = "", category = "" } = {}) {
  const products = await listProducts({ category });
  const result = await searchProducts({ products, query, category });
  return { products: result.products, suggestions: result.suggestions, total: result.products.length };
}

async function getProduct(id) {
  return mongoConnected ? normalize(await Product.findById(id)) : demo.products.find(product => product._id === id) || null;
}

async function createProduct(data) {
  if (mongoConnected) return normalize(await Product.create(data));
  const product = { ...data, _id: `demo-product-${Date.now()}` };
  demo.products.unshift(product);
  return product;
}

async function updateProduct(id, data) {
  if (mongoConnected) return normalize(await Product.findByIdAndUpdate(id, data, { new: true }));
  const index = demo.products.findIndex(product => product._id === id);
  if (index < 0) return null;
  demo.products[index] = { ...demo.products[index], ...data };
  return demo.products[index];
}

async function deleteProduct(id) {
  if (mongoConnected) return Boolean(await Product.findByIdAndDelete(id));
  const before = demo.products.length;
  demo.products = demo.products.filter(product => product._id !== id);
  return demo.products.length !== before;
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email).toLowerCase();
  return mongoConnected ? normalize(await User.findOne({ email: normalizedEmail })) : demo.users.find(user => user.email === normalizedEmail) || null;
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return phone ? `+${digits}` : "";
}

async function findUserByIdentifier(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return null;
  const email = value.toLowerCase();
  const phone = normalizePhone(value);
  return mongoConnected
    ? normalize(await User.findOne({ $or: [{ email }, { phone }] }))
    : demo.users.find(user => user.email === email || user.phone === phone) || null;
}

async function findUserById(id) {
  return mongoConnected ? normalize(await User.findById(id)) : demo.users.find(user => user._id === id) || null;
}

async function saveDeliveryAddress(userId, address) {
  if (mongoConnected) {
    if (!mongoose.isValidObjectId(userId)) return null;
    return normalize(await User.findByIdAndUpdate(
      userId,
      { $set: { deliveryAddress: address } },
      { new: true, runValidators: true }
    ));
  }
  const user = demo.users.find(item => item._id === userId);
  if (!user) return null;
  user.deliveryAddress = { ...address };
  return user;
}

async function createUser(data) {
  if (mongoConnected) return normalize(await User.create(data));
  const user = { ...data, _id: `demo-user-${Date.now()}` };
  demo.users.push(user);
  return user;
}

function orderError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

async function findOrderSubmission(userId, idempotencyKey) {
  return mongoConnected
    ? normalize(await Order.findOne({ userId, idempotencyKey }))
    : demo.orders.find(order => order.userId === userId && order.idempotencyKey === idempotencyKey) || null;
}

function verifyOrderRetry(order, requestHash) {
  if (order.requestHash !== requestHash) {
    throw orderError("This checkout was already submitted with different details. Check My Orders before starting another order.", 409);
  }
  return order;
}

async function createOrder(data) {
  if (mongoConnected) {
    try {
      return normalize(await Order.create(data));
    } catch (error) {
      if (error.code !== 11000 || !data.idempotencyKey) throw error;
      const existing = await findOrderSubmission(data.userId, data.idempotencyKey);
      if (!existing) throw error;
      return verifyOrderRetry(existing, data.requestHash);
    }
  }
  // No await between checking and inserting: concurrent demo requests cannot duplicate.
  const existing = data.idempotencyKey && demo.orders.find(order => order.userId === data.userId && order.idempotencyKey === data.idempotencyKey);
  if (existing) return verifyOrderRetry(existing, data.requestHash);
  const order = { ...data, _id: `demo-order-${randomUUID()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  demo.orders.unshift(order);
  return order;
}

async function listOrders({ userId, all = false } = {}) {
  if (mongoConnected) return (await Order.find(all ? {} : { userId }).sort({ createdAt: -1 })).map(normalize);
  return demo.orders.filter(order => all || order.userId === userId);
}

async function updateOrderStatus(id, status) {
  if (!["Placed", "Packed", "Out for Delivery", "Delivered", "Cancelled"].includes(status)) {
    throw orderError("Invalid order status", 400);
  }
  if (mongoConnected && !mongoose.isValidObjectId(id)) return null;
  if (mongoConnected) return normalize(await Order.findByIdAndUpdate(id, { status, updatedAt: new Date() }, { new: true }));
  const order = demo.orders.find(item => item._id === id);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  return order;
}

async function updatePaymentStatus(id, paymentStatus, audit = {}) {
  if (!["paid", "payment_rejected"].includes(paymentStatus)) throw orderError("Invalid payment action", 400);
  if (paymentStatus === "paid" && !audit.confirmedBy) throw orderError("Payment confirmer is required", 400);
  const update = { paymentStatus, updatedAt: new Date() };
  if (paymentStatus === "paid") {
    update.paymentConfirmedAt = new Date();
    update.paymentConfirmedBy = String(audit.confirmedBy);
  }
  if (mongoConnected) {
    if (!mongoose.isValidObjectId(id)) return null;
    // Compare-and-set prevents two admins from approving/rejecting the same submission.
    const changed = await Order.findOneAndUpdate(
      { _id: id, paymentMethod: "UPI", paymentStatus: "payment_submitted" },
      { $set: update },
      { new: true, runValidators: true }
    );
    if (changed) return normalize(changed);
    const existing = normalize(await Order.findById(id));
    if (!existing) return null;
    if (existing.paymentMethod === "UPI" && existing.paymentStatus === paymentStatus) return existing;
    throw orderError("Only UPI payments awaiting verification can be confirmed or rejected. Refresh this order.", 409);
  }
  const order = demo.orders.find(item => item._id === id);
  if (!order) return null;
  if (order.paymentMethod === "UPI" && order.paymentStatus === paymentStatus) return order;
  if (order.paymentMethod !== "UPI" || order.paymentStatus !== "payment_submitted") {
    throw orderError("Only UPI payments awaiting verification can be confirmed or rejected. Refresh this order.", 409);
  }
  Object.assign(order, update, { updatedAt: new Date().toISOString() });
  return order;
}

async function listAnnouncements() {
  return demo.announcements
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createAnnouncement(data = {}) {
  const announcement = {
    _id: `demo-announcement-${Date.now()}`,
    title: String(data.title || "New announcement").trim() || "New announcement",
    message: String(data.message || "").trim(),
    type: String(data.type || "info").trim() || "info",
    createdAt: new Date().toISOString()
  };
  demo.announcements.unshift(announcement);
  return announcement;
}

async function deleteAnnouncement(id) {
  const before = demo.announcements.length;
  demo.announcements = demo.announcements.filter(item => item._id !== id);
  return demo.announcements.length !== before;
}

async function getStats() {
  const [products, orders] = await Promise.all([listProducts(), listOrders({ all: true })]);
  const customers = mongoConnected ? await User.countDocuments({ role: "customer" }) : demo.users.filter(user => user.role === "customer").length;
  const revenueOrders = orders.filter(order => order.status !== "Cancelled");
  const statusBreakdown = orders.reduce((result, order) => {
    const status = order.status || "Placed";
    result[status] = (result[status] || 0) + 1;
    return result;
  }, {});
  const categoryBreakdown = products.reduce((result, product) => {
    const category = product.category || "Uncategorized";
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  return {
    products: products.length,
    orders: orders.length,
    customers,
    revenue: revenueOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    statusBreakdown,
    categoryBreakdown,
    lowStock: products.filter(product => Number(product.stock || 0) <= 10).slice(0, 6),
    recentOrders: orders.slice(0, 5)
  };
}

async function listCustomers() {
  const users = mongoConnected
    ? (await User.find({ role: "customer" }).sort({ createdAt: -1 })).map(normalize)
    : demo.users.filter(user => user.role === "customer");
  const orders = await listOrders({ all: true });
  return users.map(user => {
    const userOrders = orders.filter(order => order.userId === user._id);
    return {
      _id: user._id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      orders: userOrders.length,
      spent: userOrders.filter(order => order.status !== "Cancelled").reduce((sum, order) => sum + Number(order.total || 0), 0),
      lastOrderAt: userOrders[0]?.createdAt || null
    };
  });
}

function isMongoConnected() {
  return mongoConnected;
}

module.exports = {
  initStore,
  isMongoConnected,
  demoProducts: demo.products,
  listProducts,
  searchProductCatalog,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  findUserByEmail,
  findUserByIdentifier,
  findUserById,
  saveDeliveryAddress,
  normalizePhone,
  createUser,
  createOrder,
  findOrderSubmission,
  verifyOrderRetry,
  listOrders,
  updateOrderStatus,
  updatePaymentStatus,
  listAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  getStats,
  listCustomers
};