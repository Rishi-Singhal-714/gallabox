function normalizeToken(t) {
  if (!t) return '';
  return String(t)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularize(word) {
  if (!word) return '';
  if (word.endsWith('ies') && word.length > 3) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
  return word;
}

function editDistance(a, b) {
  const s = a || '', t = b || '';
  const m = s.length, n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function calculateSimilarity(str1, str2) {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  if (longer.length === 0) return 1.0;
  if (longer.includes(shorter)) return 0.95;
  const commonChars = [...shorter].filter(char => longer.includes(char)).length;
  return commonChars / longer.length;
}

function smartSimilarity(a, b) {
  const A = singularize(normalizeToken(a));
  const B = singularize(normalizeToken(b));
  if (!A || !B) return 0;
  if (A === B) return 1.0;
  if (A.includes(B) || B.includes(A)) return 0.95;
  const ed = editDistance(A, B);
  const maxLen = Math.max(A.length, B.length);
  const edScore = 1 - (ed / Math.max(1, maxLen));
  const charOverlap = calculateSimilarity(A, B);
  return Math.max(edScore, charOverlap);
}

function expandCategoryVariants(category) {
  const norm = normalizeToken(category);
  const variants = new Set();
  if (norm) variants.add(norm);
  const ampParts = norm.split(/\band\b/).map(s => normalizeToken(s));
  for (const p of ampParts) {
    if (p && p.length > 1) variants.add(p.trim());
  }
  return Array.from(variants);
}

const STOPWORDS = new Set(['and','the','for','a','an','of','in','on','to','with','from','shop','buy','category','categories']);

function containsClothingKeywords(userMessage) {
  const clothingTerms = ['men', 'women', 'kids', 'kid', 'child', 'children', 'man', 'woman', 'boy', 'girl'];
  const message = (userMessage || '').toLowerCase();
  return clothingTerms.some(term => message.includes(term));
}

function inferGenderFromCategories(matchedCategories = []) {
  if (!Array.isArray(matchedCategories) || matchedCategories.length === 0) return null;
  const genderScores = { men: 0, women: 0, kids: 0 };
  for (const cat of matchedCategories) {
    const fields = [];
    if (cat.cat_id) fields.push(String(cat.cat_id).toLowerCase());
    if (cat.cat1) fields.push(String(cat.cat1).toLowerCase());
    const combined = fields.join(' ');
    if (/\bmen\b|\bman\b|\bmens\b/.test(combined)) genderScores.men += 1;
    if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(combined)) genderScores.women += 1;
    if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(combined)) genderScores.kids += 1;
  }
  const max = Math.max(genderScores.men, genderScores.women, genderScores.kids);
  if (max === 0) return null;
  const winners = Object.keys(genderScores).filter(k => genderScores[k] === max);
  if (winners.length === 1) return winners[0];
  return null;
}

function stripClothingFromType2(type2) {
  if (!type2) return type2;
  const CLOTHING_IGNORE_WORDS = ['men','women','kid','kids','child','children','man','woman','boys','girls','mens','womens'];
  let tokens = type2.split(/\s+/);
  while (tokens.length && CLOTHING_IGNORE_WORDS.includes(tokens[0].toLowerCase().replace(/[^a-z]/g, ''))) {
    tokens.shift();
  }
  return tokens.join(' ').trim();
}

function findKeywordMatchesInCat1(userMessage, galleriesData) {
  if (!userMessage || !galleriesData.length) return [];
  
  const rawTerms = userMessage
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/\s+/)
    .filter(term => term.length > 1 && !STOPWORDS.has(term));

  const searchTerms = rawTerms
    .map(t => singularize(normalizeToken(t)))
    .filter(t => t.length > 1);

  const matches = [];
  const clothingKeywords = ['clothing', 'apparel', 'wear', 'shirt', 'pant', 'dress', 'top', 'bottom', 'jacket', 'sweater'];
  
  galleriesData.forEach(item => {
    if (!item.cat1) return;
    const cat1Categories = item.cat1.split(',').map(cat => cat.trim()).filter(Boolean);
    const expanded = [];
    for (const category of cat1Categories) {
      const variants = expandCategoryVariants(category);
      expanded.push(...variants);
    }

    for (const searchTerm of searchTerms) {
      for (const variant of expanded) {
        const isClothing = clothingKeywords.some(clothing => variant.includes(clothing));
        if (isClothing) continue;
        const sim = smartSimilarity(variant, searchTerm);
        if (sim >= 0.9 || (sim >= 0.82 && Math.abs(variant.length - searchTerm.length) <= 3)) {
          if (!matches.some(m => m.type2 === item.type2)) {
            matches.push({
              ...item,
              matchType: sim === 1.0 ? 'exact' : 'similar',
              matchedTerm: searchTerm,
              score: sim
            });
          }
        }
      }
    }
  });
  
  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
}

function urlEncodeType2(t) {
  if (!t) return '';
  return encodeURIComponent(t.trim().replace(/\s+/g, ' ')).replace(/%20/g, '%20');
}

function buildConciseResponse(userMessage, galleryMatches = [], sellersObj = {}) {
  const galleries = (galleryMatches && galleryMatches.length) ? galleryMatches.slice(0,5) : [];
  const sellersList = [];
  const addSeller = (s) => {
    if (!s) return;
    const id = s.user_id || s.seller_id || '';
    if (!id) return;
    if (!sellersList.some(x => (x.user_id || x.seller_id) === id)) sellersList.push(s);
  };
  (sellersObj.by_type2 || []).forEach(addSeller);
  (sellersObj.by_category || []).forEach(addSeller);
  (sellersObj.by_gpt || []).forEach(item => addSeller(item.seller));
  const sellersToShow = sellersList.slice(0,5);

  let msg = `Based on your interest in "${userMessage}":\n`;

  if (galleries.length) {
    msg += `\nGalleries:\n`;
    galleries.slice(0,5).forEach((g, i) => {
      const t = g.type2 || '';
      const link = `app.zulu.club/${urlEncodeType2(t)}`;
      msg += `${i+1}. ${t} — ${link}\n`;
    });
  } else {
    msg += `\nGalleries:\nNone\n`;
  }

  msg += `\nSellers:\n`;
  if (sellersToShow.length) {
    sellersToShow.forEach((s, i) => {
      const name = s.store_name || s.seller_id || `Seller ${i+1}`;
      const id = s.user_id || s.seller_id || '';
      const link = id ? `app.zulu.club/sellerassets/${id}` : '';
      msg += `${i+1}. ${name}${link ? ` — ${link}` : ''}\n`;
    });
  } else {
    msg += `None\n`;
  }

  return msg.trim();
}

module.exports = {
  normalizeToken,
  singularize,
  editDistance,
  calculateSimilarity,
  smartSimilarity,
  expandCategoryVariants,
  containsClothingKeywords,
  inferGenderFromCategories,
  stripClothingFromType2,
  findKeywordMatchesInCat1,
  urlEncodeType2,
  buildConciseResponse
};