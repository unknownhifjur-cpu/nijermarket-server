const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  normalizedName: { type: String, required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
  description: { type: String, default: "", maxlength: 500 },
  image: { type: String, default: "" },
  displayOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  showOnHome: { type: Boolean, default: true }
}, { timestamps: true });

categorySchema.index({ parentId: 1, normalizedName: 1 }, { unique: true });
categorySchema.index({ parentId: 1, isActive: 1, displayOrder: 1 });

module.exports = mongoose.models.Category || mongoose.model("Category", categorySchema);
