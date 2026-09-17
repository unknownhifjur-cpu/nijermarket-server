const store = require("./store");

const fail = (message, statusCode = 400) => {
  throw Object.assign(new Error(message), { statusCode });
};

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) fail("Cart is empty");
  if (items.length > 100) fail("Too many cart items");
  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.productId !== "string" || !item.productId.trim()) fail("Invalid product");
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) fail("Invalid item quantity");
    const id = item.productId.trim();
    const combined = (quantities.get(id) || 0) + quantity;
    if (combined > 99) fail("Invalid item quantity");
    quantities.set(id, combined);
  }
  return [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }));
}

async function priceOrder(items) {
  const orderItems = [];
  for (const item of normalizeItems(items)) {
    let product;
    try { product = await store.getProduct(item.productId); }
    catch (error) { if (error.name === "CastError") fail("Invalid product"); throw error; }
    if (!product) fail("One or more products are no longer available");
    if (Number(product.stock) < item.quantity) fail(`${product.name} does not have enough stock`, 409);
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) fail("Product pricing is unavailable", 409);
    orderItems.push({
      productId: String(product._id),
      name: product.nameBn || product.name,
      image: product.image,
      price: Math.round(price * 100) / 100,
      quantity: item.quantity
    });
  }
  const subtotalPaise = orderItems.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0);
  const delivery = subtotalPaise >= 49900 ? 0 : 60;
  return { items: orderItems, subtotal: subtotalPaise / 100, delivery, total: (subtotalPaise + delivery * 100) / 100 };
}

module.exports = { normalizeItems, priceOrder };