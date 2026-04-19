# Geo Activities App

Weather, nearby attractions, and Berlin-focused event discovery in a single Express app.

## Features

- Current weather and 5-day forecast via OpenWeather
- City geocoding via OpenCage
- Nearby attractions via Google Places API (New)
- Interactive Google Map with event and attraction pins
- Berlin.de and selected Luma event aggregation

## Local development

1. Install dependencies:

```bash
npm install
```

2. Copy the example environment file and fill in your keys:

```bash
cp .env.example .env
```

3. Start the app:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Required environment variables

```env
GOOGLE_MAPS_BROWSER_API_KEY=
GOOGLE_MAPS_MAP_ID=
GOOGLE_MAPS_API_KEY=
OPENCAGE_API_KEY=
OPENWEATHER_API_KEY=
LUMA_EVENT_URLS=
```

## Recommended Google API setup

- `GOOGLE_MAPS_BROWSER_API_KEY`
  - Use for the browser map only
  - Restrict by `Websites`
  - Allow `http://localhost:3000/*`
  - Allow your Vercel production domain, for example `https://your-app.vercel.app/*`
  - Restrict API usage to `Maps JavaScript API`

- `GOOGLE_MAPS_MAP_ID`
  - Optional but recommended for Advanced Markers
  - Create a map ID in Google Cloud and set it here for production
  - If omitted, the app falls back to `DEMO_MAP_ID`

- `GOOGLE_MAPS_API_KEY`
  - Use on the server only
  - Do not expose it in the browser
  - Restrict API usage to `Places API`

## Deploying to Vercel

This project is compatible with Vercel's Express support:

- `public/` is served as static assets
- `server.js` handles the `/api/*` routes

Set the same environment variables from `.env.example` in the Vercel project settings:

- Vercel Dashboard -> Project -> Settings -> Environment Variables

After that, deploy by connecting the repository in Vercel or by using the Vercel CLI.

## Notes

- `express.static('public')` is used for local development. On Vercel, static assets are served from the `public/` directory by the platform.
- Event scraping is currently intended for Berlin.
