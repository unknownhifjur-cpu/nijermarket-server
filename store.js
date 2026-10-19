const dns = require("dns");
const { randomUUID } = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Product = require("./models/Product");
const Category = require("./models/Category");
const User = require("./models/User");
const Order = require("./models/Order");
const { searchProducts } = require("./src/services/searchService");
const { categoryKey, getProductCategories, normalizeCategory } = require("./src/utils/categories");
const { statusNotes, validateOrderTransition, workflowError } = require("./src/services/orderWorkflow");

let mongoConnected = false;

const seedProducts = [
  { name: "Fresh Potato", nameBn: "আলু", nameBanglish: "alu", aliases: ["aloo", "potato"], category: "Root Vegetables", mainCategoryId: "demo-category-fresh-food", subcategoryId: "demo-subcategory-root-vegetables", price: 30, mrp: 45, discount: 33, unit: "1 kg", stock: 100, badge: "Fresh", image: "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=900&q=80" },
  { name: "Fresh Tomato", nameBn: "টমেটো", nameBanglish: "tomato", aliases: ["tamato", "tameto", "tometo"], category: "Fruiting Vegetables", mainCategoryId: "demo-category-fresh-food", subcategoryId: "demo-subcategory-fruiting-vegetables", price: 40, mrp: 60, discount: 33, unit: "1 kg", stock: 90, badge: "Fresh", image: "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?auto=format&fit=crop&w=900&q=80" }
];

const demo = {
  categories: [
    { _id: "demo-category-fresh-food", name: "Fresh Food", normalizedName: "fresh food", parentId: null, description: "", image: "", displayOrder: 0, isActive: true, showOnHome: true },
    { _id: "demo-subcategory-root-vegetables", name: "Root Vegetables", normalizedName: "root vegetables", parentId: "demo-category-fresh-food", description: "", image: "", displayOrder: 0, isActive: true, showOnHome: false },
    { _id: "demo-subcategory-fruiting-vegetables", name: "Fruiting Vegetables", normalizedName: "fruiting vegetables", parentId: "demo-category-fresh-food", description: "", image: "", displayOrder: 1, isActive: true, showOnHome: false }
  ],
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
    if (value.parentId) value.parentId = String(value.parentId);
    if (value.mainCategoryId) value.mainCategoryId = String(value.mainCategoryId);
    if (value.subcategoryId) value.subcategoryId = String(value.subcategoryId);
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
    await Category.syncIndexes();
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

async function availableProducts() {
  return mongoConnected
    ? (await Product.find({}).sort({ createdAt: -1 })).map(normalize)
    : [...demo.products];
}

function categoryError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function availableCategories() {
  return mongoConnected
    ? (await Category.find({}).sort({ displayOrder: 1, name: 1 })).map(normalize)
    : [...demo.categories];
}

async function addCategoryLabels(products, categories = null) {
  categories = categories || await availableCategories();
  const byId = new Map(categories.map(category => [String(category._id), category]));
  return products.map(product => {
    const subcategory = byId.get(String(product.subcategoryId || ""));
    return subcategory ? { ...product, category: subcategory.name } : product;
  });
}

function isCategoryAssignmentPublic(product, categoriesById) {
  if (!product.mainCategoryId && !product.subcategoryId) return true;
  const main = categoriesById.get(String(product.mainCategoryId || ""));
  const subcategory = categoriesById.get(String(product.subcategoryId || ""));
  return Boolean(
    main && !main.parentId && main.isActive !== false &&
    subcategory && String(subcategory.parentId) === String(main._id) && subcategory.isActive !== false
  );
}

async function listCategories({ homeOnly = false, includeInactive = false } = {}) {
  const [categories, products] = await Promise.all([availableCategories(), availableProducts()]);
  const mainProductCounts = new Map();
  const subcategoryProductCounts = new Map();
  const categoryById = new Map(categories.map(category => [String(category._id), category]));
  products.forEach(product => {
    const mainId = String(product.mainCategoryId || "");
    const subcategoryId = String(product.subcategoryId || "");
    const main = categoryById.get(mainId);
    const subcategory = categoryById.get(subcategoryId);
    const productIsVisible = main && subcategory && String(subcategory.parentId) === mainId &&
      (includeInactive || (main.isActive !== false && subcategory.isActive !== false));
    if (!productIsVisible) return;
    mainProductCounts.set(mainId, (mainProductCounts.get(mainId) || 0) + 1);
    subcategoryProductCounts.set(subcategoryId, (subcategoryProductCounts.get(subcategoryId) || 0) + 1);
  });
  const active = category => includeInactive || category.isActive !== false;
  const subcategories = categories.filter(category => category.parentId);
  return categories
    .filter(category => !category.parentId && active(category))
    .map(category => ({
      ...category,
      productCount: mainProductCounts.get(String(category._id)) || 0,
      subcategories: subcategories
        .filter(subcategory => String(subcategory.parentId) === String(category._id) && active(subcategory))
        .sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0) || left.name.localeCompare(right.name))
        .map(subcategory => ({
          ...subcategory,
          productCount: subcategoryProductCounts.get(String(subcategory._id)) || 0
        }))
    }))
    .filter(category => !homeOnly || (category.showOnHome !== false && category.productCount > 0))
    .sort((left, right) => Number(left.displayOrder || 0) - Number(right.displayOrder || 0) || left.name.localeCompare(right.name));
}

