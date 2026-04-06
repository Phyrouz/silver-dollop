const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_FILE = path.join(__dirname, 'data', 'cinema-data.json');

// CORS — allow GitHub Pages and local dev
app.use(cors({
  origin: [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3000',
    /\.github\.io$/
  ],
  methods: ['GET', 'PUT', 'POST', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));

// --- Helpers ---
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Error reading data file:', e.message);
    return {};
  }
}

function writeData(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// --- API Routes ---

// Get all data
app.get('/api/data', (req, res) => {
  res.json(readData());
});

// Replace all data (full sync from frontend)
app.put('/api/data', (req, res) => {
  const data = req.body;
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Invalid data' });
  }
  writeData(data);
  res.json({ ok: true, keys: Object.keys(data).length, timestamp: new Date().toISOString() });
});

// Get a single key
app.get('/api/key/:key', (req, res) => {
  const data = readData();
  const val = data[req.params.key];
  if (val === undefined) return res.status(404).json({ error: 'Key not found' });
  res.json({ key: req.params.key, value: val });
});

// Set a single key
app.put('/api/key/:key', (req, res) => {
  const data = readData();
  data[req.params.key] = req.body.value;
  writeData(data);
  res.json({ ok: true, key: req.params.key });
});

// Delete a single key
app.delete('/api/key/:key', (req, res) => {
  const data = readData();
  delete data[req.params.key];
  writeData(data);
  res.json({ ok: true, key: req.params.key });
});

// Health check
app.get('/api/health', (req, res) => {
  const data = readData();
  res.json({
    status: 'ok',
    keys: Object.keys(data).length,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Cinema Aggregator API running on http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
  if (!fs.existsSync(DATA_FILE)) {
    writeData({});
    console.log('Created empty data file.');
  } else {
    const data = readData();
    console.log(`Loaded ${Object.keys(data).length} keys from data file.`);
  }
});
