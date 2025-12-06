const config = require('./config');
const matchingHelpers = require('./matchingHelpers');

const MAX_GPT_SELLER_CHECK = 20;
const GPT_THRESHOLD = 0.7;
const GPT_HOME_THRESHOLD = 0.6;

function getUserIdForSellerId(sellerId, sellersData) {
  if (!sellerId) return '';
  const s = sellersData.find(x => (x.seller_id && String(x.seller_id) === String(sellerId)));
  if (s && s.user_id && String(s.user_id).trim().length > 0) return String(s.user_id).trim();
  return String(sellerId).trim();
}

function matchSellersByStoreName(type2Value, sellersData, detectedGender = null) {
  if (!type2Value || !sellersData.length) return [];
  const stripped = matchingHelpers.stripClothingFromType2(type2Value);
  const norm = matchingHelpers.normalizeToken(stripped);
  if (!norm) return [];

  const matches = [];
  sellersData.forEach(seller => {
    const store = seller.store_name || '';
    const sim = matchingHelpers.smartSimilarity(store, norm);
    if (sim < 0.82) return;

    if (detectedGender) {
      const sellerGenders = new Set();
      (seller.category_ids_array || []).forEach(c => {
        if (/\bmen\b|\bman\b|\bmens\b/.test(c)) sellerGenders.add('men');
        if (/\bwomen\b|\bwoman\b|\bwomens\b|ladies/.test(c)) sellerGenders.add('women');
        if (/\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c)) sellerGenders.add('kids');
      });
      if (sellerGenders.size > 0 && !sellerGenders.has(detectedGender)) {
        return;
      }
    }

    matches.push({ seller, score: sim });
  });
  return matches.sort((a,b) => b.score - a.score).map(m => ({ ...m.seller, score: m.score })).slice(0, 10);
}

function matchSellersByCategoryIds(userMessage, sellersData, detectedGender = null) {
  if (!userMessage || !sellersData.length) return [];
  const terms = userMessage.toLowerCase().replace(/&/g,' ').split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const matches = [];
  sellersData.forEach(seller => {
    const categories = seller.category_ids_array || [];

    if (detectedGender) {
      const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
      if (sellerHasGender) {
        const sellerGenderMatch = categories.some(c => {
          if (detectedGender === 'men') return /\bmen\b|\bman\b|\bmens\b/.test(c);
          if (detectedGender === 'women') return /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c);
          if (detectedGender === 'kids') return /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c);
          return false;
        });
        if (!sellerGenderMatch) return;
      }
    }

    const common = categories.filter(c => terms.some(t => t.includes(c) || c.includes(t)));
    if (common.length > 0) {
      matches.push({ seller, matches: common.length });
    }
  });
  return matches.sort((a,b) => b.matches - a.matches).map(m => m.seller).slice(0, 10);
}

async function isQueryHome(userMessage) {
  if (!config.openai || !process.env.OPENAI_API_KEY) return { isHome: false, score: 0 };
  const prompt = `You are a classifier that decides whether a user search query is about HOME / HOME DECOR items (vases, lamps, clocks, showpieces, cushions, etc.) or NOT.

USER QUERY: "${userMessage}"

Answer ONLY with JSON:
{ "is_home_score": 0.0, "reasoning": "one-to-three-sentence reasoning why you scored it this way" }`;

  try {
    const completion = await config.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier that returns only JSON with is_home_score and reasoning." },
        { role: "user", content: prompt }
      ],
      max_tokens: 120,
      temperature: 0.0
    });
    const raw = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(raw);
      const score = Number(parsed.is_home_score) || 0;
      return { isHome: score >= GPT_HOME_THRESHOLD, score, reasoning: parsed.reasoning || parsed.debug_reasoning || '' };
    } catch (e) {
      console.error('Error parsing isQueryHome JSON:', e, 'raw:', raw);
      return { isHome: false, score: 0, reasoning: '' };
    }
  } catch (err) {
    console.error('GPT error in isQueryHome:', err);
    return { isHome: false, score: 0, reasoning: '' };
  }
}