async function getCategory(id) {
  if (!id) return null;
  if (mongoConnected) {
    if (!mongoose.isValidObjectId(id)) return null;
    return normalize(await Category.findById(id));
  }
  return demo.categories.find(category => category._id === String(id)) || null;
}

async function createCategory(data) {
  const name = normalizeCategory(data.name);
  if (!name || name.length > 80) throw categoryError("Category name must be between 1 and 80 characters");
  const parentId = data.parentId ? String(data.parentId) : null;
  if (parentId) {
    const parent = await getCategory(parentId);
    if (!parent) throw categoryError("Parent category not found", 404);
    if (parent.parentId) throw categoryError("Subcategories can only belong to a main category");
  }
  const normalizedName = categoryKey(name);
  const duplicate = mongoConnected
    ? await Category.findOne({ parentId, normalizedName })
    : demo.categories.find(category => String(category.parentId || "") === String(parentId || "") && category.normalizedName === normalizedName);
  if (duplicate) throw categoryError("A category with this name already exists at this level", 409);

  const categoryData = {
    name,
    normalizedName,
    parentId,
    description: String(data.description || "").trim(),
    image: String(data.image || "").trim(),
    displayOrder: Number.isFinite(Number(data.displayOrder)) ? Number(data.displayOrder) : 0,
    isActive: data.isActive !== false,
    showOnHome: parentId ? false : data.showOnHome !== false
  };
  try {
    if (mongoConnected) return normalize(await Category.create(categoryData));
    const category = { ...categoryData, _id: `demo-category-${randomUUID()}` };
    demo.categories.push(category);
    return category;
  } catch (error) {
    if (error.code === 11000) throw categoryError("A category with this name already exists at this level", 409);
    throw error;
  }
}

async function updateCategory(id, data) {
  const existing = await getCategory(id);
  if (!existing) return null;
  const updates = {};
  if (Object.hasOwn(data, "name")) {
    const name = normalizeCategory(data.name);
    if (!name || name.length > 80) throw categoryError("Category name must be between 1 and 80 characters");
    const normalizedName = categoryKey(name);
    const duplicate = mongoConnected
      ? await Category.findOne({ _id: { $ne: id }, parentId: existing.parentId || null, normalizedName })
      : demo.categories.find(category => category._id !== String(id) && String(category.parentId || "") === String(existing.parentId || "") && category.normalizedName === normalizedName);
    if (duplicate) throw categoryError("A category with this name already exists at this level", 409);
    updates.name = name;
    updates.normalizedName = normalizedName;
  }
  if (Object.hasOwn(data, "description")) updates.description = String(data.description || "").trim();
  if (Object.hasOwn(data, "image")) updates.image = String(data.image || "").trim();
  if (Object.hasOwn(data, "displayOrder")) {
    const displayOrder = Number(data.displayOrder);
    if (!Number.isInteger(displayOrder) || displayOrder < 0) throw categoryError("Display order must be a non-negative integer");
    updates.displayOrder = displayOrder;
  }
  if (Object.hasOwn(data, "isActive")) updates.isActive = Boolean(data.isActive);
  if (!existing.parentId && Object.hasOwn(data, "showOnHome")) updates.showOnHome = Boolean(data.showOnHome);
  if (mongoConnected) return normalize(await Category.findByIdAndUpdate(id, updates, { new: true, runValidators: true }));
  const category = demo.categories.find(item => item._id === String(id));
  Object.assign(category, updates);
  return category;
}

