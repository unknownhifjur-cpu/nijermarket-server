const assert = require("node:assert/strict");
const app = require("../app");
const { signUser } = require("../auth");

const admin = signUser({ _id: "category-smoke-admin", role: "admin" });
const customer = signUser({ _id: "category-smoke-customer", role: "customer" });
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

  try {
    const initialTree = await request("/categories");
    assert.equal(initialTree.status, 200);
    assert.equal(initialTree.data.categories[0].name, "Fresh Food");
    console.log("PASS: public category tree is served from stored categories");

    assert.equal((await request("/admin/categories")).status, 401);
    assert.equal((await request("/admin/categories", "POST", customer, { name: "Unauthorized" })).status, 403);
    console.log("PASS: category management requires administrator authorization");

    const main = await request("/admin/categories", "POST", admin, { name: "  Pantry   Staples ", showOnHome: true });
    assert.equal(main.status, 201, JSON.stringify(main.data));
    assert.equal(main.data.name, "Pantry Staples");
    const duplicateMain = await request("/admin/categories", "POST", admin, { name: "pantry staples" });
    assert.equal(duplicateMain.status, 409);
    console.log("PASS: admin creates main categories and duplicate names are rejected after normalization");

    const otherMain = await request("/admin/categories", "POST", admin, { name: "Other Main" });
    assert.equal(otherMain.status, 201, JSON.stringify(otherMain.data));
    const emptyCategoryProducts = await request(`/products?mainCategoryId=${otherMain.data._id}`);
    assert.equal(emptyCategoryProducts.status, 200);
    assert.deepEqual(emptyCategoryProducts.data, []);
    const subcategory = await request("/admin/categories", "POST", admin, {
      name: "  Dried   Goods ",
      parentId: main.data._id,
      description: "Shelf-stable grocery products",
      displayOrder: 2
    });
    assert.equal(subcategory.status, 201, JSON.stringify(subcategory.data));
    assert.equal(subcategory.data.name, "Dried Goods");

    const siblingDuplicate = await request("/admin/categories", "POST", admin, {
      name: "dried goods",
      parentId: main.data._id
    });
    assert.equal(siblingDuplicate.status, 409);
    const invalidNested = await request("/admin/categories", "POST", admin, {
      name: "Invalid Nested",
      parentId: subcategory.data._id
    });
    assert.equal(invalidNested.status, 400);
    console.log("PASS: subcategories attach to one main category and nested levels are rejected");

    const noProductsHome = await request("/categories?view=home");
    assert.ok(!noProductsHome.data.categories.some(category => category._id === main.data._id));
    const invalidProduct = await request("/admin/products", "POST", admin, {
      name: "Invalid Category Product",
      mainCategoryId: otherMain.data._id,
      subcategoryId: subcategory.data._id
    });
    assert.equal(invalidProduct.status, 400);
    console.log("PASS: empty categories stay off Home and invalid product category relationships are rejected");

    const createdProduct = await request("/admin/products", "POST", admin, {
      name: "Dried Mango",
      category: "ignored client label",
      mainCategoryId: main.data._id,
      subcategoryId: subcategory.data._id,
      price: 85,
      mrp: 100,
      stock: 6,
      aliases: ["dried mango"],
      tags: ["pantry"]
    });
    assert.equal(createdProduct.status, 201, JSON.stringify(createdProduct.data));
    assert.equal(createdProduct.data.category, "Dried Goods");
    assert.equal(createdProduct.data.mainCategoryId, main.data._id);
    assert.equal(createdProduct.data.subcategoryId, subcategory.data._id);
    console.log("PASS: product creation stores validated category IDs and derives the legacy display label");

    const refreshedHome = await request("/categories?view=home");
    const homeMain = refreshedHome.data.categories.find(category => category._id === main.data._id);
    assert.ok(homeMain);
    assert.equal(homeMain.productCount, 1);
    const categoryTree = await request("/categories");
    const treeMain = categoryTree.data.categories.find(category => category._id === main.data._id);
    assert.equal(treeMain.subcategories[0].name, "Dried Goods");
    assert.equal(treeMain.subcategories[0].productCount, 1);
    console.log("PASS: newly assigned products make their main category visible on Home and Shop");

    const byMain = await request(`/products?mainCategoryId=${main.data._id}`);
    const bySubcategory = await request(`/products?mainCategoryId=${main.data._id}&subcategoryId=${subcategory.data._id}`);
    assert.equal(byMain.data.length, 1);
    assert.equal(bySubcategory.data[0]._id, createdProduct.data._id);
    const searched = await request(`/products/search?q=Dried%20Mango&mainCategoryId=${main.data._id}&subcategoryId=${subcategory.data._id}`);
    assert.equal(searched.data.data.products[0]._id, createdProduct.data._id);
    const otherSubcategory = await request(`/products?mainCategoryId=${otherMain.data._id}&subcategoryId=${subcategory.data._id}`);
    assert.equal(otherSubcategory.status, 400);
    console.log("PASS: main/subcategory filtering, combined search, and invalid public filters work");

    const updated = await request(`/admin/categories/${subcategory.data._id}`, "PUT", admin, {
      name: "Dried Fruit",
      description: "Updated description",
      displayOrder: 3
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.name, "Dried Fruit");
    assert.equal(updated.data.description, "Updated description");
    const invalidUpdate = await request(`/admin/products/${createdProduct.data._id}`, "PUT", admin, {
      mainCategoryId: otherMain.data._id,
      subcategoryId: subcategory.data._id
    });
    assert.equal(invalidUpdate.status, 400);
    console.log("PASS: category edits persist and product updates revalidate parent-child relationships");

    const inactive = await request(`/admin/categories/${main.data._id}`, "PUT", admin, { isActive: false });
    assert.equal(inactive.status, 200);
    assert.ok(!(await request("/categories")).data.categories.some(category => category._id === main.data._id));
    assert.equal((await request(`/products?mainCategoryId=${main.data._id}`)).status, 400);
    assert.ok(!(await request("/products")).data.some(product => product._id === createdProduct.data._id));
    assert.equal((await request(`/products/${createdProduct.data._id}`)).status, 404);
    assert.ok(!(await request("/products/categories")).data.categories.includes("Dried Fruit"));
    await request(`/admin/categories/${main.data._id}`, "PUT", admin, { isActive: true });
    assert.ok((await request("/products/categories")).data.categories.includes("Dried Fruit"));
    const categoryPage = await request(`/products?mainCategoryId=${main.data._id}&subcategoryId=${subcategory.data._id}&search=Dried&page=1&limit=1`);
    assert.equal(categoryPage.data.total, 1);
    assert.equal(categoryPage.data.products[0]._id, createdProduct.data._id);
    console.log("PASS: inactive products are hidden and active category filters combine with search and pagination");

    assert.equal((await request(`/admin/categories/${main.data._id}`, "DELETE", admin)).status, 409);
    assert.equal((await request(`/admin/categories/${subcategory.data._id}`, "DELETE", admin)).status, 409);
    await request(`/admin/products/${createdProduct.data._id}`, "DELETE", admin);
    assert.equal((await request(`/admin/categories/${subcategory.data._id}`, "DELETE", admin)).status, 200);
    assert.equal((await request(`/admin/categories/${main.data._id}`, "DELETE", admin)).status, 200);
    assert.equal((await request(`/admin/categories/${otherMain.data._id}`, "DELETE", admin)).status, 200);
    console.log("PASS: categories with assigned products or children cannot be deleted");

    const allProducts = await request("/products");
    assert.equal(allProducts.data.length, 2);
    const firstPage = await request("/products?page=1&limit=1");
    const secondPage = await request("/products?page=2&limit=1");
    assert.equal(firstPage.data.total, 2);
    assert.equal(firstPage.data.products.length, 1);
    assert.equal(secondPage.data.products.length, 1);
    assert.equal((await request("/products?page=0&limit=1")).status, 400);
    console.log("PASS: opt-in server pagination reports totals while legacy array responses remain compatible");
    const firstShuffle = await request("/products?page=1&limit=2&shuffleSeed=order-a");
    const repeatedShuffle = await request("/products?page=1&limit=2&shuffleSeed=order-a");
    const refreshedShuffle = await request("/products?page=1&limit=2&shuffleSeed=order-c");
    assert.deepEqual(firstShuffle.data.products.map(product => product._id), repeatedShuffle.data.products.map(product => product._id));
    assert.notDeepEqual(firstShuffle.data.products.map(product => product._id), refreshedShuffle.data.products.map(product => product._id));
    console.log("PASS: seeded product order remains stable across pages and changes with a new refresh seed");
    console.log("PASS: removing the test category leaves existing products intact");
  } catch (error) {
    console.error("FAIL:", error);
    process.exitCode = 1;
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
