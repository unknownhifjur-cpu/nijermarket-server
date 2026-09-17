const { getSuggestions, rankProducts } = require("../utils/search");

async function searchProducts({ products, query, category = "" }) {
  const scoped = category && category !== "All"
    ? products.filter(product => product.category === category)
    : products;
  return {
    products: rankProducts(scoped, query),
    suggestions: getSuggestions(scoped, query)
  };
}

module.exports = { searchProducts };