async function deleteCategory(id) {
  const category = await getCategory(id);
  if (!category) return false;
  if (mongoConnected) {
    const [child, assignedProduct] = await Promise.all([
      Category.findOne({ parentId: id }),
      Product.findOne({ $or: [{ mainCategoryId: id }, { subcategoryId: id }] }).select("_id")
    ]);
    if (child || assignedProduct) throw categoryError("Reassign this category's subcategories and products before deleting it", 409);
    await Category.findByIdAndDelete(id);
    return true;
  }
  if (demo.categories.some(item => String(item.parentId || "") === String(id)) ||
      demo.products.some(product => String(product.mainCategoryId || "") === String(id) || String(product.subcategoryId || "") === String(id))) {
    throw categoryError("Reassign this category's subcategories and products before deleting it", 409);
  }
  demo.categories = demo.categories.filter(item => item._id !== String(id));
  return true;
}

async function resolveProductCategory(mainCategoryId, subcategoryId) {
  if (!mainCategoryId || !subcategoryId) throw categoryError("Choose both a main category and a subcategory");
  const [mainCategory, subcategory] = await Promise.all([getCategory(mainCategoryId), getCategory(subcategoryId)]);
  if (!mainCategory || mainCategory.parentId || !mainCategory.isActive) throw categoryError("Choose an active main category");
  if (!subcategory || String(subcategory.parentId) !== String(mainCategory._id) || !subcategory.isActive) {
    throw categoryError("The selected subcategory does not belong to the selected main category");
  }
  return {
    category: subcategory.name,
    mainCategoryId: mainCategory._id,
    subcategoryId: subcategory._id
  };
}

async function validatePublicCategoryFilter(mainCategoryId, subcategoryId) {
  const mainCategory = mainCategoryId ? await getCategory(mainCategoryId) : null;
  const subcategory = subcategoryId ? await getCategory(subcategoryId) : null;
  if (mainCategoryId && (!mainCategory || mainCategory.parentId || !mainCategory.isActive)) {
    throw categoryError("The selected main category is unavailable");
  }
  if (subcategoryId && (!mainCategory || !subcategory || String(subcategory.parentId) !== String(mainCategory._id) || !subcategory.isActive)) {
    throw categoryError("The selected subcategory is unavailable");
  }
}

async function resolvePublicCategoryFilters({ category = "", mainCategoryId = "", subcategoryId = "" } = {}) {
  if (mainCategoryId || subcategoryId) {
    await validatePublicCategoryFilter(mainCategoryId, subcategoryId);
    return { mainCategoryId, subcategoryId, category: "" };
  }
  const key = categoryKey(category);
  if (!key || key === "all") return { mainCategoryId: "", subcategoryId: "", category };
  const categories = await availableCategories();
  const matches = categories.filter(item => categoryKey(item.name) === key);
  if (!matches.length) return { mainCategoryId: "", subcategoryId: "", category };
  if (matches.length !== 1) throw categoryError("This category name is ambiguous; select it from the category list");
  const selected = matches[0];
  if (selected.isActive === false) throw categoryError("This category is unavailable");
  if (selected.parentId) {
    const parent = await getCategory(selected.parentId);
    if (!parent || parent.isActive === false) throw categoryError("This category is unavailable");
    return { mainCategoryId: String(parent._id), subcategoryId: String(selected._id), category: "" };
  }
  return { mainCategoryId: String(selected._id), subcategoryId: "", category: "" };
}

async function unmappedProducts() {
  const products = await availableProducts();
  return products.filter(product => !product.mainCategoryId || !product.subcategoryId)
    .map(product => ({ _id: product._id, name: product.name, category: product.category || "" }));
}

function seededProductOrder(products, seed) {
  const hash = value => {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    }
    return result >>> 0;
  };
  return products.sort((left, right) =>
    hash(`${seed}:${left._id}`) - hash(`${seed}:${right._id}`) ||
    String(left._id).localeCompare(String(right._id))
  );
}

