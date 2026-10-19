const assert = require("node:assert/strict");
process.env.UPI_ID = "workflow-test@upi";
const app = require("../app");
const { signUser } = require("../auth");

const customer = signUser({ _id: "workflow-customer", role: "customer", name: "Workflow Customer" });
const otherCustomer = signUser({ _id: "workflow-other", role: "customer", name: "Other Customer" });
const admin = signUser({ _id: "workflow-admin", role: "admin", name: "Workflow Admin" });

const server = app.listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, method, token, body) {
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }
  async function createOrder(paymentMethod, requestId) {
    return request("/orders", "POST", customer, {
      items: [{ productId: "demo-product-1", quantity: 1 }],
      address: "Workflow test address",
      phone: "9000000000",
      paymentMethod,
      clientRequestId: requestId,
      expectedTotal: 90
    });
  }

  try {
    const created = await createOrder("UPI", "workflow-checkout-request-001");
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const orderId = created.data._id;
    assert.match(created.data.orderNumber, /^NM-[A-F0-9]{32}$/);
    assert.deepEqual(created.data.trackingHistory.map(event => event.status), ["Placed", "Payment submitted"]);
    console.log("PASS: checkout returns unique order number and initial tracking/payment events");

    assert.equal((await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Picking" })).status, 409);
    assert.equal((await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Confirmed" })).status, 409);
    assert.equal((await request(`/admin/orders/${orderId}`, "PATCH", customer, { status: "Confirmed" })).status, 403);
    assert.equal((await request(`/orders/${orderId}/cancel`, "PATCH", otherCustomer)).status, 404);
    console.log("PASS: payment gate, admin-only updates, and order ownership are enforced");

    const paid = await request(`/admin/orders/${orderId}/payment/confirm`, "PATCH", admin);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assert.equal(paid.data.paymentStatus, "paid");
    assert.equal(paid.data.trackingHistory.filter(event => event.status === "Payment verified").length, 1);
    await request(`/admin/orders/${orderId}/payment/confirm`, "PATCH", admin);
    const paidAgain = await request(`/orders/my`, "GET", customer);
    assert.equal(paidAgain.data[0].trackingHistory.filter(event => event.status === "Payment verified").length, 1);
    assert.equal((await request(`/orders/${orderId}/cancel`, "PATCH", customer)).status, 409);
    console.log("PASS: admin verification is audited once and repeat verification adds no duplicate event");

    const stages = ["Confirmed", "Picking", "Sorting", "Packing", "Packed", "Out for Delivery", "Delivered"];
    let latest;
    const confirmed = await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Confirmed" });
    assert.equal(confirmed.status, 200);
    const sameStatus = await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Confirmed" });
    assert.equal(sameStatus.data.trackingHistory.filter(event => event.status === "Confirmed").length, 1);
    for (const status of stages) {
      if (status === "Confirmed") continue;
      latest = await request(`/admin/orders/${orderId}`, "PATCH", admin, { status });
      assert.equal(latest.status, 200, `${status}: ${JSON.stringify(latest.data)}`);
      assert.equal(latest.data.status, status);
    }
    assert.equal(latest.data.trackingHistory.filter(event => stages.includes(event.status)).length, stages.length);
    assert.equal(latest.data.trackingHistory.find(event => event.status === "Picking").actorRole, "admin");
    assert.equal((await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Picking" })).status, 409);
    assert.equal((await request(`/admin/orders/${orderId}`, "PATCH", admin, { status: "Cancelled" })).status, 409);
    console.log("PASS: lifecycle events are timestamped/audited and delivered orders cannot move backwards");

    const cod = await createOrder("COD", "workflow-checkout-request-002");
    assert.equal(cod.status, 201, JSON.stringify(cod.data));
    const confirmedCod = await request(`/admin/orders/${cod.data._id}`, "PATCH", admin, { status: "Confirmed" });
    assert.equal(confirmedCod.status, 200);
    assert.equal(confirmedCod.data.paymentStatus, "unpaid");
    assert.equal((await request(`/orders/${cod.data._id}/cancel`, "PATCH", customer)).status, 409);
    console.log("PASS: COD orders can enter fulfillment while payment remains due on delivery");

    const cancelled = await createOrder("COD", "workflow-checkout-request-003");
    assert.equal(cancelled.status, 201);
    const customerCancelled = await request(`/orders/${cancelled.data._id}/cancel`, "PATCH", customer);
    assert.equal(customerCancelled.status, 200, JSON.stringify(customerCancelled.data));
    assert.equal(customerCancelled.data.status, "Cancelled");
    const repeatedCancellation = await request(`/orders/${cancelled.data._id}/cancel`, "PATCH", customer);
    assert.equal(repeatedCancellation.data.trackingHistory.filter(event => event.status === "Cancelled").length, 1);
    console.log("PASS: customers can cancel only their own unconfirmed order, without duplicate events");

    const failedDeliveryOrder = await createOrder("COD", "workflow-checkout-request-004");
    let failedDelivery;
    for (const status of ["Confirmed", "Picking", "Sorting", "Packing", "Packed", "Out for Delivery", "Failed Delivery"]) {
      failedDelivery = await request(`/admin/orders/${failedDeliveryOrder.data._id}`, "PATCH", admin, { status });
      assert.equal(failedDelivery.status, 200, `${status}: ${JSON.stringify(failedDelivery.data)}`);
    }
    assert.ok(failedDelivery.data.trackingHistory.find(event => event.status === "Failed Delivery")?.timestamp);
    assert.equal((await request(`/admin/orders/${failedDeliveryOrder.data._id}`, "PATCH", admin, { status: "Out for Delivery" })).status, 409);
    console.log("PASS: failed delivery is recorded and cannot silently return to an earlier stage");
  } catch (error) {
    console.error("FAIL:", error);
    process.exitCode = 1;
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

server.on("error", error => {
  console.error("FAIL: server startup", error);
  process.exitCode = 1;
});
