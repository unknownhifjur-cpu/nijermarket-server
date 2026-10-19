const ORDER_STATUSES = [
  "Placed",
  "Confirmed",
  "Picking",
  "Sorting",
  "Packing",
  "Packed",
  "Out for Delivery",
  "Delivered",
  "Failed Delivery",
  "Cancelled"
];

const transitions = {
  Placed: ["Confirmed", "Cancelled"],
  Confirmed: ["Picking", "Cancelled"],
  Picking: ["Sorting", "Cancelled"],
  Sorting: ["Packing", "Cancelled"],
  Packing: ["Packed", "Cancelled"],
  Packed: ["Out for Delivery", "Cancelled"],
  "Out for Delivery": ["Delivered", "Failed Delivery"],
  Delivered: [],
  "Failed Delivery": [],
  Cancelled: []
};

const statusNotes = {
  Confirmed: "Your order is confirmed.",
  Picking: "We are picking your items.",
  Sorting: "Your items have been checked and sorted.",
  Packing: "We are packing your order.",
  Packed: "Your order is packed and ready for delivery.",
  "Out for Delivery": "Your order is out for delivery.",
  Delivered: "Your order has been delivered.",
  "Failed Delivery": "We could not complete delivery.",
  Cancelled: "Your order has been cancelled."
};

function workflowError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

function validateOrderTransition(order, nextStatus) {
  if (!ORDER_STATUSES.includes(nextStatus)) {
    throw workflowError("Invalid order status", 400);
  }
  if (order.status === nextStatus) return false;
  if (!transitions[order.status]?.includes(nextStatus)) {
    throw workflowError(`Order cannot move from ${order.status} to ${nextStatus}.`, 409);
  }
  if (nextStatus === "Confirmed" && order.paymentMethod === "UPI" && order.paymentStatus !== "paid") {
    throw workflowError("Verify the UPI payment before confirming this order.", 409);
  }
  if (nextStatus === "Cancelled" && order.paymentMethod === "UPI" && order.paymentStatus === "paid") {
    throw workflowError("Contact the shop to request a refund before cancelling a paid UPI order.", 409);
  }
  return true;
}

module.exports = { ORDER_STATUSES, statusNotes, validateOrderTransition, workflowError };
