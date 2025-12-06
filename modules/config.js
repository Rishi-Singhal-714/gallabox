const { OpenAI } = require('openai');

// Gallabox API configuration
const gallaboxConfig = {
  accountId: process.env.GALLABOX_ACCOUNT_ID,
  apiKey: process.env.GALLABOX_API_KEY,
  apiSecret: process.env.GALLABOX_API_SECRET,
  channelId: process.env.GALLABOX_CHANNEL_ID,
  baseUrl: 'https://server.gallabox.com/devapi'
};

// OpenAI configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || ''
});

// Google Sheets config
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || 'Sheet1';
const AGENT_TICKETS_SHEET = process.env.AGENT_TICKETS_SHEET || 'Sheet2';
const BILLING_SHEET_NAME = process.env.BILLING_SHEET_NAME || "Sheet3";
const SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '';

// Company information
const ZULU_CLUB_INFO = `We're building a new way to shop and discover lifestyle products online.
Introducing Zulu Club — your personalized lifestyle shopping experience, delivered right to your doorstep.
Browse and shop high-quality lifestyle products across categories you love:
- Women's Fashion — dresses, tops, co-ords, winterwear, loungewear & more
- Men's Fashion — shirts, tees, jackets, athleisure & more
- Kids — clothing, toys, learning kits & accessories
- Footwear — sneakers, heels, flats, sandals & kids shoes
- Home Decor — showpieces, vases, lamps, aroma decor, premium home accessories
- Beauty & Self-Care — skincare, bodycare, fragrances & grooming essentials
- Fashion Accessories — bags, jewelry, watches, sunglasses & belts
- Lifestyle Gifting — curated gift sets & décor-based gifting
And the best part? No waiting days for delivery. With Zulu Club, your selection arrives in just 100 minutes. Try products at home, keep what you love, return instantly — it's smooth, personal, and stress-free.
Now live in Gurgaon
Experience us at our pop-ups: AIPL Joy Street & AIPL Central
Explore & shop on: zulu.club
Get the Zulu Club app: Android-> Playstore iOS-> Appstore`;

const INVESTOR_KNOWLEDGE = `Zulu, founded in 2024 by Adarsh Bhatia with co-founder Anubhav, operates under MADMIND TECH INNOVATIONS PRIVATE LIMITED, Gurgaon.
Seed round: $250K raised on July 16, 2025 from TDV Partners.
Legal: CIN U47710HR2024PTC125362, registered on October 7, 2024.
HQ: D20-301, Ireo Victory Valley, Sector-67, Gurgaon.
Authorized capital INR 6.5 lakh | Paid-up INR 5.57 lakh.
1 brand (Zulu), 9 competitors (Inc: Slikk, Booon, Blip).`;

const SELLER_KNOWLEDGE = `Zulu Club is a lifestyle commerce platform by MADMIND TECH.
Serve Gurgaon — 100-min delivery. Try at home. Instant returns.
Works with fashion, beauty, home, footwear, accessories, kids & gifting.
Online visibility + offline pop-ups at AIPL Joy Street & Central.
High intent customers, fast logistics, frictionless onboarding.
zulu.club + Zulu Club apps (Android + iOS).`;

// Employee configuration
const EMPLOYEE_STATUS_PASS = process.env.EMPLOYEE_STATUS_PASS || "";

// Voice AI Form
const VOICE_AI_FORM_LINK = 'https://forms.gle/CiPAk6RqWxkd8uSKA';

module.exports = {
  gallaboxConfig,
  openai,
  GOOGLE_SHEET_ID,
  AGENT_TICKETS_SHEET,
  BILLING_SHEET_NAME,
  SA_JSON_B64,
  ZULU_CLUB_INFO,
  INVESTOR_KNOWLEDGE,
  SELLER_KNOWLEDGE,
  EMPLOYEE_STATUS_PASS,
  VOICE_AI_FORM_LINK
};
