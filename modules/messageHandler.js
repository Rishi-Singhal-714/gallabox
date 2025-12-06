const axios = require('axios');
const config = require('./config');
const sessionManager = require('./sessionManager');
const googleSheets = require('./googleSheets');
const intentClassifier = require('./intentClassifier');
const responseGenerators = require('./responseGenerators');
const matchingHelpers = require('./matchingHelpers');
const sellerMatcher = require('./sellerMatcher');
const preIntentFilter = require('./preintentfilter');

async function sendMessage(to, name, message) {
  try {
    console.log(`📤 Attempting to send message to ${to} (${name}): ${message}`);
    
    const payload = {
      channelId: config.gallaboxConfig.channelId,
      channelType: "whatsapp",
      recipient: {
        name: name,
        phone: to
      },
      whatsapp: {
        type: "text",
        text: {
          body: message
        }
      }
    };
    
    const response = await axios.post(
      `${config.gallaboxConfig.baseUrl}/messages/whatsapp`,
      payload,
      {
        headers: {
          'apiKey': config.gallaboxConfig.apiKey,
          'apiSecret': config.gallaboxConfig.apiSecret,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );
    
    console.log('✅ Message sent successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Error sending message:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
}

function handleEmployeeCommand(sessionId, userMessage) {
  const cmd = (userMessage || "").trim();
  const regex = /^change\s+(\d+)\s+to\s+(normal|employee)\s*,?\s*pass\s+(\S+)/i;
  const match = cmd.match(regex);
  if (!match) return null;

  const [, phoneRaw, role, pass] = match;
  const phone = phoneRaw.replace(/\D/g, "");

  if (pass !== config.EMPLOYEE_STATUS_PASS) return "❌ Incorrect password.";

  if (!config.EMPLOYEE_NUMBERS.includes(phone)) {
    return `⚠️ ${phone} is not in employee list.`;
  }

  if (role.toLowerCase() === "normal") {
    config.EMPLOYEE_FLAGS[phone] = false;
    return `✔ ${phone} switched to *Normal Mode*`;
  }

  delete config.EMPLOYEE_FLAGS[phone];
  return `✔ ${phone} switched to *Employee Mode*`;
}

function recentHistoryContainsProductSignal(conversationHistory = []) {
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return null;
  const productKeywords = ['tshirt','t-shirt','shirt','tee','jeans','pant','pants','trouser','kurta','lehenga','top','dress','saree','innerwear','jacket','sweater','shorts','tshir','t shrt'];
  const recentUserMsgs = conversationHistory.slice(-10).filter(m => m.role === 'user').map(m => (m.content || '').toLowerCase());
  for (const msg of recentUserMsgs) {
    for (const pk of productKeywords) {
      if (msg.includes(pk)) return true;
    }
  }
  return false;
}

async function getChatGPTResponse(sessionId, userMessage, galleriesData, sellersData, companyInfo = config.ZULU_CLUB_INFO) {
  if (!process.env.OPENAI_API_KEY) {
    return "Hello! I'm here to help you with Zulu Club. Currently, I'm experiencing technical difficulties. Please visit zulu.club or contact our support team for assistance.";
  }

  try {
    sessionManager.createOrTouchSession(sessionId);
    const session = sessionManager.conversations[sessionId];

    const cmdReply = handleEmployeeCommand(sessionId, userMessage);
    if (cmdReply) return cmdReply;

    const isInList = config.EMPLOYEE_NUMBERS.includes(sessionId);
    const isDisabled = config.EMPLOYEE_FLAGS[sessionId] === false;

    if (isInList && !isDisabled) {
      console.log("⚡ Employee mode active", sessionId);
      const employeeHandled = await preIntentFilter(
        config.openai,
        session,
        sessionId,
        userMessage,
        googleSheets.getSheets,
        googleSheets.createAgentTicket,
        googleSheets.appendUnderColumn
      );
      if (employeeHandled) return employeeHandled;
    }

    const classification = await intentClassifier.classifyAndMatchWithGPT(userMessage, galleriesData);
    let intent = classification.intent || 'company';
    let confidence = classification.confidence || 0;

    console.log('🧠 GPT classification:', { intent, confidence, reason: classification.reason });

    if (intent === 'product') {
      session.lastDetectedIntent = 'product';
      session.lastDetectedIntentTs = sessionManager.nowMs();
    }

    if (intent === 'agent') {
      session.lastDetectedIntent = 'agent';
      session.lastDetectedIntentTs = sessionManager.nowMs();
      const fullHistory = sessionManager.getFullSessionHistory(sessionId);
      let ticketId = '';
      try {
        ticketId = await googleSheets.createAgentTicket(sessionId, fullHistory);
      } catch (e) {
        console.error('Error creating agent ticket:', e);
        ticketId = await googleSheets.generateTicketId();
      }

      try {
        await googleSheets.appendUnderColumn(sessionId, `AGENT_TICKET_CREATED: ${ticketId}`);
      } catch (e) {
        console.error('Failed to log agent ticket:', e);
      }

      return `Our representative will connect with you soon (within 30 mins). Your ticket id: ${ticketId}`;
    }

    if (intent === 'voice_ai') {
      session.lastDetectedIntent = 'voice_ai';
      session.lastDetectedIntentTs = sessionManager.nowMs();
      return `🎵 *Custom AI Music Message (Premium Add-on)*

For every gift above ₹1,000:
• You give a fun/emotional dialogue or a voice note  
• We turn it into a goofy or personalised AI song  
• Delivered within *2 hours* on WhatsApp  
• Adds emotional value & boosts the gifting impact ❤️

Fill this quick form to create your AI song:
${config.VOICE_AI_FORM_LINK}`;
    }

    if (intent === 'seller') {
      session.lastDetectedIntent = 'seller';
      session.lastDetectedIntentTs = sessionManager.nowMs();
      return await responseGenerators.generateSellerResponse(userMessage);
    }

    if (intent === 'investors') {
      session.lastDetectedIntent = 'investors';
      session.lastDetectedIntentTs = sessionManager.nowMs();
      return await responseGenerators.generateInvestorResponse(userMessage);
    }

    if (intent === 'product' && galleriesData.length > 0) {
      if (session.lastDetectedIntent !== 'product') {
        session.lastDetectedIntent = 'product';
        session.lastDetectedIntentTs = sessionManager.nowMs();
      }

      const matchedType2s = (classification.matches || []).map(m => m.type2).filter(Boolean);
      let matchedCategories = [];
      if (matchedType2s.length > 0) {
        matchedCategories = matchedType2s
          .map(t => galleriesData.find(g => String(g.type2).trim() === String(t).trim()))
          .filter(Boolean)
          .slice(0,5);
      }

      if (matchedCategories.length === 0) {
        const fullHistory = sessionManager.getFullSessionHistory(sessionId);
        matchedCategories = await sellerMatcher.findGptMatchedCategories(userMessage, fullHistory, galleriesData);
      } else {
        const fullHistory = sessionManager.getFullSessionHistory(sessionId);
        const isShortOrQualifier = (msg) => {
          if (!msg) return false;
          const trimmed = String(msg).trim();
          if (trimmed.split(/\s+/).length <= 3) return true;
          if (trimmed.length <= 12) return true;
          return false;
        };
        if (isShortOrQualifier(userMessage)) {
          const refined = await sellerMatcher.findGptMatchedCategories(userMessage, fullHistory, galleriesData);
          if (refined && refined.length > 0) matchedCategories = refined;
        }
      }

      if (matchedCategories.length === 0) {
        if (matchingHelpers.containsClothingKeywords(userMessage)) {
          const fullHistory = sessionManager.getFullSessionHistory(sessionId);
          matchedCategories = await sellerMatcher.findGptMatchedCategories(userMessage, fullHistory, galleriesData);
        } else {
          const keywordMatches = matchingHelpers.findKeywordMatchesInCat1(userMessage, galleriesData);
          if (keywordMatches.length > 0) {
            matchedCategories = keywordMatches;
          } else {
            const fullHistory = sessionManager.getFullSessionHistory(sessionId);
            matchedCategories = await sellerMatcher.findGptMatchedCategories(userMessage, fullHistory, galleriesData);
          }
        }
      }

      const detectedGender = matchingHelpers.inferGenderFromCategories(matchedCategories);
      const sellers = await sellerMatcher.findSellersForQuery(userMessage, matchedCategories, sellersData, detectedGender);
      return matchingHelpers.buildConciseResponse(userMessage, matchedCategories, sellers);
    }

    return await responseGenerators.generateCompanyResponse(userMessage, sessionManager.getFullSessionHistory(sessionId), companyInfo);
  } catch (error) {
    console.error('❌ getChatGPTResponse error:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

async function handleMessage(sessionId, userMessage, galleriesData, sellersData) {
  try {
    sessionManager.appendToSessionHistory(sessionId, 'user', userMessage);

    try {
      await googleSheets.appendUnderColumn(sessionId, `USER: ${userMessage}`);
    } catch (e) {
      console.error('sheet log user failed', e);
    }

    const fullHistory = sessionManager.getFullSessionHistory(sessionId);
    console.log(`🔁 Session ${sessionId} history length: ${fullHistory.length}`);
    fullHistory.forEach((h, idx) => {
      console.log(`   ${idx + 1}. [${h.role}] ${h.content}`);
    });

    const aiResponse = await getChatGPTResponse(sessionId, userMessage, galleriesData, sellersData);
    sessionManager.appendToSessionHistory(sessionId, 'assistant', aiResponse);

    try {
      await googleSheets.appendUnderColumn(sessionId, `ASSISTANT: ${aiResponse}`);
    } catch (e) {
      console.error('sheet log assistant failed', e);
    }

    if (sessionManager.conversations[sessionId]) {
      sessionManager.conversations[sessionId].lastActive = sessionManager.nowMs();
    }

    return aiResponse;
  } catch (error) {
    console.error('❌ Error handling message:', error);
    return `Based on your interest in "${userMessage}":\nGalleries: None\nSellers: None`;
  }
}

module.exports = {
  sendMessage,
  handleEmployeeCommand,
  getChatGPTResponse,
  handleMessage
};