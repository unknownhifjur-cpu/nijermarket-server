const assert = require("node:assert/strict");
process.env.UPI_ID = "smoke-test@upi";
const app = require("../app");
const { signUser } = require("../auth");

const customer = signUser({ _id: "smoke-customer", role: "customer", name: "Smoke Test" });
const admin = signUser({ _id: "smoke-admin", role: "admin" });

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
  try {
    const body = {
      items: [{ productId: "demo-product-1", quantity: 2 }],
      address: "Smoke test address",
      phone: "9000000000",
      paymentMethod: "UPI",
      clientRequestId: "smoke-checkout-request-001",
      expectedTotal: 120
    };
    const created = await request("/orders", "POST", customer, { ...body, paymentStatus: "paid" });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.paymentMethod, "UPI");
    assert.equal(created.data.paymentStatus, "payment_submitted");
    console.log("PASS: UPI order created as payment_submitted; client-sent paymentStatus ignored");

    const quote = await request("/orders/quote", "POST", null, { items: body.items });
    assert.equal(quote.status, 200);
    assert.equal(quote.data.total, 120);
    console.log("PASS: quote endpoint returns server-calculated total");

    const retried = await request("/orders", "POST", customer, body);
    assert.equal(retried.status, 200, JSON.stringify(retried.data));
    assert.equal(retried.data._id, created.data._id);
    console.log("PASS: same idempotency key returns the same order");

    const stale = await request("/orders", "POST", customer, { ...body, expectedTotal: 999, clientRequestId: "smoke-checkout-request-stale" });
    assert.equal(stale.status, 409);
    console.log("PASS: stale expectedTotal is rejected for a new order");

    assert.equal((await request(`/admin/orders/${created.data._id}/payment/confirm`, "PATCH", customer)).status, 403);
    assert.equal((await request(`/admin/orders/${created.data._id}/payment/confirm`, "PATCH", null)).status, 401);
    console.log("PASS: customer and anonymous callers cannot confirm payments");

    const confirmed = await request(`/admin/orders/${created.data._id}/payment/confirm`, "PATCH", admin);
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.paymentStatus, "paid");
    assert.equal(confirmed.data.status, "Placed");
    assert.ok(confirmed.data.paymentConfirmedAt);
    assert.ok(confirmed.data.paymentConfirmedBy);
    console.log("PASS: admin confirmation sets paid with audit fields; order status untouched");

    assert.equal((await request(`/admin/orders/${created.data._id}/payment/reject`, "PATCH", admin)).status, 409);
    const again = await request(`/admin/orders/${created.data._id}/payment/confirm`, "PATCH", admin);
    assert.equal(again.status, 200);
    assert.equal(again.data.paymentStatus, "paid");
    console.log("PASS: paid order cannot be rejected; repeat confirm stays idempotent");

    const cod = await request("/orders", "POST", customer, { ...body, paymentMethod: "COD", utr: "", clientRequestId: "smoke-checkout-request-002" });
    assert.equal(cod.status, 201, JSON.stringify(cod.data));
    assert.equal(cod.data.paymentStatus, "unpaid");
    assert.equal((await request(`/admin/orders/${cod.data._id}/payment/confirm`, "PATCH", admin)).status, 409);
    console.log("PASS: COD stays unpaid and is outside the UPI approval flow");

    const upi2 = await request("/orders", "POST", customer, { ...body, clientRequestId: "smoke-checkout-request-003" });
    assert.equal(upi2.status, 201);
    const rejected = await request(`/admin/orders/${upi2.data._id}/payment/reject`, "PATCH", admin);
    assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
    assert.equal(rejected.data.paymentStatus, "payment_rejected");
    assert.equal(rejected.data.status, "Placed");
    assert.equal((await request(`/admin/orders/${upi2.data._id}/payment/reject`, "PATCH", admin)).status, 200);
    assert.equal((await request(`/admin/orders/${upi2.data._id}/payment/confirm`, "PATCH", admin)).status, 409);
    console.log("PASS: admin rejection sets payment_rejected without deleting the order");

    const mine = await request("/orders/my", "GET", customer);
    assert.equal(mine.data.length, 3);
    console.log("PASS: My Orders re-fetch reflects all payment states");
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