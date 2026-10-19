const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const dns = require("dns");
const mongoose = require("mongoose");
const Category = require("../models/Category");
const Product = require("../models/Product");
const { categoryKey, normalizeCategory } = require("../src/utils/categories");

const KNOWN_VEGETABLE_CATEGORIES = new Set([
  "beans & peas",
  "bulbs",
  "bulbs & aromatics",
  "chilies",
  "flower vegetables",
  "fruiting vegetables",
  "gourds & squash",
  "leafy greens",
  "leafy vegetables",
  "other vegetables",
  "pods & stems",
  "root vegetables",
  "roots & aromatics",
  "salad vegetables"
]);

async function findOrCreateCategory({ name, parentId, displayOrder = 0 }) {
  const normalizedName = categoryKey(name);
  let category = await Category.findOne({ parentId: parentId || null, normalizedName });
  if (category) return category;
  try {
    category = await Category.create({
      name,
      normalizedName,
      parentId: parentId || null,
      displayOrder,
      isActive: true,
      showOnHome: !parentId
    });
    return category;
  } catch (error) {
    if (error.code !== 11000) throw error;
    return Category.findOne({ parentId: parentId || null, normalizedName });
  }
}

async function migrate() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGO_URI is required to migrate product categories");

  const dnsServers = String(process.env.MONGO_DNS_SERVERS || "")
    .split(",")
    .map(server => server.trim())
    .filter(Boolean);
  if (dnsServers.length) dns.setServers(dnsServers);

  await mongoose.connect(mongoUri);
  await Category.syncIndexes();

  const products = await Product.find({
    $or: [
      { mainCategoryId: { $exists: false } },
      { mainCategoryId: null },
      { subcategoryId: { $exists: false } },
      { subcategoryId: null }
    ]
  }).sort({ category: 1, name: 1 });
  let root = null;
  const subcategories = new Map();
  const unmapped = [];
  let migrated = 0;

  for (const product of products) {
    const legacyCategory = normalizeCategory(product.category);
    const key = categoryKey(legacyCategory);
    if (product.mainCategoryId || product.subcategoryId || !KNOWN_VEGETABLE_CATEGORIES.has(key)) {
      unmapped.push({ id: String(product._id), name: product.name, category: product.category || "" });
      continue;
    }
    if (!root) root = await findOrCreateCategory({ name: "Vegetables", parentId: null });
    if (!subcategories.has(key)) {
      subcategories.set(key, await findOrCreateCategory({
        name: legacyCategory,
        parentId: root._id,
        displayOrder: subcategories.size
      }));
    }
    const subcategory = subcategories.get(key);
    await Product.updateOne(
      { _id: product._id, $or: [{ mainCategoryId: { $exists: false } }, { mainCategoryId: null }, { subcategoryId: { $exists: false } }, { subcategoryId: null }] },
      { $set: { mainCategoryId: root._id, subcategoryId: subcategory._id } }
    );
    migrated += 1;
  }

  console.log(`Category migration complete. Products linked: ${migrated}. Products needing manual mapping: ${unmapped.length}.`);
  if (unmapped.length) {
    console.log("Unmapped products (unchanged):");
    unmapped.forEach(product => console.log(`${product.id}\t${product.name}\t${product.category}`));
  }
  if (unmapped.length) process.exitCode = 2;
}

migrate()
  .catch(error => {
    console.error("Product category migration failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
