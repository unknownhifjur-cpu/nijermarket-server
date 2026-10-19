const assert = require("node:assert/strict");
const app = require("../app");
const { signUser } = require("../auth");

const admin = signUser({ _id: "category-smoke-admin", role: "admin" });
const server = app.listen(0, "127.0.0.1", async () => {
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const createdIds = [];

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

  try {
    const initialCategories = await request("/products/categories");
    assert.equal(initialCategories.status, 200);
    assert.ok(initialCategories.data.categories.includes("Fresh Food"));
    assert.ok(!initialCategories.data.categories.some(category => ["Fashion", "Electronics", "Cosmetics", "Health & Medicine", "Home & Living", "Sports & Fitness", "Books & Stationery"].includes(category)));
    console.log("PASS: public category list reflects seeded products, not frontend-only categories");

    const created = await request("/admin/products", "POST", admin, {
      name: "Category Smoke Item",
      category: "  Pantry   Staples  ",
      price: 25,
      stock: 4
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    createdIds.push(created.data._id);
    assert.equal(created.data.category, "Pantry Staples");
    console.log("PASS: admin product creation trims and saves category");

    const updated = await request(`/admin/products/${created.data._id}`, "PUT", admin, {
      name: "Category Smoke Item",
      category: " PANTRY   staples ",
      price: 25,
      stock: 4
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.category, "PANTRY staples");

    const duplicate = await request("/admin/products", "POST", admin, {
      name: "Category Smoke Duplicate",
      category: "Pantry Staples",
      price: 30,
      stock: 3
    });
    assert.equal(duplicate.status, 201, JSON.stringify(duplicate.data));
    createdIds.push(duplicate.data._id);

    const categoriesAfterCreate = await request("/products/categories");
    assert.equal(categoriesAfterCreate.data.categories.filter(category => category.toLocaleLowerCase("en") === "pantry staples").length, 1);
    console.log("PASS: new category appears once after create/update despite spacing and case differences");

    const filtered = await request("/products?category=pantry%20STAPLES");
    assert.equal(filtered.status, 200);
    assert.equal(filtered.data.length, 2);
    assert.ok(filtered.data.every(product => product.category.toLocaleLowerCase("en") === "pantry staples"));
    console.log("PASS: category filtering matches normalized labels");

    const searched = await request("/products?search=Smoke%20Item&category=PANTRY%20STAPLES");
    assert.equal(searched.data.length, 2);
    assert.ok(searched.data.every(product => product.category.toLocaleLowerCase("en") === "pantry staples"));
    console.log("PASS: search and category filters combine correctly");

    const empty = await request("/products?category=Nonexistent%20Smoke%20Category");
    assert.deepEqual(empty.data, []);
    console.log("PASS: categories without matching products return an empty product list");

    const all = await request("/products?category=All");
    assert.equal(all.data.length, 4);
    console.log("PASS: All category returns every eligible product");
  } catch (error) {
    console.error("FAIL:", error);
    process.exitCode = 1;
  } finally {
    await Promise.all(createdIds.map(id => request(`/admin/products/${id}`, "DELETE", admin).catch(() => null)));
    server.close();
    server.closeAllConnections();
  }
});
