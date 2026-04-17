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
    console.error('Curzon scrape error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Curzon diagnostic — check what status code we get from their site
app.get('/api/curzon-test', async (req, res) => {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9'
    };
    const testHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/html, */*',
      'Accept-Language': 'en-GB,en;q=0.9'
    };
    const results = [];

    const allUrls = [
      // Flicks
      { label: 'flicks-soho',      url: 'https://www.flicks.co.uk/cinema/curzon-soho/' },
      { label: 'flicks-victoria',  url: 'https://www.flicks.co.uk/cinema/curzon-victoria/' },
      // IMDB
      { label: 'imdb-soho',        url: 'https://www.imdb.com/showtimes/cinema/UK/ci0959606/' },
      { label: 'imdb-victoria',    url: 'https://www.imdb.com/showtimes/cinema/UK/ci0962498/' },
      // Timeout
      { label: 'timeout-soho',     url: 'https://www.timeout.com/london/cinemas/curzon-soho' },
      { label: 'timeout-victoria', url: 'https://www.timeout.com/london/cinemas/curzon-victoria' },
      // Cinelist
      { label: 'cinelist-soho',    url: 'https://www.cinelist.co.uk/cinema/curzon-soho/' },
      { label: 'cinelist-victoria',url: 'https://www.cinelist.co.uk/cinema/curzon-victoria/' },
      // Cinelist alternative slugs
      { label: 'cinelist-soho-alt',     url: 'https://www.cinelist.co.uk/cinemas/london/curzon-soho/' },
      { label: 'cinelist-victoria-alt', url: 'https://www.cinelist.co.uk/cinemas/london/curzon-victoria/' },
      // Flicks alternative Victoria slugs
      { label: 'flicks-victoria-pimlico', url: 'https://www.flicks.co.uk/cinema/curzon-victoria-pimlico/' },
      { label: 'flicks-victoria-london',  url: 'https://www.flicks.co.uk/cinema/curzon-victoria-london/' },
      // Google Knowledge Graph structured data
      { label: 'google-soho',     url: 'https://www.google.com/search?q=Curzon+Soho+showtimes&hl=en' },
    ];

    const patterns = [
      /href="[^"]*\/film\/([^"?]+)"[^>]*>\s*([^<]{2,80})\s*</gi,
      /href="[^"]*\/movie\/([^"?]+)"[^>]*>\s*([^<]{2,80})\s*</gi,
      /href="[^"]*\/movies\/([^"?]+)"[^>]*>\s*([^<]{2,80})\s*</gi,
      /"title"\s*:\s*"([^"]{2,80})"/gi,
      /itemprop="name"[^>]*>\s*([^<]{2,80})\s*</gi,
      /class="[^"]*film[^"]*title[^"]*"[^>]*>\s*([^<]{2,80})\s*</gi,
      /class="[^"]*movie[^"]*title[^"]*"[^>]*>\s*([^<]{2,80})\s*</gi,
      /"name"\s*:\s*"([^"]{2,80})"/gi,
      /data-film-title="([^"]{2,80})"/gi,
      /data-title="([^"]{2,80})"/gi,
      /<h2[^>]*>\s*([^<]{2,80})\s*<\/h2>/gi,
      /<h3[^>]*>\s*([^<]{2,80})\s*<\/h3>/gi,
    ];
    const stopWords = /cookie|privacy|menu|search|sign|login|newsletter|about|contact|home|back|next|prev|more|see all|what's on|javascript|loading/i;

    function extractFilms(text) {
      const films = new Set();
      for (const re of patterns) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const t = (m[2] || m[1]).trim().replace(/&amp;/g,'&').replace(/&#039;/g,"'");
          if (t.length > 2 && t.length < 80 && !stopWords.test(t)) films.add(t);
        }
      }
      const times = (text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || []).filter(t => !['00:00','01:00','00:01'].includes(t)).slice(0,15);
      return { films: [...films].slice(0,20), times };
    }

    // Find showtime image URLs from Curzon page
    try {
      const r = await fetch('https://www.curzon.com/venue/curzon-soho-cinema/', { headers: testHeaders });
      const text = await r.text();
      // Find all img tags and their src/alt attributes
      const imgRe = /<img[^>]+src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>/gi;
      const imgs = [];
      let im;
      while ((im = imgRe.exec(text)) !== null) {
        imgs.push({ src: im[1], alt: im[2] || '' });
      }
      // Also find any img with time-like alt text or src containing time/showtime
      const timeImgs = imgs.filter(i => /\d{1,2}[:\.]\d{2}|showtime|time|session/i.test(i.src + i.alt));
      results.push({ label: 'curzon-images', total: imgs.length, timeImgs, allImgSample: imgs.slice(0,20) });
    } catch(e) { results.push({ label: 'curzon-images', error: e.message }); }

    // Check for embedded JSON data in the Curzon page (Next.js / React SSR)
    try {
      const r = await fetch('https://www.curzon.com/films/', { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' } });
      const text = await r.text();
      // Next.js embeds all page data in __NEXT_DATA__
      const nextData = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      // Also check window.__data__, window.__STATE__, __INITIAL_STATE__
      const windowData = text.match(/window\.__(?:data|state|DATA|STATE|INITIAL_STATE)__\s*=\s*(\{[\s\S]{0,5000})/i);
      const inlineJson = text.match(/<script[^>]*>\s*(\{"films|"showings|"performances|"screenings)([\s\S]{0,3000})/i);
      results.push({
        label: 'curzon-next-data',
        hasNextData: !!nextData,
        nextDataSnippet: nextData ? nextData[1].substring(0, 1000) : null,
        hasWindowData: !!windowData,
        windowDataSnippet: windowData ? windowData[1].substring(0, 500) : null,
        hasInlineJson: !!inlineJson,
        inlineJsonSnippet: inlineJson ? inlineJson[0].substring(0, 500) : null,
      });
    } catch(e) { results.push({ label: 'curzon-next-data', error: e.message }); }

    const lastChanceUrls = [
      // Curzon RSS/XML feeds
      { label: 'curzon-rss',         url: 'https://www.curzon.com/feed/' },
      { label: 'curzon-rss2',        url: 'https://www.curzon.com/rss/' },
      { label: 'curzon-xml',         url: 'https://www.curzon.com/films/feed/' },
      // Curzon app API (mobile apps often use a public JSON API)
      { label: 'curzon-app-api',     url: 'https://api.curzon.com/v1/films' },
      { label: 'curzon-app-api2',    url: 'https://app.curzon.com/api/films' },
      // View-source of Curzon with different accept headers to get SSR content
      { label: 'curzon-ssr',         url: 'https://www.curzon.com/films/', headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)', 'Accept': 'text/html' } },
      // Whats-on aggregators
      { label: 'ents24-soho',        url: 'https://www.ents24.com/london/cinema/curzon-soho' },
      { label: 'ents24-victoria',    url: 'https://www.ents24.com/london/cinema/curzon-victoria' },
      { label: 'designmynight-soho', url: 'https://www.designmynight.com/london/cinema/soho/curzon-soho' },
      // Curzon direct with Googlebot UA
      { label: 'curzon-soho-googlebot', url: 'https://www.curzon.com/venue/curzon-soho/', headers: { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } },
    ];

    const allResults = await Promise.all(lastChanceUrls.map(async ({ label, url, headers: extraHeaders }) => {
      try {
        const h = extraHeaders ? { ...testHeaders, ...extraHeaders } : testHeaders;
        const r = await fetch(url, { headers: h });
        const text = await r.text();
        const { films, times } = extractFilms(text);
        // Also check for raw JSON
        let json = null;
        try { json = JSON.parse(text); } catch(e) {}
        return { label, status: r.status, bodyLength: text.length, films, times, isJson: !!json, jsonSnippet: json ? JSON.stringify(json).substring(0,300) : null };
      } catch(e) {
        return { label, url, error: e.message };
      }
    }));

    res.json(allResults);
  } catch(e) {
    res.json({ error: e.message });
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
