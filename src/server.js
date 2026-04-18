const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Database setup ---
const db = new Database(process.env.DB_PATH || './data.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_status (
    id TEXT PRIMARY KEY,
    general_id TEXT NOT NULL,
    channel INTEGER NOT NULL,
    killed_at INTEGER NOT NULL,
    killed_by TEXT,
    respawn_min INTEGER DEFAULT 360,
    respawn_max INTEGER DEFAULT 480
  );
`);

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- WebSocket broadcast helper ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// --- REST API ---

// Get all active general statuses
app.get('/api/generals', (req, res) => {
  const rows = db.prepare('SELECT * FROM general_status ORDER BY killed_at DESC').all();
  res.json(rows);
});

// Mark general as killed
app.post('/api/generals/kill', (req, res) => {
  const { general_id, channel, killed_by } = req.body;
  if (!general_id || !channel) return res.status(400).json({ error: 'Missing fields' });

  const id = uuidv4();
  const killed_at = Date.now();

  // Remove previous entry for same general+channel
  db.prepare('DELETE FROM general_status WHERE general_id = ? AND channel = ?').run(general_id, channel);

  db.prepare(`
    INSERT INTO general_status (id, general_id, channel, killed_at, killed_by, respawn_min, respawn_max)
    VALUES (?, ?, ?, ?, ?, 360, 480)
  `).run(id, general_id, channel, killed_at, killed_by || 'Anonim');

  const entry = db.prepare('SELECT * FROM general_status WHERE id = ?').get(id);

  broadcast({ type: 'GENERAL_KILLED', data: entry });
  res.json(entry);
});

// Remove/reset general status (when respawned or mistake)
app.delete('/api/generals/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM general_status WHERE id = ?').run(id);
  broadcast({ type: 'GENERAL_RESET', data: { id } });
  res.json({ ok: true });
});

// Auto-cleanup expired entries (older than 9 hours)
setInterval(() => {
  const cutoff = Date.now() - (9 * 60 * 60 * 1000);
  const deleted = db.prepare('DELETE FROM general_status WHERE killed_at < ?').run(cutoff);
  if (deleted.changes > 0) {
    broadcast({ type: 'CLEANUP', data: { removed: deleted.changes } });
  }
}, 60 * 1000);

// --- WebSocket ---
wss.on('connection', (ws) => {
  // Send current state on connect
  const rows = db.prepare('SELECT * FROM general_status ORDER BY killed_at DESC').all();
  ws.send(JSON.stringify({ type: 'INIT', data: rows }));

  ws.on('error', console.error);
});

// --- Serve frontend for all routes ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serwer działa na porcie ${PORT}`);
});
