const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'data', 'cache.json');
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!GOOGLE_MAPS_API_KEY) {
  console.error('ERROR: GOOGLE_MAPS_API_KEY environment variable is not set');
  process.exit(1);
}
// Google returns Ireland's geographic centre when it cannot resolve an address
const IRELAND_CENTER = { lat: 53.77975, lng: -7.30553 };
const GEO_TOLERANCE = 0.01;

const SOURCES = [
  { tag: 84, label: 'Digs 5 Days', color: '#2563eb' },
  { tag: 61, label: 'Room in Owner Occupied House', color: '#16a34a' },
];

app.use(express.static(path.join(__dirname, 'public')));

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocodeQuery(query) {
  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
      params: { address: query, key: GOOGLE_MAPS_API_KEY },
      timeout: 10000,
    });
    if (data.status !== 'OK' || !data.results.length) return null;
    const { lat, lng } = data.results[0].geometry.location;
    const isIrelandCenter =
      Math.abs(lat - IRELAND_CENTER.lat) < GEO_TOLERANCE &&
      Math.abs(lng - IRELAND_CENTER.lng) < GEO_TOLERANCE;
    return isIrelandCenter ? null : { lat, lng };
  } catch (err) {
    console.error(`Geocode error for "${query}":`, err.message);
    return null;
  }
}

async function geocode(eircode, title) {
  if (eircode) {
    const r = await geocodeQuery(`${eircode}, Ireland`);
    if (r) return { ...r, method: 'eircode' };
  }
  const r = await geocodeQuery(`${title}, Ireland`);
  return r ? { ...r, method: 'address' } : null;
}

// ─── Scraping ─────────────────────────────────────────────────────────────────

function buildUrl(tag, page) {
  const qs = `?accommodation_tag=${tag}&price_sort=&lord_campus=Moylish`;
  return page === 1
    ? `https://tussu.ie/filter-result/${qs}`
    : `https://tussu.ie/filter-result/${page}/${qs}`;
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    headers: { 'User-Agent': 'TUS-Accommodation-Map/1.0 (student project)' },
    timeout: 20000,
  });
  return data;
}

function getLastPage($) {
  const nums = [];
  $('a.page-numbers').each((_, el) => {
    const n = parseInt($(el).text().replace(/\D/g, ''), 10);
    if (!isNaN(n)) nums.push(n);
  });
  return nums.length ? Math.max(...nums) : 1;
}

function parseCard($, el, label, color) {
  const card = $(el);
  const fullText = card.text();

  // Title: first span.elementor-icon-list-text that looks like an Irish address
  let title = '';
  card.find('span.elementor-icon-list-text').each((_, span) => {
    if (title) return;
    const t = $(span).text().trim().replace(/,+/g, ',').replace(/(^,|,$)/g, '');
    if (t.length > 8 && /[A-Z]\d{2}\s?[A-Z0-9]{4}/i.test(t)) title = t;
  });
  if (!title) return null;

  // URL to individual listing
  const url = card.find('a[href*="accommodation-listin"]').first().attr('href') || '';

  // Eircode: last comma-separated segment
  const lastSeg = title.split(',').pop().trim();
  const eircodeM = lastSeg.match(/^([A-Z]\d{2}\s?[A-Z0-9]{4})$/i);
  const eircode = eircodeM ? eircodeM[1].replace(/\s/g, '').toUpperCase() : '';

  // Beds
  const bedsM = fullText.match(/Bed\/s:\s*(\d+)/i);

  // Prices
  const weeklyM = fullText.match(/Weekly Pay:\s*€([\d,]+\.?\d*)/);
  const monthlyM = fullText.match(/Monthly Pay:\s*€([\d,]+\.?\d*)/);
  const depositAll = [...fullText.matchAll(/Deposit:\s*€([\d,]+\.?\d*)/g)];

  return {
    title,
    eircode,
    beds: bedsM ? parseInt(bedsM[1], 10) : null,
    weekly: weeklyM ? parseFloat(weeklyM[1].replace(',', '')) : null,
    monthly: monthlyM ? parseFloat(monthlyM[1].replace(',', '')) : null,
    weeklyDeposit: depositAll[0] ? parseFloat(depositAll[0][1].replace(',', '')) : null,
    monthlyDeposit: depositAll[1] ? parseFloat(depositAll[1][1].replace(',', '')) : null,
    url,
    type: label,
    color,
    lat: null,
    lng: null,
    geocodeMethod: null,
  };
}

