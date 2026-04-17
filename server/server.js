const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
// Node 18+ has fetch built-in — no node-fetch needed

const app = express();
const PORT = process.env.PORT || 3002;
const DATA_DIR = path.join(__dirname, 'data');

// Supported apps and their data files
const APPS = {
  cinema: path.join(DATA_DIR, 'cinema-data.json'),
  modelbook: path.join(DATA_DIR, 'modelbook-data.json')
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

// --- Curzon scraper ---
const CURZON_VENUES = {
  'curzon-soho':     { name: 'Curzon Soho',     url: 'https://www.curzon.com/venue/curzon-soho/' },
  'curzon-victoria': { name: 'Curzon Victoria', url: 'https://www.curzon.com/venue/curzon-victoria/' }
};

const MONTH_NAMES = {
  january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
  july:'07',august:'08',september:'09',october:'10',november:'11',december:'12',
  jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
  jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'
};

function parseDate(txt) {
  // "Friday 18 April" / "18 April" / "18th April 2026"
  const m = txt.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?/);
  if (!m) return null;
  const mon = MONTH_NAMES[m[2].toLowerCase()];
  if (!mon) return null;
  const year = m[3] || new Date().getFullYear();
  return `${year}-${mon}-${m[1].padStart(2,'0')}`;
}

async function scrapeCurzonVenue(venueSlug) {
  const venue = CURZON_VENUES[venueSlug];
  if (!venue) throw new Error('Unknown venue: ' + venueSlug);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Referer': 'https://www.curzon.com/'
  };

  // Step 1: fetch venue page to get film slugs
  const venueResp = await fetch(venue.url, { headers });
  if (!venueResp.ok) throw new Error(`Venue page HTTP ${venueResp.status}`);
  const venueHtml = await venueResp.text();

  // Extract film hrefs: /films/slug/ or /film/slug/
  const filmSlugs = new Map();
  const hrefRe = /href="(\/films?\/([a-z0-9\-]+)\/?)"/gi;
  let hm;
  while ((hm = hrefRe.exec(venueHtml)) !== null) {
    const href = hm[1];
    const slug = hm[2];
    if (!filmSlugs.has(slug) && slug !== 'index' && slug.length > 2) {
      filmSlugs.set(slug, href);
    }
  }

  if (!filmSlugs.size) throw new Error('No film links found on venue page — site structure may have changed');

  const films = [];
  const baseUrl = 'https://www.curzon.com';

  // Step 2: fetch each film page
  for (const [slug, href] of filmSlugs) {
    try {
      await new Promise(r => setTimeout(r, 200)); // polite delay
      const filmResp = await fetch(baseUrl + href, { headers });
      if (!filmResp.ok) continue;
      const filmHtml = await filmResp.text();

      // Title: <h1 ...>Title</h1>
      const titleM = filmHtml.match(/<h1[^>]*>([^<]{2,100})<\/h1>/i);
      if (!titleM) continue;
      const title = titleM[1].replace(/&amp;/g,'&').replace(/&#039;/g,"'").replace(/&quot;/g,'"').trim();
      if (title.length < 2 || /^(films|home|book)/i.test(title)) continue;

      // Director
      let director = '';
      const dirM = filmHtml.match(/(?:Director|Directed by)[:\s]+([A-Z][^<\n,]{2,50})/i);
      if (dirM) director = dirM[1].trim();

      // Year
      let year = '';
      const yearM = filmHtml.match(/\b(19|20)\d{2}\b/);
      if (yearM) year = yearM[0];

      // Duration
      let duration = '';
      const durM = filmHtml.match(/(\d{2,3})\s*mins?/i);
      if (durM) duration = durM[1] + 'min';

      // Summary: first long <p>
      let summary = '';
      const pRe = /<p[^>]*>([^<]{80,1000})<\/p>/gi;
      let pm;
      while ((pm = pRe.exec(filmHtml)) !== null) {
        const t = pm[1].replace(/<[^>]+>/g,'').trim();
        if (t.length > 80 && !summary) { summary = t; break; }
      }

      // Showtimes: look for date headings + time buttons
      // Curzon pattern: data-time="2026-04-18T20:30:00" or date+time near booking buttons
      const showtimes = [];
      const dtRe = /data-(?:showtime|time|date-time)="(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})"/gi;
      let dtm;
      while ((dtm = dtRe.exec(filmHtml)) !== null) {
        const [datePart, timePart] = dtm[1].split('T');
        const time = timePart.substring(0,5);
        if (!showtimes.some(s => s.date === datePart && s.time === time)) {
          showtimes.push({ date: datePart, time, format: 'Digital' });
        }
      }

      // Fallback: scan for date text + nearby HH:MM patterns
      if (!showtimes.length) {
        const lines = filmHtml.split(/\n/);
        let currentDate = '';
        for (const line of lines) {
          const stripped = line.replace(/<[^>]+>/g, ' ').trim();
          const d = parseDate(stripped);
          if (d && stripped.length < 60) currentDate = d;
          if (currentDate) {
            const times = stripped.match(/\b(\d{1,2}:\d{2})\b/g);
            if (times) {
              times.forEach(t => {
                if (!showtimes.some(s => s.date === currentDate && s.time === t)) {
                  showtimes.push({ date: currentDate, time: t, format: 'Digital' });
                }
              });
            }
          }
        }
      }

      films.push({
        title, director, year, duration, summary,
        venue: venue.name,
        genre: 'Drama',
        showtimes: showtimes.length ? showtimes : [{ date: '', time: 'Various', format: 'Digital' }]
      });

    } catch(e) {
      console.error('Curzon film error:', slug, e.message);
    }
  }

  return films;
}

app.get('/api/curzon/:venue', async (req, res) => {
  try {
    const films = await scrapeCurzonVenue(req.params.venue);
    res.json({ ok: true, venue: req.params.venue, count: films.length, films });
  } catch(e) {
    res.status(500).json({ ok: false, error: e.message });
  }
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
