// ------------------ SESSION MANAGER ------------------
const SESSION_TTL_MS = 1000 * 60 * 60;     // 1 hour session expiry
const SESSION_CLEANUP_MS = 1000 * 60 * 5;  // Cleanup every 5 minutes
const MAX_HISTORY_MESSAGES = 2000;

let conversations = {};

function nowMs() {
  return Date.now();
}

/**
 * Create a new session or refresh the current one
 */
function createOrTouchSession(sessionId) {
  if (!conversations[sessionId]) {
    conversations[sessionId] = {
      history: [],
      lastActive: nowMs(),
      lastDetectedIntent: null,
      lastDetectedIntentTs: 0
    };
  } else {
    conversations[sessionId].lastActive = nowMs();
  }
  return conversations[sessionId];
}

/**
 * Append user or assistant message to session history
 */
function appendToSessionHistory(sessionId, role, content) {
  createOrTouchSession(sessionId);
  const entry = { role, content, ts: nowMs() };
  conversations[sessionId].history.push(entry);

  // Trim history if oversized
  if (conversations[sessionId].history.length > MAX_HISTORY_MESSAGES) {
    conversations[sessionId].history =
      conversations[sessionId].history.slice(-MAX_HISTORY_MESSAGES);
  }

  conversations[sessionId].lastActive = nowMs();
}

/**
 * Get history array safely (cloned)
 */
function getFullSessionHistory(sessionId) {
  const s = conversations[sessionId];
  if (!s || !s.history) return [];
  return s.history.slice();
}

/**
 * Auto remove expired sessions
 */
function purgeExpiredSessions() {
  const cutoff = nowMs() - SESSION_TTL_MS;
  const before = Object.keys(conversations).length;

  for (const id of Object.keys(conversations)) {
    if (!conversations[id].lastActive || conversations[id].lastActive < cutoff) {
      delete conversations[id];
    }
  }

  const after = Object.keys(conversations).length;
  if (before !== after) {
    console.log(`🧹 Purged ${before - after} expired sessions`);
  }
}

// Schedule purge
setInterval(purgeExpiredSessions, SESSION_CLEANUP_MS);

/**
 * Debug endpoint to view session
 */
function getSession(req, res) {
  const id = req.params.id;
  const s = conversations[id];
  if (!s) return res.status(404).json({ error: 'No session found' });

  res.json({
    sessionId: id,
    lastActive: s.lastActive,
    historyLen: s.history.length,
    history: s.history
  });
}

// ------------------ EXPORTS ------------------
module.exports = {
  conversations,
  createOrTouchSession,
  appendToSessionHistory,
  getFullSessionHistory,
  getSession,
  nowMs // <-- 🔥 FIX: ensure available to other modules
};