async function gptCheckSellerMaySell(userMessage, seller) {
  if (!config.openai || !process.env.OPENAI_API_KEY) return { score: 0, reason: 'OpenAI not configured', reasoning: '' };

  const prompt = `You are an assistant that rates how likely a seller sells a product a user asks for.

USER MESSAGE: "${userMessage}"

SELLER INFORMATION:
Store name: "${seller.store_name || ''}"
Seller id: "${seller.seller_id || ''}"
Seller categories: "${(seller.category_ids_array || []).join(', ')}"
Other info (raw CSV row): ${JSON.stringify(seller.raw || {})}

Question: Based on the above, how likely (0.0 - 1.0) is it that this seller sells the product the user is asking for?

Return ONLY valid JSON in this format:
{ "score": 0.0, "reason": "one-sentence reason", "reasoning": "1-3 sentence compact chain-of-thought / steps used to decide" }`;

  try {
    const completion = await config.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a concise JSON-only classifier & scorer. Return only JSON {score, reason, reasoning}." },
        { role: "user", content: prompt }
      ],
      max_tokens: 180,
      temperature: 0.0
    });

    const content = completion.choices[0].message.content.trim();
    try {
      const parsed = JSON.parse(content);
      return {
        score: Number(parsed.score) || 0,
        reason: parsed.reason || parsed.explanation || '',
        reasoning: parsed.reasoning || parsed.debug_reasoning || ''
      };
    } catch (parseError) {
      console.error('Error parsing GPT seller-check response:', parseError, 'raw:', content);
      return { score: 0, reason: 'GPT response could not be parsed', reasoning: content.slice(0, 300) };
    }
  } catch (error) {
    console.error('Error during GPT seller-check:', error);
    return { score: 0, reason: 'GPT error', reasoning: '' };
  }
}

async function findGptMatchedCategories(userMessage, conversationHistory, galleriesData) {
  try {
    const csvDataForGPT = galleriesData.map(item => ({
      type2: item.type2,
      cat1: item.cat1,
      cat_id: item.cat_id
    }));

    const systemContent = "You are a product matching expert for Zulu Club. Use the conversation history to understand what the user wants, and return only JSON with top matches and a compact reasoning field.";
    const messagesForGPT = [{ role: 'system', content: systemContent }];

    const historyToInclude = Array.isArray(conversationHistory) ? conversationHistory.slice(-30) : [];
    for (const h of historyToInclude) {
      const role = (h.role === 'assistant') ? 'assistant' : 'user';
      messagesForGPT.push({ role, content: h.content });
    }

    const userPrompt = `Using the conversation above and the user's latest message, return the top 5 matching categories from the AVAILABLE PRODUCT CATEGORIES (use the "type2" field).

AVAILABLE PRODUCT CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE: "${userMessage}"

RESPONSE FORMAT (JSON ONLY):
{
  "matches": [
    { "type2": "exact-type2-value-from-csv", "reason": "brief explanation", "score": 0.9 }
  ],
  "reasoning": "1-3 sentence summary of how you matched categories (brief steps)"
}`;
    messagesForGPT.push({ role: 'user', content: userPrompt });

    const completion = await config.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messagesForGPT,
      max_tokens: 1000,
      temperature: 0.2
    });

    const responseText = completion.choices[0].message.content.trim();
    let matches = [];
    let reasoning = '';
    try {
      const parsed = JSON.parse(responseText);
      matches = parsed.matches || [];
      reasoning = parsed.reasoning || parsed.debug_reasoning || '';
    } catch (e) {
      console.error('Error parsing GPT product matches JSON:', e, 'raw:', responseText);
      matches = [];
      reasoning = responseText.slice(0, 300);
    }

    const matchedCategories = matches
      .map(match => galleriesData.find(item => String(item.type2).trim() === String(match.type2).trim()))
      .filter(Boolean)
      .slice(0,5);

    matchedCategories._reasoning = reasoning;
    return matchedCategories;
  } catch (error) {
    console.error('Error in findGptMatchedCategories:', error);
    return [];
  }
}

