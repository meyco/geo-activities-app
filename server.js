import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fetch from 'node-fetch';
const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/api/geocode', async (req, res) => {
  const apiKey = process.env.OPENCAGE_API_KEY;
  const city = req.query.city?.toString().trim();
  const country = req.query.country?.toString().trim();

  if (!apiKey) {
    return res.status(500).json({ error: 'Missing OpenCage API key' });
  }

  if (!city || !country) {
    return res.status(400).json({ error: 'City and country are required' });
  }

  const url = new URL('https://api.opencagedata.com/geocode/v1/json');
  url.searchParams.set('q', `${city}, ${country}`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('limit', '1');

  try {
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

    res.json({
      formatted: data.results[0].formatted,
      geometry: data.results[0].geometry
    });
  } catch (error) {
    console.error('OpenCage error:', error);
    res.status(500).json({ error: 'Failed to geocode location' });
  }
});

//Eventbrite api
app.get('/api/events', async (req, res) => {
  const EVENT_BRITE_API_KEY = process.env.EVENT_BRITE_API_KEY; // .envに保存しておく
  const { lat, lon, within = "10km" } = req.query;

console.log("API KEY:", process.env.EVENT_BRITE_API_KEY);


  const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
  url.searchParams.set("location.latitude", lat);
  url.searchParams.set("location.longitude", lon);
  url.searchParams.set("location.within", within);
  url.searchParams.set("sort_by", "date");

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${EVENT_BRITE_API_KEY}` }
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        error: data.error || 'Failed to fetch events',
        details: data.error_description || 'Unknown Eventbrite error'
      });
    }

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});


//google maps api
app.get('/api/search', async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    let latitude = Number(req.query.lat);//get latitude from hstml
    let longitude = Number(req.query.lon);//get latitude from html
    
    console.log("API KEY:", process.env.GOOGLE_MAPS_API_KEY);
    
    try {
        const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.shortFormattedAddress'
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
            vicinity: place.shortFormattedAddress || place.formattedAddress || ''
        }));

        res.json({ results });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch places' });
    }
});

app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}`);
});
