const messageHandler = require('./messageHandler');
const dataLoaders = require('./dataLoaders');

async function handleWebhook(req, res, galleriesData, sellersData) {
  try {
    console.log('📩 Received webhook:', JSON.stringify(req.body, null, 2));
    const webhookData = req.body;
    const userMessage = webhookData.whatsapp?.text?.body?.trim();
    const userPhone = webhookData.whatsapp?.from;
    const userName = webhookData.contact?.name || 'Customer';
    
    console.log(`💬 Received message from ${userPhone} (${userName}): ${userMessage}`);
    
    if (userMessage && userPhone) {
      const aiResponse = await messageHandler.handleMessage(userPhone, userMessage, galleriesData, sellersData);
      await messageHandler.sendMessage(userPhone, userName, aiResponse);
      console.log(`✅ AI response sent to ${userPhone}`);
    } else {
      console.log('❓ No valid message or phone number found in webhook');
    }
    
    res.status(200).json({ status: 'success', message: 'Webhook processed successfully', processed: true });
  } catch (error) {
    console.error('💥 Webhook error:', error.message);
    res.status(500).json({ status: 'error', message: error.message, processed: false });
  }
}

async function handleRoot(req, res, galleriesData, sellersData) {
  const conversations = require('./sessionManager').conversations;
  res.json({ 
    status: 'Server is running on Vercel', 
    service: 'Zulu Club WhatsApp AI Assistant',
    version: '6.1 - Modular Refactor',
    stats: {
      product_categories_loaded: galleriesData.length,
      sellers_loaded: sellersData.length,
      active_conversations: Object.keys(conversations).length
    },
    timestamp: new Date().toISOString()
  });
}

async function refreshCSV(req, res) {
  try {
    const galleriesData = await dataLoaders.loadGalleriesData();
    const sellersData = await dataLoaders.loadSellersData();
    res.json({ 
      status: 'success', 
      message: 'CSV data refreshed successfully', 
      categories_loaded: galleriesData.length, 
      sellers_loaded: sellersData.length 
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
}

async function testKeywordMatching(req, res, galleriesData) {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const matchingHelpers = require('./matchingHelpers');
    const sellerMatcher = require('./sellerMatcher');
    
    const isClothing = matchingHelpers.containsClothingKeywords(query);
    const keywordMatches = matchingHelpers.findKeywordMatchesInCat1(query, galleriesData);
    const detectedGender = matchingHelpers.inferGenderFromCategories(keywordMatches);
    const sellers = await sellerMatcher.findSellersForQuery(query, keywordMatches, require('./sessionManager').sellersData, detectedGender);
    const concise = matchingHelpers.buildConciseResponse(query, keywordMatches, sellers);
    
    res.json({ 
      query, 
      is_clothing_query: isClothing, 
      detected_gender: detectedGender, 
      keyword_matches: keywordMatches, 
      sellers, 
      homeCheck: sellers.homeCheck || {}, 
      concise_preview: concise, 
      categories_loaded: galleriesData.length 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function testGPTMatching(req, res, galleriesData) {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });
  try {
    const sellerMatcher = require('./sellerMatcher');
    const matchingHelpers = require('./matchingHelpers');
    
    const dummyHistory = [{ role: 'user', content: 'Earlier I asked about lamps' }, { role: 'assistant', content: 'Would you like modern floor lamps?' }];
    const matched = await sellerMatcher.findGptMatchedCategories(query, dummyHistory, galleriesData);
    const detectedGender = matchingHelpers.inferGenderFromCategories(matched);
    
    res.json({ 
      query, 
      matched_categories: matched, 
      categories_loaded: galleriesData.length, 
      detected_gender: detectedGender 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function sendTestMessage(req, res) {
  try {
    const { to, name, message } = req.body;
    if (!to) return res.status(400).json({ 
      error: 'Missing "to" in request body', 
      example: { "to": "918368127760", "name": "Rishi", "message": "What products do you have?" } 
    });
    
    const result = await messageHandler.sendMessage(to, name || 'Test User', message || 'Hello! This is a test message from Zulu Club AI Assistant. 🚀');
    res.json({ status: 'success', message: 'Test message sent successfully', data: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send test message', details: error.message });
  }
}

async function tourBooked(req, res) {
  try {
    const { customerPhone, customerName } = req.body;
    const ADMINS = ["918368127760"];
    const msg = `🎉 *New Try-At-Home Booking*\nCustomer: ${customerName || "Unknown"}\nPhone: ${customerPhone || "Not Provided"}\n📌 Please contact customer.`;

    for (const admin of ADMINS) {
      await messageHandler.sendMessage(admin, "Admin", msg);
    }

    return res.json({ success: true, message: "Tour booked alerts sent to admins" });
  } catch (error) {
    console.error("❌ Tour Booked Admin Alert - Error:", error.message);
    return res.status(500).json({ success: false, error: "Alert failed" });
  }
}

async function tourNotBooked(req, res) {
  try {
    const { customerPhone, customerName } = req.body;
    const ADMINS = ["918368127760"];
    const msg = `⚠️ *Try-At-Home Booking Failed*\nCustomer: ${customerName || "Unknown"}\nPhone: +${customerPhone || "Not Provided"}\n📌 Please follow up.`;

    for (const admin of ADMINS) {
      await messageHandler.sendMessage(admin, "Admin", msg);
    }

    return res.json({ success: true, message: "Tour not-booked alerts sent to admins" });
  } catch (error) {
    console.error("❌ Tour NotBooked Admin Alert - Error:", error.message);
    return res.status(500).json({ success: false, error: "Alert failed" });
  }
}

module.exports = {
  handleWebhook,
  handleRoot,
  refreshCSV,
  testKeywordMatching,
  testGPTMatching,
  sendTestMessage,
  tourBooked,
  tourNotBooked
};