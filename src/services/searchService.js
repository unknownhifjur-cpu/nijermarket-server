const { getSuggestions, rankProducts } = require("../utils/search");
const { categoryKey } = require("../utils/categories");

async function searchProducts({ products, query, category = "" }) {
  const selectedCategory = categoryKey(category);
  const scoped = selectedCategory && selectedCategory !== "all"
    ? products.filter(product => categoryKey(product.category) === selectedCategory)
    : products;
  return {
    products: rankProducts(scoped, query),
    suggestions: getSuggestions(scoped, query)
  };
}

module.exports = { searchProducts };
