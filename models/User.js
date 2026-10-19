const mongoose = require("mongoose");

const deliveryAddressSchema = new mongoose.Schema({
  fullName: { type: String, trim: true, maxlength: 80 },
  phone: { type: String, trim: true, maxlength: 10 },
  locality: { type: String, trim: true, maxlength: 120 },
  village: { type: String, trim: true, maxlength: 100 },
  villageCustom: { type: Boolean, default: false },
  postOffice: { type: String, trim: true, maxlength: 100 },
  postOfficeCustom: { type: Boolean, default: false },
  district: { type: String, default: "Malda" },
  pinCode: { type: String, default: "732210" },
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, sparse: true, lowercase: true },
  phone: { type: String, unique: true, sparse: true },
  deliveryAddress: { type: deliveryAddressSchema, default: undefined },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["customer", "admin"], default: "customer" },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
