import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fetch from 'node-fetch';
import { load } from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = Number(process.env.PORT) || 3000;
const SCRAPER_USER_AGENT = 'geo-activities-app/1.0 (+local dev)';
const berlinEventDetailsCache = new Map();
const addressCoordinatesCache = new Map();
const apiResponseCache = new Map();
const rateLimitStore = new Map();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_TTL_MS = {
  geocode: 1000 * 60 * 60 * 24,
  events: 1000 * 60 * 15,
  weather: 1000 * 60 * 10,
  places: 1000 * 60 * 30
};
const RATE_LIMIT_WINDOW_MS = 1000 * 60;
const RATE_LIMIT_MAX_REQUESTS = 30;
const MAX_LOCATION_QUERY_LENGTH = 120;

const BERLIN_DE_SOURCES = [
  {
    url: 'https://www.berlin.de/en/tickets/today/',
    fallbackDate: 'Today'
  },
  {
    url: 'https://www.berlin.de/en/tickets/tomorrow/',
    fallbackDate: 'Tomorrow'
  }
];

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function normalizeText(value) {
  return value?.replace(/\s+/g, ' ').trim() || '';
}

function parseLumaEventUrls() {
  return (process.env.LUMA_EVENT_URLS || '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}

function getCachedValue(cacheKey) {
  const entry = apiResponseCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (Date.now() > entry.expiresAt) {
    apiResponseCache.delete(cacheKey);
    return null;
  }

  return entry.value;
}

function setCachedValue(cacheKey, value, ttlMs) {
  apiResponseCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

function cleanupRateLimitStore(now) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function applyRateLimit(req, res, keyPrefix) {
  const now = Date.now();
  cleanupRateLimitStore(now);

  const clientIp = getClientIp(req);
  const key = `${keyPrefix}:${clientIp}`;
  const existingEntry = rateLimitStore.get(key);

  if (!existingEntry || now > existingEntry.resetAt) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return true;
  }

  if (existingEntry.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((existingEntry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Too many requests',
      details: 'Please wait a minute and try again.'
    });
    return false;
  }

  existingEntry.count += 1;
  return true;
}

function normalizeLocationInput(value) {
  return normalizeText(value?.toString() || '').slice(0, MAX_LOCATION_QUERY_LENGTH);
}

function parseCoordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidLatitude(value) {
  return value !== null && value >= -90 && value <= 90;
}

function isValidLongitude(value) {
  return value !== null && value >= -180 && value <= 180;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': SCRAPER_USER_AGENT
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function geocodeAddress(query) {
  const apiKey = process.env.OPENCAGE_API_KEY;

  if (!apiKey || !query) {
    return null;
  }

  if (addressCoordinatesCache.has(query)) {
    return addressCoordinatesCache.get(query);
  }

  const url = new URL('https://api.opencagedata.com/geocode/v1/json');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('limit', '1');

  try {
    const response = await fetch(url);
    const data = await response.json();
    const coordinates = data.results?.[0]?.geometry
      ? {
          lat: Number(data.results[0].geometry.lat),
          lng: Number(data.results[0].geometry.lng)
        }
      : null;

    addressCoordinatesCache.set(query, coordinates);
    return coordinates;
  } catch (error) {
    console.error('Address geocoding error:', error);
    return null;
  }
}

async function fetchBerlinDeEventDetails(url) {
  if (berlinEventDetailsCache.has(url)) {
    return berlinEventDetailsCache.get(url);
  }

  const detailsPromise = (async () => {
    const html = await fetchHtml(url);
    const $ = load(html);
    const rawJsonLd = $('script[type="application/ld+json"]').first().html();
    let location = null;

    if (rawJsonLd) {
      try {
        const data = JSON.parse(rawJsonLd);
        location = data.location || null;
      } catch (error) {
        console.error('Berlin.de JSON-LD parse error:', error);
      }
    }

    const mapTitle = normalizeText(
      $('h3.title').filter((_, el) => $(el).text().toLowerCase().includes('on the map')).first().text()
    ).replace(/\s+on the map$/i, '');
    const streetAddress = normalizeText($('.street-address').first().text());
    const locationBlock = normalizeText($('.location-publictransport').first().text());
    const addressText = streetAddress || (
      locationBlock.match(/Address\s+(.+?)\s+City map/i)?.[1]?.trim() || ''
    );

    let coordinates = null;
    if (location?.geo?.latitude && location?.geo?.longitude) {
      coordinates = {
        lat: Number(location.geo.latitude),
        lng: Number(location.geo.longitude)
      };
    } else if (addressText) {
      coordinates = await geocodeAddress(`${addressText}, Berlin, Germany`);
    }

    return {
      venue: normalizeText(location?.name || mapTitle || 'Berlin'),
      address: normalizeText(
        [
          location?.address?.streetAddress,
          location?.address?.postalCode,
          location?.address?.addressLocality
        ].filter(Boolean).join(', ') || addressText
      ),
      coordinates
    };
  })();

  berlinEventDetailsCache.set(url, detailsPromise);
  return detailsPromise;
}

async function fetchBerlinDeEvents() {
  const results = [];

  for (const source of BERLIN_DE_SOURCES) {
    try {
      const html = await fetchHtml(source.url);
      const $ = load(html);
      const items = [];

      $('h3 a').each((_, element) => {
        if (items.length >= 6) {
          return false;
        }

        const href = $(element).attr('href');
        const name = normalizeText($(element).text());

        if (!href || !name) {
          return;
        }

        const absoluteUrl = new URL(href, source.url).toString();

        if (
          absoluteUrl.includes('/today/') ||
          absoluteUrl.includes('/tomorrow/') ||
          absoluteUrl.includes('/weekend/') ||
          absoluteUrl.includes('/events/') && !absoluteUrl.includes('/tickets/') && !absoluteUrl.includes('/shopping/')
        ) {
          return;
        }

        const card = $(element).closest('h3').parent();
        const dateText = normalizeText(card.find('.teaser__meta').first().text()) || source.fallbackDate;
        const description = normalizeText(
          card.find('.inner .text, p.text').first().text().replace(/\s*more\s*$/i, '')
        );

        items.push({
          name,
          dateText,
          venue: 'Berlin',
          source: 'Berlin.de',
          url: absoluteUrl,
          description
        });
      });

      results.push(...items);
    } catch (error) {
      console.error(`Berlin.de source fetch error for ${source.url}:`, error);
    }
  }

  const enriched = [];
  const detailBatchSize = 3;

  for (let index = 0; index < results.length; index += detailBatchSize) {
    const batch = results.slice(index, index + detailBatchSize);
    const batchResults = await Promise.all(
      batch.map(async (event) => {
        try {
          const details = await fetchBerlinDeEventDetails(event.url);
          return {
            ...event,
            venue: details.venue || event.venue,
            address: details.address || '',
            coordinates: details.coordinates || null
          };
        } catch (error) {
          console.error('Berlin.de detail fetch error:', error);
          return {
            ...event,
            address: '',
            coordinates: null
          };
        }
      })
    );

    enriched.push(...batchResults);
  }

  return enriched;
}

async function fetchLumaEvents(city) {
  const lumaUrls = parseLumaEventUrls();
  const now = Date.now();

  if (lumaUrls.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    lumaUrls.map(async (url) => {
      const html = await fetchHtml(url);
      const $ = load(html);
      const jsonLd = $('script[type="application/ld+json"]').first().html();

      if (!jsonLd) {
        throw new Error(`Missing structured event data for ${url}`);
      }

      const eventData = JSON.parse(jsonLd);
      const locality = normalizeText(eventData.location?.address?.addressLocality);

      if (city && locality && locality.toLowerCase() !== city.toLowerCase()) {
        return null;
      }

      if (eventData.startDate && Date.parse(eventData.startDate) < now) {
        return null;
      }

      return {
        name: normalizeText(eventData.name),
        dateText: eventData.startDate
          ? new Date(eventData.startDate).toLocaleString('en-GB', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'Date unavailable',
        venue: normalizeText(eventData.location?.name || locality || 'Venue unavailable'),
        source: 'Luma',
        url,
        description: normalizeText(eventData.description),
        startAt: eventData.startDate || null,
        coordinates: eventData.location?.geo?.latitude && eventData.location?.geo?.longitude
          ? {
              lat: Number(eventData.location.geo.latitude),
              lng: Number(eventData.location.geo.longitude)
            }
          : null
      };
    })
  );

  return settled
    .filter((item) => item.status === 'fulfilled' && item.value)
    .map((item) => item.value);
}

app.get('/api/geocode', async (req, res) => {
  const apiKey = process.env.OPENCAGE_API_KEY;
  const city = normalizeLocationInput(req.query.city);
  const country = normalizeLocationInput(req.query.country);

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenCage API key' });
  }

  if (!applyRateLimit(req, res, 'geocode')) {
    return;
  }

  if (!city || !country) {
    return res.status(400).json({ error: 'City and country are required' });
  }

  const url = new URL('https://api.opencagedata.com/geocode/v1/json');
  url.searchParams.set('q', `${city}, ${country}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('limit', '1');
  const cacheKey = `geocode:${city.toLowerCase()}:${country.toLowerCase()}`;

  try {
    const cachedResponse = getCachedValue(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.status?.code !== 200) {
      return res.status(response.status || data.status?.code || 500).json({
        error: 'Failed to geocode location',
        details: data.status?.message || 'Unknown OpenCage error',
        status: data.status || null
      });
    }

    if (!Array.isArray(data.results) || data.results.length === 0) {
      return res.status(404).json({
        error: 'Location not found',
        details: 'OpenCage returned no matching results'
      });
    }

    const payload = {
      formatted: data.results[0].formatted,
      geometry: data.results[0].geometry
    };

    setCachedValue(cacheKey, payload, CACHE_TTL_MS.geocode);
    res.json(payload);
  } catch (error) {
    console.error('OpenCage error:', error);
    res.status(500).json({ error: 'Failed to geocode location' });
  }
});

app.get('/api/events', async (req, res) => {
  const city = normalizeText(req.query.city?.toString() || '');
  const cacheKey = `events:${city.toLowerCase() || 'berlin'}`;

  try {
    if (city && city.toLowerCase() !== 'berlin') {
      return res.json({
        results: [],
        warning: 'Event scraping is currently configured for Berlin only.'
      });
    }

    const cachedResponse = getCachedValue(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const [berlinDeEventsResult, lumaEventsResult] = await Promise.allSettled([
      fetchBerlinDeEvents(),
      fetchLumaEvents(city || 'Berlin')
    ]);

    const berlinDeEvents = berlinDeEventsResult.status === 'fulfilled' ? berlinDeEventsResult.value : [];
    const lumaEvents = lumaEventsResult.status === 'fulfilled' ? lumaEventsResult.value : [];
    const warnings = [];

    if (berlinDeEventsResult.status === 'rejected') {
      console.error('Berlin.de aggregation error:', berlinDeEventsResult.reason);
      warnings.push('Some Berlin.de events could not be loaded right now.');
    }

    if (lumaEventsResult.status === 'rejected') {
      console.error('Luma aggregation error:', lumaEventsResult.reason);
      warnings.push('Some Luma events could not be loaded right now.');
    }

    const payload = {
      results: [...lumaEvents, ...berlinDeEvents],
      warning: warnings.length > 0 ? warnings.join(' ') : undefined
    };

    setCachedValue(cacheKey, payload, CACHE_TTL_MS.events);
    res.json(payload);
  } catch (error) {
    console.error('Event scraping error:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

app.get('/api/maps-config', (req, res) => {
  res.json({
    browserApiKey: process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
    mapId: process.env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
    defaultCenter: {
      lat: 52.52,
      lng: 13.405
    }
  });
});

app.get('/api/weather', async (req, res) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat = parseCoordinate(req.query.lat);
  const lon = parseCoordinate(req.query.lon);

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenWeather API key' });
  }

  if (!applyRateLimit(req, res, 'weather')) {
    return;
  }

  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }

  const url = new URL('https://api.openweathermap.org/data/2.5/forecast');
  url.searchParams.set('lat', lat.toString());
  url.searchParams.set('lon', lon.toString());
  url.searchParams.set('appid', apiKey);
  url.searchParams.set('units', 'metric');
  const cacheKey = `weather:${lat.toFixed(3)}:${lon.toFixed(3)}`;

  try {
    const cachedResponse = getCachedValue(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data.message || 'Failed to fetch weather'
      });
    }

    setCachedValue(cacheKey, data, CACHE_TTL_MS.weather);
    res.json(data);
  } catch (error) {
    console.error('OpenWeather error:', error);
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
});

app.get('/api/search', async (req, res) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const latitude = parseCoordinate(req.query.lat);
  const longitude = parseCoordinate(req.query.lon);

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing Google Maps API key' });
  }

  if (!applyRateLimit(req, res, 'places')) {
    return;
  }

  if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) {
    return res.status(400).json({ error: 'Valid latitude and longitude are required' });
  }

  const cacheKey = `places:${latitude.toFixed(3)}:${longitude.toFixed(3)}`;

  try {
    const cachedResponse = getCachedValue(cacheKey);

    if (cachedResponse) {
      return res.json(cachedResponse);
    }

    const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.shortFormattedAddress,places.location'
      },
      body: JSON.stringify({
        includedTypes: ['tourist_attraction'],
        maxResultCount: 10,
        rankPreference: 'POPULARITY',
        locationRestriction: {
          circle: {
            center: {
              latitude,
              longitude
            },
            radius: 1500
          }
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Places API error:', response.status, errorText);
      return res.status(response.status).json({
        error: 'Failed to fetch places',
        details: errorText
      });
    }

    const placesApiData = await response.json();
    const results = (placesApiData.places || []).map((place) => ({
      name: place.displayName?.text || 'Unknown place',
      vicinity: place.shortFormattedAddress || place.formattedAddress || '',
      coordinates: place.location?.latitude && place.location?.longitude
        ? {
            lat: Number(place.location.latitude),
            lng: Number(place.location.longitude)
          }
        : null
    }));

    const payload = { results };
    setCachedValue(cacheKey, payload, CACHE_TTL_MS.places);
    res.json(payload);
  } catch (error) {
    console.error('Places API error:', error);
    res.status(500).json({ error: 'Failed to fetch places' });
  }
});

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}`);
  });
}

export default app;
