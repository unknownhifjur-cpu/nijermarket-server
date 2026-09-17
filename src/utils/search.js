const synonymGroups = [
  ["potato", "alu", "aloo", "আলু"],
  ["tomato", "tamato", "tameto", "tometo", "টমেটো"],
  ["rice", "chal", "চাল"],
  ["onion", "peyaj", "piyaj", "পেঁয়াজ", "পেয়াজ"],
  ["milk", "dudh", "দুধ"],
  ["shampoo", "shampu", "শ্যাম্পু"]
];

const synonymLookup = new Map(synonymGroups.flatMap(group => group.map(value => [normalizeSearchQuery(value), group])));

function normalizeSearchQuery(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("bn-IN")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ঁংঃ]/g, "ং")
    .replace(/[.,/#!$%^&*;:{}=_[\]~()?"'`+|<>@-]/g, " ")
    .replace(/(.)\1{2,}/gu, "$1$1")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeSearchQuery(value).split(/\s+/).filter(Boolean);
}

function expandQuery(query) {
  return tokenize(query).flatMap(token => [token, ...(synonymLookup.get(token) || [])].map(normalizeSearchQuery));
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + 1);
      diagonal = saved;
    }
  }
  return previous[right.length];
}

function searchableFields(product) {
  return [
    ["name", product.name, 100],
    ["nameBn", product.nameBn, 96],
    ["nameBanglish", product.nameBanglish, 94],
    ["aliases", product.aliases, 92],
    ["searchKeywords", product.searchKeywords, 88],
    ["brand", product.brand, 76],
    ["category", product.category, 64],
    ["tags", product.tags, 60]
  ].flatMap(([field, value, weight]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.filter(Boolean).flatMap(item => tokenize(item).map(token => ({ field, token, weight })));
  });
}

function scoreProduct(product, query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return 0;
  const fields = searchableFields(product);
  const expandedTokens = expandQuery(query);
  let score = 0;

  queryTokens.forEach(queryToken => {
    const equivalents = new Set([queryToken, ...(synonymLookup.get(queryToken) || [])].map(normalizeSearchQuery));
    let best = 0;
    fields.forEach(({ token, weight }) => {
      if (equivalents.has(token)) best = Math.max(best, weight + 45);
      else if (token.startsWith(queryToken) || [...equivalents].some(value => token.startsWith(value))) best = Math.max(best, weight + 25);
      else if (token.includes(queryToken) || equivalents.has(token)) best = Math.max(best, weight + 10);
      else if (queryToken.length >= 4 && token.length >= 4) {
        const distance = levenshtein(queryToken, token);
        const limit = queryToken.length >= 7 ? 2 : 1;
        if (distance <= limit) best = Math.max(best, weight - 12 * distance);
      }
    });
    score += best;
  });

  if (expandedTokens.some(token => normalizeSearchQuery(product.name).includes(token))) score += 20;
  return score >= queryTokens.length * 35 ? score : 0;
}

function rankProducts(products, query) {
  return products
    .map(product => ({ product, score: scoreProduct(product, query) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || String(left.product.name).localeCompare(String(right.product.name)))
    .map(item => item.product);
}

function getSuggestions(products, query, limit = 6) {
  return rankProducts(products, query).slice(0, limit).map(product => ({
    id: product._id,
    name: product.name,
    nameBn: product.nameBn || "",
    category: product.category || "",
    image: product.image || ""
  }));
}

module.exports = { normalizeSearchQuery, rankProducts, getSuggestions, scoreProduct };
