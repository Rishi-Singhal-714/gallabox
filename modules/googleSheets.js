const { google } = require('googleapis');
const config = require('./config');

async function getSheets() {
  if (!config.GOOGLE_SHEET_ID || !config.SA_JSON_B64) return null;
  try {
    const keyJson = JSON.parse(Buffer.from(config.SA_JSON_B64, 'base64').toString('utf8'));
    const jwt = new google.auth.JWT(
      keyJson.client_email,
      null,
      keyJson.private_key,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    await jwt.authorize();
    return google.sheets({ version: 'v4', auth: jwt });
  } catch (e) {
    console.error('❌ Error initializing Google Sheets client:', e);
    return null;
  }
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function writeCell(colNum, rowNum, value) {
  const sheets = await getSheets();
  if (!sheets) return;
  const range = `${colLetter(colNum)}${rowNum}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [[value]] }
    });
  } catch (e) {
    console.error('❌ writeCell error', e);
  }
}

async function appendUnderColumn(headerName, text) {
  const sheets = await getSheets();
  if (!sheets) return;
  try {
    const headersResp = await sheets.spreadsheets.values.get({ 
      spreadsheetId: config.GOOGLE_SHEET_ID, 
      range: '1:1' 
    });
    const headers = (headersResp.data.values && headersResp.data.values[0]) || [];
    let colIndex = headers.findIndex(h => String(h).trim() === headerName);
    if (colIndex === -1) {
      colIndex = headers.length;
      const headerCol = colLetter(colIndex + 1) + '1';
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.GOOGLE_SHEET_ID,
        range: headerCol,
        valueInputOption: 'RAW',
        requestBody: { values: [[headerName]] }
      });
    }
    const colNum = colIndex + 1;
    const colRange = `${colLetter(colNum)}2:${colLetter(colNum)}`;
    let colValues = [];
    try {
      const colResp = await sheets.spreadsheets.values.get({
        spreadsheetId: config.GOOGLE_SHEET_ID,
        range: colRange,
        majorDimension: 'COLUMNS'
      });
      colValues = (colResp.data.values && colResp.data.values[0]) || [];
    } catch (e) {
      colValues = [];
    }
    const nextRow = 2 + colValues.length;
    const ts = new Date().toISOString();
    const finalText = `${ts} | ${text}`;
    await writeCell(colNum, nextRow, finalText);
  } catch (e) {
    console.error('❌ appendUnderColumn error', e);
  }
}

async function generateTicketId() {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn("Sheets not available — fallback random Ticket ID");
    const now = Date.now();
    return `TKT-${String(now).slice(-6)}`;
  }

  const COUNTER_CELL = `${config.AGENT_TICKETS_SHEET}!Z2`;

  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: COUNTER_CELL
    });

    let current = resp.data.values?.[0]?.[0] ? Number(resp.data.values[0][0]) : 0;
    const next = current + 1;

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: COUNTER_CELL,
      valueInputOption: "RAW",
      requestBody: { values: [[next]] }
    });

    return `TKT-${String(next).padStart(6, "0")}`;
  } catch (err) {
    console.error("Ticket ID counter error:", err);
    return `TKT-${String(Date.now()).slice(-6)}`;
  }
}

async function ensureAgentTicketsHeader(sheets) {
  try {
    const sheetName = config.AGENT_TICKETS_SHEET;
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: `${sheetName}!1:1`
    }).catch(() => null);

    const existing = (resp && resp.data && resp.data.values && resp.data.values[0]) || [];
    const required = ['mobile_number', 'last_5th_message', '4th_message', '3rd_message', '2nd_message', '1st_message', 'ticket_id', 'ts'];
    
    if (existing.length === 0 || required.some((h, i) => String(existing[i] || '').trim().toLowerCase() !== h)) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.GOOGLE_SHEET_ID,
        range: `${sheetName}!1:1`,
        valueInputOption: 'RAW',
        requestBody: { values: [required] }
      });
    }
    return sheetName;
  } catch (e) {
    console.error('ensureAgentTicketsHeader error', e);
    return config.AGENT_TICKETS_SHEET;
  }
}

async function createAgentTicket(mobileNumber, conversationHistory = []) {
  const sheets = await getSheets();
  if (!sheets) {
    console.warn('Google Sheets not configured — cannot write agent ticket');
    return generateTicketId();
  }
  try {
    const sheetName = await ensureAgentTicketsHeader(sheets);
    const userMsgs = (Array.isArray(conversationHistory) ? conversationHistory : [])
      .filter(m => m.role === 'user')
      .map(m => (m.content || ''));
    const lastFive = userMsgs.slice(-5);
    const pad = Array(Math.max(0, 5 - lastFive.length)).fill('');
    const arranged = [...pad, ...lastFive];
    const ticketId = await generateTicketId();
    const ts = new Date().toISOString();
    const row = [
      mobileNumber || '',
      arranged[0] || '',
      arranged[1] || '',
      arranged[2] || '',
      arranged[3] || '',
      arranged[4] || '',
      ticketId,
      ts
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.GOOGLE_SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    return ticketId;
  } catch (e) {
    console.error('createAgentTicket error', e);
    return generateTicketId();
  }
}

module.exports = {
  getSheets,
  colLetter,
  writeCell,
  appendUnderColumn,
  generateTicketId,
  ensureAgentTicketsHeader,
  createAgentTicket
};
