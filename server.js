import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import fetch from 'node-fetch';
const app = express();
const port = 3000;

app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    let latitude = req.query.lat;//get latitude from hstml
    let longitude = req.query.lon;//get latitude from html
    
    console.log("API KEY:", process.env.GOOGLE_MAPS_API_KEY);

    const urlSearch = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=1500&type=tourist_attraction&key=${apiKey}`;
    
    
    try {
        const response = await fetch(urlSearch, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });
        const TripAdvserData = await response.json();
        res.json(TripAdvserData);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch places' });
    }
});

app.listen(port, () => {
    console.log(`Proxy server running at http://localhost:${port}`);
});