async function listProducts({ search = "", category = "", mainCategoryId = "", subcategoryId = "", page, limit, shuffleSeed = "" } = {}) {
  const selectedCategory = categoryKey(category);
  const [categories, storedProducts] = await Promise.all([availableCategories(), availableProducts()]);
  const categoriesById = new Map(categories.map(item => [String(item._id), item]));
  const visibleProducts = storedProducts.filter(product => isCategoryAssignmentPublic(product, categoriesById));
  let products = await addCategoryLabels(visibleProducts, categories);
  if (mainCategoryId) products = products.filter(product => String(product.mainCategoryId || "") === String(mainCategoryId));
  if (subcategoryId) products = products.filter(product => String(product.subcategoryId || "") === String(subcategoryId));
  if (!mainCategoryId && !subcategoryId && selectedCategory && selectedCategory !== "all") {
    products = products.filter(product => categoryKey(product.category) === selectedCategory);
  }
  if (search) products = (await searchProducts({ products, query: search, category: mainCategoryId || subcategoryId ? "" : category })).products;
  else if (shuffleSeed) products = seededProductOrder(products, String(shuffleSeed).slice(0, 64));
  if (!Number.isInteger(page) || !Number.isInteger(limit)) return products;
  const total = products.length;
  const pages = Math.ceil(total / limit);
  return { products: products.slice((page - 1) * limit, page * limit), total, page, limit, pages };
}

async function listProductCategories() {
  return getProductCategories(await listProducts());
}

async function searchProductCatalog({ query = "", category = "", mainCategoryId = "", subcategoryId = "" } = {}) {
  const products = await listProducts({ category, mainCategoryId, subcategoryId });
  const result = await searchProducts({ products, query, category: mainCategoryId || subcategoryId ? "" : category });
  return { products: result.products, suggestions: result.suggestions, total: result.products.length };
}

async function getProduct(id) {
  const product = mongoConnected ? normalize(await Product.findById(id)) : demo.products.find(item => item._id === id) || null;
  return product ? (await addCategoryLabels([product]))[0] : null;
}

async function isProductCategoryVisible(product) {
  const categories = await availableCategories();
  return isCategoryAssignmentPublic(product, new Map(categories.map(item => [String(item._id), item])));
}

async function createProduct(data) {
  const productData = { ...data };
  if (Object.prototype.hasOwnProperty.call(productData, "category")) {
    productData.category = normalizeCategory(productData.category);
  }
  if (mongoConnected) return normalize(await Product.create(productData));
  const product = { ...productData, _id: `demo-product-${Date.now()}` };
  demo.products.unshift(product);
  return product;
}

async function updateProduct(id, data) {
  const productData = { ...data };
  if (Object.prototype.hasOwnProperty.call(productData, "category")) {
    productData.category = normalizeCategory(productData.category);
  }
  if (mongoConnected) return normalize(await Product.findByIdAndUpdate(id, productData, { new: true }));
  const index = demo.products.findIndex(product => product._id === id);
  if (index < 0) return null;
  demo.products[index] = { ...demo.products[index], ...productData };
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
  const now = new Date();
  const orderData = {
    ...data,
    orderNumber: data.orderNumber || `NM-${randomUUID().replace(/-/g, "").toUpperCase()}`,
    trackingHistory: data.trackingHistory || [
      { status: data.status || "Placed", timestamp: now, note: "Order placed." },
      ...(data.paymentMethod === "UPI" ? [{
        status: "Payment submitted",
        timestamp: data.paymentSubmittedAt || now,
        note: "Customer submitted UPI payment for shop verification."
      }] : [])
    ]
  };
  if (mongoConnected) {
    try {
      return normalize(await Order.create(orderData));
    } catch (error) {
      if (error.code !== 11000 || !orderData.idempotencyKey) throw error;
      const existing = await findOrderSubmission(orderData.userId, orderData.idempotencyKey);
      if (!existing) throw error;
      return verifyOrderRetry(existing, orderData.requestHash);
    }
  }
  // No await between checking and inserting: concurrent demo requests cannot duplicate.
  const existing = orderData.idempotencyKey && demo.orders.find(order => order.userId === orderData.userId && order.idempotencyKey === orderData.idempotencyKey);
  if (existing) return verifyOrderRetry(existing, orderData.requestHash);
  const order = { ...orderData, _id: `demo-order-${randomUUID()}`, createdAt: now.toISOString(), updatedAt: now.toISOString() };
  demo.orders.unshift(order);
  return order;
}

