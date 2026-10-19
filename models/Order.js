const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  image: String,
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 }
}, { _id: false });

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

const orderSchema = new mongoose.Schema({
  userId: String,
  customerName: String,
  customerEmail: String,
  items: [orderItemSchema],
  address: String,
  phone: String,
  deliveryAddress: deliveryAddressSchema,
  paymentMethod: { type: String, enum: ["COD", "UPI"], default: "COD" },
  paymentStatus: { type: String, enum: ["unpaid", "payment_submitted", "paid", "payment_rejected"], default: "unpaid" },
  utr: { type: String, trim: true, maxlength: 80, default: "" },
  idempotencyKey: String,
  requestHash: String,
  paymentSubmittedAt: Date,
  paymentConfirmedAt: Date,
  paymentConfirmedBy: String,
  subtotal: { type: Number, default: 0 },
  delivery: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  status: { type: String, default: "Placed" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Legacy orders without a key remain valid; retries are unique per customer.
orderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.models.Order || mongoose.model("Order", orderSchema);
