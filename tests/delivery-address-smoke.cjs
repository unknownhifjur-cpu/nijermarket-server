const assert = require("node:assert/strict");
const app = require("../app");

const server = app.listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function request(path, method = "GET", token, body) {
    const response = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json() };
  }

  async function register(name, email) {
    const result = await request("/auth/register", "POST", null, { name, email, password: "test-password" });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  }

  try {
    const first = await register("First Customer", "first-address-test@example.com");
    const second = await register("Second Customer", "second-address-test@example.com");

    assert.equal((await request("/account/delivery-address")).status, 401);
    const missing = await request("/account/delivery-address", "GET", first.token);
    assert.equal(missing.status, 200);
    assert.equal(missing.data.address, null);
    console.log("PASS: address retrieval requires authentication and returns no address for a new customer");

    const address = {
      fullName: "First Recipient",
      phone: "9876543210",
      locality: "North Para",
      village: "Manual Village",
      villageCustom: true,
      postOffice: "Manual Post Office",
      postOfficeCustom: true,
      district: "Customer-supplied district",
      pinCode: "000000"
    };
    const saved = await request("/account/delivery-address", "PUT", first.token, { address });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.address.village, "Manual Village");
    assert.equal(saved.data.address.postOffice, "Manual Post Office");
    assert.equal(saved.data.address.district, "Malda");
    assert.equal(saved.data.address.pinCode, "732210");
    assert.equal(Object.hasOwn(saved.data.address, "latitude"), false);
    console.log("PASS: listed/manual address values persist and fixed district/PIN are enforced by the server");

    const loaded = await request("/account/delivery-address", "GET", first.token);
    assert.deepEqual(loaded.data.address, saved.data.address);
    const authProfile = await request("/auth/me", "GET", first.token);
    assert.equal(Object.hasOwn(authProfile.data.user, "deliveryAddress"), false);
    const login = await request("/auth/login", "POST", null, {
      identifier: "first-address-test@example.com",
      password: "test-password"
    });
    assert.equal(login.status, 200);
    assert.equal(Object.hasOwn(login.data.user, "deliveryAddress"), false);
    console.log("PASS: login and account profile responses do not copy saved addresses into browser-persisted user data");
    const updated = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, village: "Updated Village", villageCustom: true }
    });
    assert.equal(updated.data.address.village, "Updated Village");
    console.log("PASS: the same customer can reload and update the saved address");

    const savedWithLocation = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, village: "Updated Village", villageCustom: true, latitude: 12.345678, longitude: -98.765432 }
    });
    assert.equal(savedWithLocation.status, 200);
    assert.equal(savedWithLocation.data.address.latitude, 12.345678);
    assert.equal(savedWithLocation.data.address.longitude, -98.765432);
    const reloadedWithLocation = await request("/account/delivery-address", "GET", first.token);
    assert.equal(reloadedWithLocation.data.address.latitude, 12.345678);
    assert.equal(reloadedWithLocation.data.address.longitude, -98.765432);
    console.log("PASS: confirmed coordinates persist on a saved address and load for that account");

    const otherCustomer = await request("/account/delivery-address", "GET", second.token);
    assert.equal(otherCustomer.data.address, null);
    const secondAddress = await request("/account/delivery-address", "PUT", second.token, {
      customerId: first.user._id,
      address: { ...address, fullName: "Second Recipient", village: "Second Village" }
    });
    assert.equal(secondAddress.status, 200);
    assert.equal(secondAddress.data.address.fullName, "Second Recipient");
    const firstAfterOtherSave = await request("/account/delivery-address", "GET", first.token);
    assert.equal(firstAfterOtherSave.data.address.village, "Updated Village");
    console.log("PASS: a forged customerId cannot redirect an address update to another account");

    const invalid = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, phone: "12345" }
    });
    assert.equal(invalid.status, 400);
    const invalidLatitude = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, latitude: 91, longitude: 0 }
    });
    assert.equal(invalidLatitude.status, 400);
    const incompleteCoordinates = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, latitude: 20 }
    });
    assert.equal(incompleteCoordinates.status, 400);
    const stringCoordinates = await request("/account/delivery-address", "PUT", first.token, {
      address: { ...address, latitude: "20", longitude: "30" }
    });
    assert.equal(stringCoordinates.status, 400);
    console.log("PASS: the backend rejects invalid phones, out-of-range coordinates, partial coordinates, and non-numeric coordinate values");

    const orderAddress = {
      ...address,
      fullName: "Order Recipient",
      locality: "South Para",
      village: "Order-time Village",
      postOffice: "Order-time Post Office",
      latitude: 25.123456,
      longitude: 88.654321
    };
    const orderBody = {
      items: [{ productId: "demo-product-1", quantity: 2 }],
      deliveryAddress: orderAddress,
      paymentMethod: "COD",
      clientRequestId: "delivery-address-order-0001",
      expectedTotal: 120
    };
    const order = await request("/orders", "POST", first.token, orderBody);
    assert.equal(order.status, 201, JSON.stringify(order.data));
    assert.equal(order.data.deliveryAddress.village, "Order-time Village");
    assert.equal(order.data.deliveryAddress.postOffice, "Order-time Post Office");
    assert.equal(order.data.deliveryAddress.district, "Malda");
    assert.equal(order.data.deliveryAddress.pinCode, "732210");
    assert.equal(order.data.deliveryAddress.latitude, 25.123456);
    assert.equal(order.data.deliveryAddress.longitude, 88.654321);
    assert.equal(order.data.phone, "9876543210");
    assert.match(order.data.address, /Order-time Village/);
    const retry = await request("/orders", "POST", first.token, orderBody);
    assert.equal(retry.status, 200);
    assert.equal(retry.data._id, order.data._id);
    assert.equal(retry.data.deliveryAddress.latitude, 25.123456);

    const manualOrderBody = {
      ...orderBody,
      clientRequestId: "delivery-address-manual-order-0001",
      deliveryAddress: { ...orderAddress, latitude: undefined, longitude: undefined }
    };
    const manualOrder = await request("/orders", "POST", first.token, manualOrderBody);
    assert.equal(manualOrder.status, 201, JSON.stringify(manualOrder.data));
    assert.equal(Object.hasOwn(manualOrder.data.deliveryAddress, "latitude"), false);
    assert.equal(Object.hasOwn(manualOrder.data.deliveryAddress, "longitude"), false);
    console.log("PASS: orders preserve confirmed coordinates and manual checkout continues without GPS coordinates");
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