async function findSellersForQuery(userMessage, galleryMatches, sellersData, detectedGender = null) {
  const homeCheck = await isQueryHome(userMessage);
  const applyHomeFilter = homeCheck.isHome;

  const sellers_by_type2 = new Map();
  for (const gm of galleryMatches) {
    const type2 = gm.type2 || '';
    const found = matchSellersByStoreName(type2, sellersData, detectedGender);
    found.forEach(s => sellers_by_type2.set(s.seller_id || (s.store_name+'#'), s));
  }

  const catMatches = matchSellersByCategoryIds(userMessage, sellersData, detectedGender);
  const sellers_by_category = new Map();
  catMatches.forEach(s => sellers_by_category.set(s.seller_id || (s.store_name+'#'), s));

  if (applyHomeFilter) {
    const homeSyns = ['home','decor','home decor','home-decor','home_decor','furniture','homeaccessories','home-accessories','home_accessories','decoratives','showpiece','showpieces','lamp','lamps','vase','vases','clock','clocks','cushion','cushions'];
    const keepIfHome = (s) => {
      const arr = s.category_ids_array || [];
      return arr.some(c => {
        const cc = c.toLowerCase();
        return homeSyns.some(h => cc.includes(h) || h.includes(cc));
      });
    };
    for (const [k, s] of Array.from(sellers_by_type2.entries())) {
      if (!keepIfHome(s)) sellers_by_type2.delete(k);
    }
    for (const [k, s] of Array.from(sellers_by_category.entries())) {
      if (!keepIfHome(s)) sellers_by_category.delete(k);
    }
  }

  const candidateIds = new Set([...sellers_by_type2.keys(), ...sellers_by_category.keys()]);
  const candidateList = [];
  
  if (candidateIds.size === 0) {
    if (applyHomeFilter) {
      for (const s of sellersData) {
        const arr = s.category_ids_array || [];
        if (arr.some(c => c.includes('home') || c.includes('decor') || c.includes('furnit') || c.includes('vase') || c.includes('lamp') || c.includes('clock'))) {
          candidateList.push(s);
          if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        }
      }
    }
    for (let i = 0; i < Math.min(MAX_GPT_SELLER_CHECK, sellersData.length) && candidateList.length < MAX_GPT_SELLER_CHECK; i++) {
      const s = sellersData[i];
      if (!s) continue;
      if (detectedGender) {
        const categories = s.category_ids_array || [];
        const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
        if (sellerHasGender) {
          const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                          : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                          : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
          if (!genderMatch) continue;
        }
      }
      if (!candidateList.includes(s)) candidateList.push(s);
    }
  } else {
    for (const id of candidateIds) {
      const s = sellersData.find(x => (x.seller_id == id) || ((x.store_name+'#') == id));
      if (s) candidateList.push(s);
    }
    if (candidateList.length < MAX_GPT_SELLER_CHECK) {
      for (const s of sellersData) {
        if (candidateList.length >= MAX_GPT_SELLER_CHECK) break;
        if (!candidateList.includes(s)) {
          if (detectedGender) {
            const categories = s.category_ids_array || [];
            const sellerHasGender = categories.some(c => /\bmen\b|\bman\b|\bmens\b|\bwomen\b|\bwoman\b|\bwomens\b|\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
            if (sellerHasGender) {
              const genderMatch = detectedGender === 'men' ? categories.some(c => /\bmen\b|\bman\b|\bmens\b/.test(c))
                            : detectedGender === 'women' ? categories.some(c => /\bwomen\b|\bwoman\b|\bwomens\b|ladies\b/.test(c))
                            : categories.some(c => /\bkid\b|\bkids\b|\bchild\b|\bchildren\b/.test(c));
              if (!genderMatch) continue;
            }
          }
          candidateList.push(s);
        }
      }
    }
  }

  const sellers_by_gpt = [];
  const toCheck = candidateList.slice(0, MAX_GPT_SELLER_CHECK);
  const gptPromises = toCheck.map(async (seller) => {
    if (applyHomeFilter) {
      const arr = seller.category_ids_array || [];
      const isHome = arr.some(c => 
        c.includes("home") || c.includes("decor") || 
        c.includes("lamp") || c.includes("vase") || 
        c.includes("clock") || c.includes("furnit")
      );
      if (!isHome) return null;
    }

    const result = await gptCheckSellerMaySell(userMessage, seller);
    if (result.score > GPT_THRESHOLD) {
      return { seller, score: result.score, reason: result.reason };
    }
    return null;
  });

  const gptResults = await Promise.all(gptPromises);
  gptResults.forEach(r => {
    if (r) sellers_by_gpt.push(r);
  });

  const sellersType2Arr = Array.from(sellers_by_type2.values()).slice(0, 10);
  const sellersCategoryArr = Array.from(sellers_by_category.values()).slice(0, 10);

  return {
    by_type2: sellersType2Arr,
    by_category: sellersCategoryArr,
    by_gpt: sellers_by_gpt,
    homeCheck
  };
}

module.exports = {
  getUserIdForSellerId,
  matchSellersByStoreName,
  matchSellersByCategoryIds,
  isQueryHome,
  gptCheckSellerMaySell,
  findGptMatchedCategories,
  findSellersForQuery
};