function parsePageListings(html, label, color) {
  const $ = cheerio.load(html);
  const listings = [];
  $('[data-elementor-type="loop-item"].accommodation-listin').each((_, el) => {
    const listing = parseCard($, el, label, color);
    if (listing) listings.push(listing);
  });
  return { $, listings };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchHtml(url);
    } catch (err) {
      const msg = err?.message || String(err);
      console.warn(`  [warn] fetch attempt ${attempt}/${retries} failed for ${url}: ${msg}`);
      if (attempt < retries) await sleep(2000 * attempt);
      else throw err;
    }
  }
}

async function scrapeAll() {
  const all = [];

  for (const src of SOURCES) {
    console.log(`\n[scrape] tag=${src.tag} (${src.label})`);
    const html1 = await fetchWithRetry(buildUrl(src.tag, 1));
    const { $, listings: page1 } = parsePageListings(html1, src.label, src.color);
    all.push(...page1);

    const lastPage = getLastPage($);
    console.log(`  pages: ${lastPage}, page 1: ${page1.length} listings`);

    for (let p = 2; p <= lastPage; p++) {
      await sleep(1000);
      try {
        const html = await fetchWithRetry(buildUrl(src.tag, p));
        const { listings } = parsePageListings(html, src.label, src.color);
        all.push(...listings);
        console.log(`  page ${p}/${lastPage}: ${listings.length} listings`);
      } catch (err) {
        console.error(`  [error] skipping page ${p}/${lastPage}: ${err?.stack || err}`);
      }
    }
  }

  console.log(`\n[geocode] ${all.length} listings total`);

  // Deduplicate by URL (a listing may appear under both tags)
  const seen = new Set();
  const unique = all.filter(l => {
    if (!l.url || seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });

  console.log(`  unique: ${unique.length} (removed ${all.length - unique.length} duplicates)`);

  for (let i = 0; i < unique.length; i++) {
    const listing = unique[i];
    await sleep(100); // ~10 req/s to Google Maps
    const coords = await geocode(listing.eircode, listing.title);
    if (coords) {
      listing.lat = coords.lat;
      listing.lng = coords.lng;
      listing.geocodeMethod = coords.method;
    }
    if ((i + 1) % 25 === 0 || i + 1 === unique.length) {
      const done = unique.filter(l => l.lat !== null).length;
      console.log(`  geocoded ${i + 1}/${unique.length} (${done} successful)`);
    }
  }

  return unique;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(listings) {
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    count: listings.length,
    geocoded: listings.filter(l => l.lat !== null).length,
    listings,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload));
  console.log(`[cache] Saved ${payload.count} listings (${payload.geocoded} geocoded)`);
}

// ─── Refresh management ───────────────────────────────────────────────────────

let refreshPromise = null;

function startRefresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = scrapeAll()
    .then(listings => {
      writeCache(listings);
      refreshPromise = null;
    })
    .catch(err => {
      console.error('[refresh] Failed:', err?.stack || String(err));
      refreshPromise = null;
    });
  return refreshPromise;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/listings', async (req, res) => {
  const cache = readCache();

  if (!cache) {
    console.log('[api] No cache — waiting for initial scrape');
    await startRefresh();
    const fresh = readCache();
    if (!fresh) return res.status(503).json({ error: 'Data unavailable, scrape in progress' });
    return res.json({ ...fresh, stale: false, refreshing: false });
  }

  const ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
  const stale = ageMs >= CACHE_TTL_MS;

  if (stale && !refreshPromise) {
    console.log(`[api] Cache is ${Math.round(ageMs / 60000)}m old — triggering background refresh`);
    startRefresh();
  }

  res.json({ ...cache, stale, refreshing: !!refreshPromise });
});

app.get('/api/status', (_, res) => {
  const cache = readCache();
  const ageMs = cache ? Date.now() - new Date(cache.fetchedAt).getTime() : null;
  res.json({
    fetchedAt: cache?.fetchedAt ?? null,
    count: cache?.count ?? 0,
    geocoded: cache?.geocoded ?? 0,
    stale: ageMs !== null ? ageMs >= CACHE_TTL_MS : true,
    refreshing: !!refreshPromise,
  });
});

app.post('/api/refresh', (_, res) => {
  refreshPromise = null;
  startRefresh();
  res.json({ ok: true, message: 'Refresh started in background' });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`TUS Accommodation Map → http://localhost:${PORT}`);
  if (!readCache()) {
    console.log('[boot] No cache — starting initial scrape (this takes a few minutes)');
    startRefresh();
  } else {
    const cache = readCache();
    const ageMin = Math.round((Date.now() - new Date(cache.fetchedAt).getTime()) / 60000);
    console.log(`[boot] Cache loaded: ${cache.count} listings, ${ageMin}m old`);
  }
});
