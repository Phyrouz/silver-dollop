const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_DIR = path.join(__dirname, 'data');

// Supported apps and their data files
const APPS = {
  cinema: path.join(DATA_DIR, 'cinema-data.json'),
  modelbook: path.join(DATA_DIR, 'modelbook-data.json')
  portfolio: path.join(DATA_DIR, 'portfolio-data.json')
};

// CORS — allow GitHub Pages and local dev
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    'https://phyrouz.github.io',
    /\.github\.io$/
  ],
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// 50mb limit for modelbook (photos are base64)
app.use(express.json({ limit: '50mb' }));

// --- Helpers ---
function getDataFile(app) {
  return APPS[app] || APPS.cinema;
}

function readData(appName) {
  const file = getDataFile(appName);
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Error reading ' + appName + ':', e.message);
    return {};
  }
}

function writeData(appName, data) {
  const file = getDataFile(appName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// --- API Routes (app-scoped: /api/:app/data) ---

// Get all data for an app
app.get('/api/:app/data', (req, res) => {
  res.json(readData(req.params.app));
});

// Replace all data for an app
app.put('/api/:app/data', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid data' });
  }
  writeData(req.params.app, data);
  res.json({ ok: true, app: req.params.app, keys: Object.keys(data).length, timestamp: new Date().toISOString() });
});

// Get a single key for an app
app.get('/api/:app/key/:key', (req, res) => {
  const data = readData(req.params.app);
  const val = data[req.params.key];
  if (val === undefined) return res.status(404).json({ error: 'Key not found' });
  res.json({ key: req.params.key, value: val });
});

// Set a single key for an app
app.put('/api/:app/key/:key', (req, res) => {
  const data = readData(req.params.app);
  data[req.params.key] = req.body.value;
  writeData(req.params.app, data);
  res.json({ ok: true, key: req.params.key });
});

// Delete a single key for an app
app.delete('/api/:app/key/:key', (req, res) => {
  const data = readData(req.params.app);
  delete data[req.params.key];
  writeData(req.params.app, data);
  res.json({ ok: true, key: req.params.key });
});

// --- Legacy routes (backwards compatible with cinema frontend) ---
app.get('/api/data', (req, res) => { res.json(readData('cinema')); });
app.put('/api/data', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data' });
  writeData('cinema', data);
  res.json({ ok: true, keys: Object.keys(data).length, timestamp: new Date().toISOString() });
});

// Health check
app.get('/api/health', (req, res) => {
  const status = {};
  Object.keys(APPS).forEach(a => {
    const d = readData(a);
    status[a] = Object.keys(d).length + ' keys';
  });
  res.json({ status: 'ok', apps: status, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Multi-App API running on http://localhost:${PORT}`);
  console.log(`Apps: ${Object.keys(APPS).join(', ')}`);
  Object.entries(APPS).forEach(([name, file]) => {
    if (!fs.existsSync(file)) {
      writeData(name, {});
      console.log(`Created empty ${name} data file.`);
    } else {
      const d = readData(name);
      console.log(`${name}: ${Object.keys(d).length} keys`);
    }
  });
});
