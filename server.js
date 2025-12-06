const express = require('express');
const app = express();

// Load all modules
const config = require('./modules/config');
const dataLoaders = require('./modules/dataLoaders');
const sessionManager = require('./modules/sessionManager');
const messageHandler = require('./modules/messageHandler');
const webhookHandler = require('./modules/webhookHandler');

// Initialize modules
let galleriesData = [];
let sellersData = [];
dataLoaders.initializeData().then((data) => {
  galleriesData = data.galleriesData;
  sellersData = data.sellersData;
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.post('/webhook', (req, res) => webhookHandler.handleWebhook(req, res, galleriesData, sellersData));
app.get('/', (req, res) => webhookHandler.handleRoot(req, res, galleriesData, sellersData));
app.get('/refresh-csv', (req, res) => webhookHandler.refreshCSV(req, res));
app.get('/test-keyword-matching', (req, res) => webhookHandler.testKeywordMatching(req, res, galleriesData));
app.get('/test-gpt-matching', (req, res) => webhookHandler.testGPTMatching(req, res, galleriesData));
app.post('/send-test-message', (req, res) => webhookHandler.sendTestMessage(req, res));
app.post('/tour/booked', (req, res) => webhookHandler.tourBooked(req, res));
app.post('/tour/notbooked', (req, res) => webhookHandler.tourNotBooked(req, res));
app.get('/session/:id', (req, res) => sessionManager.getSession(req, res));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
