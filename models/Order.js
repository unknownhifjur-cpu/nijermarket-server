const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  image: String,
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, default: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  userId: String,
  customerName: String,
  customerEmail: String,
  items: [orderItemSchema],
  address: String,
  phone: String,
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