async function listOrders({ userId, all = false } = {}) {
  if (mongoConnected) return (await Order.find(all ? {} : { userId }).sort({ createdAt: -1 })).map(normalize);
  return demo.orders.filter(order => all || order.userId === userId);
}

function orderTrackingEvent(status, audit = {}, timestamp = new Date()) {
  return {
    status,
    timestamp,
    note: String(audit.note || statusNotes[status] || "").trim().slice(0, 240),
    actorId: String(audit.actor?.id || ""),
    actorName: String(audit.actor?.name || ""),
    actorRole: String(audit.actor?.role || "")
  };
}

async function updateOrderStatus(id, status, audit = {}) {
  if (mongoConnected && !mongoose.isValidObjectId(id)) return null;
  if (mongoConnected) {
    const filter = { _id: id, ...(audit.userId ? { userId: audit.userId } : {}) };
    const existing = await Order.findOne(filter).lean();
    if (!existing) return null;
    const current = { ...existing, status: existing.status || "Placed" };
    if (audit.customerCancellation && !["Placed", "Cancelled"].includes(current.status)) {
      throw workflowError("Orders can only be cancelled before confirmation.", 409);
    }
    if (!validateOrderTransition(current, status)) return normalize(existing);
    const timestamp = new Date();
    const compareStatus = existing.status ? { status: existing.status } : { status: { $exists: false } };
    const updated = await Order.findOneAndUpdate(
      { ...filter, ...compareStatus },
      {
        $set: { status, updatedAt: timestamp },
        $push: { trackingHistory: orderTrackingEvent(status, audit, timestamp) }
      },
      { new: true, runValidators: true }
    );
    if (updated) return normalize(updated);
    const latest = await Order.findOne(filter).lean();
    if (!latest) return null;
    if (latest.status === status) return normalize(latest);
    throw workflowError("This order changed. Refresh it and try again.", 409);
  }
  const order = demo.orders.find(item => item._id === id && (!audit.userId || item.userId === audit.userId));
  if (!order) return null;
  if (audit.customerCancellation && !["Placed", "Cancelled"].includes(order.status)) {
    throw workflowError("Orders can only be cancelled before confirmation.", 409);
  }
  if (!validateOrderTransition(order, status)) return order;
  const timestamp = new Date();
  order.status = status;
  order.updatedAt = timestamp.toISOString();
  order.trackingHistory = [...(order.trackingHistory || []), orderTrackingEvent(status, audit, timestamp)];
  return order;
}

async function updatePaymentStatus(id, paymentStatus, audit = {}) {
  if (!["paid", "payment_rejected"].includes(paymentStatus)) throw orderError("Invalid payment action", 400);
  if (paymentStatus === "paid" && !audit.confirmedBy) throw orderError("Payment confirmer is required", 400);
  const timestamp = new Date();
  const update = { paymentStatus, updatedAt: timestamp };
  if (paymentStatus === "paid") {
    update.paymentConfirmedAt = timestamp;
    update.paymentConfirmedBy = String(audit.confirmedBy);
  } else {
    update.paymentRejectedAt = timestamp;
    update.paymentRejectedBy = String(audit.confirmedBy || "");
  }
  if (mongoConnected) {
    if (!mongoose.isValidObjectId(id)) return null;
    // Compare-and-set prevents two admins from approving/rejecting the same submission.
    const changed = await Order.findOneAndUpdate(
      { _id: id, paymentMethod: "UPI", paymentStatus: "payment_submitted" },
      {
        $set: update,
        $push: { trackingHistory: orderTrackingEvent(paymentStatus === "paid" ? "Payment verified" : "Payment rejected", { ...audit, note: paymentStatus === "paid" ? "UPI payment verified by the shop." : "UPI payment could not be verified." }, timestamp) }
      },
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
  Object.assign(order, update, { updatedAt: timestamp.toISOString() });
  order.trackingHistory = [...(order.trackingHistory || []), orderTrackingEvent(paymentStatus === "paid" ? "Payment verified" : "Payment rejected", { ...audit, note: paymentStatus === "paid" ? "UPI payment verified by the shop." : "UPI payment could not be verified." }, timestamp)];
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
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  resolveProductCategory,
  validatePublicCategoryFilter,
  resolvePublicCategoryFilters,
  unmappedProducts,
  listProductCategories,
  searchProductCatalog,
  getProduct,
  isProductCategoryVisible,
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