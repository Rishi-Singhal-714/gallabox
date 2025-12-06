const config = require('./config');

async function classifyAndMatchWithGPT(userMessage, galleriesData) {
  const text = (userMessage || '').trim();
  if (!text) {
    return { intent: 'company', confidence: 1.0, reason: 'empty message', matches: [], reasoning: '' };
  }

  if (!config.openai || !process.env.OPENAI_API_KEY) {
    return { intent: 'company', confidence: 0.0, reason: 'OpenAI not configured', matches: [], reasoning: '' };
  }

  const csvDataForGPT = galleriesData.map(item => ({ type2: item.type2, cat1: item.cat1, cat_id: item.cat_id }));

  const prompt = `You are an assistant for Zulu Club (a lifestyle shopping service).

Task:
1) Decide the user's intent. Choose exactly one of: "company", "product", "seller", "investors", "agent", "voice_ai".
   - "company": general questions, greetings, store info, pop-ups, support, availability.
   - "product": the user is asking to browse or buy items, asking what we have, searching for products/categories.
   - "seller": queries about selling on the platform, onboarding merchants.
   - "investors": questions about business model, revenue, funding, pitch, investment.
   - "agent": the user explicitly asks to connect to a human/agent/representative, or asks for a person to contact them.
   - "voice_ai": the user is asking for an AI-made song, AI music message, custom voice AI output.

2) If the intent is "product", pick up to 5 best-matching categories from the AVAILABLE CATEGORIES list.

3) Return ONLY valid JSON in this exact format:
{
  "intent": "product",
  "confidence": 0.0,
  "reason": "short explanation for the chosen intent",
  "matches": [
    { "type2": "exact-type2-from-csv", "reason": "why it matches", "score": 0.85 }
  ],
  "reasoning": "1-3 sentence concise explanation"
}

AVAILABLE CATEGORIES:
${JSON.stringify(csvDataForGPT, null, 2)}

USER MESSAGE:
"""${String(userMessage).replace(/"/g, '\\"')}
"""`;

  try {
    const completion = await config.openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a JSON-only classifier & category matcher. Return only the requested JSON." },
        { role: "user", content: prompt }
      ],
      max_tokens: 900,
      temperature: 0.12
    });

    const raw = (completion.choices && completion.choices[0] && completion.choices[0].message && completion.choices[0].message.content) ? completion.choices[0].message.content.trim() : '';
    try {
      const parsed = JSON.parse(raw);
      const allowedIntents = ['company', 'product', 'seller', 'investors', 'agent', 'voice_ai'];
      const intent = (parsed.intent && allowedIntents.includes(parsed.intent)) ? parsed.intent : 'company';
      const confidence = Number(parsed.confidence) || 0.0;
      const reason = parsed.reason || '';
      const matches = Array.isArray(parsed.matches) ? parsed.matches.map(m => ({ type2: m.type2, reason: m.reason, score: Number(m.score) || 0 })) : [];
      const reasoning = parsed.reasoning || '';

      console.log('🧾 classifyAndMatchWithGPT parsed:', { raw, parsed, intent, confidence });

      return { intent, confidence, reason, matches, reasoning };
    } catch (e) {
      console.error('Error parsing classifyAndMatchWithGPT JSON:', e, 'raw:', raw);
      return { intent: 'company', confidence: 0.0, reason: 'parse error from GPT', matches: [], reasoning: raw.slice(0, 300) };
    }
  } catch (err) {
    console.error('Error calling OpenAI classifyAndMatchWithGPT:', err);
    return { intent: 'company', confidence: 0.0, reason: 'gpt error', matches: [], reasoning: '' };
  }
}

module.exports = {
  classifyAndMatchWithGPT
};