const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  nameBn: String,
  nameBanglish: { type: String, default: "" },
  aliases: { type: [String], default: [] },
  searchKeywords: { type: [String], default: [] },
  brand: { type: String, default: "" },
  tags: { type: [String], default: [] },
  category: { type: String, default: "Fresh Food" },
  price: { type: Number, default: 0 },
  mrp: { type: Number, default: 0 },
  discount: { type: Number, default: 0 },
  unit: { type: String, default: "1 piece" },
  stock: { type: Number, default: 0 },
  rating: { type: Number, default: 4.5 },
  reviews: { type: Number, default: 0 },
  badge: { type: String, default: "Popular" },
  image: { type: String, default: "" },
  imagePublicId: { type: String, default: "" },
  imageFormat: { type: String, default: "" },
  description: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.Product || mongoose.model("Product", productSchema);
