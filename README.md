# HappeningNow.news

HappeningNow.news is an Astro/React news aggregator that blends Event Registry (NewsAPI.ai) and GDELT sources to build curated editions by category. The site chooses the most recent stories, applies per-category query hints, and caches the results for fast front‑end rendering while falling back to trusted sources when needed.

## Key Features

- Hybrid Astro site with React/Keystatic integration and client-side story components.
- Event Registry adapter that prioritizes NewsAPI.ai whenever a valid API key (e.g., `NEWSAPI_KEY`) is available, falling back to GDELT when stories are missing.
- Category-aware front page that sequentially queries GDELT then Event Registry for each category before defaulting to placeholders.
- Netlify deployment ready via `@astrojs/netlify` plus `netlify.toml` settings.

## Local Development

1. Copy the example `.env` into place (e.g., `cp .env.example .env`) and define:
   - `NEWSAPI_AI_KEY`, `NEWSAPI_KEY`, or `EVENTREGISTRY_API_KEY` for the Event Registry token.
   - Any other env vars your Netlify/Astro build relies on.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the dev server:
   ```bash
   npm run dev
   ```

## Production Build / Netlify

1. Build the site:
   ```bash
   npm run build
   ```
2. Netlify expects `dist/` as the publish directory (see `netlify.toml`), so connect your repository and allow Netlify to run `npm run build`.
3. Keep secrets out of version control—`.env` is ignored by default.

## Troubleshooting

- If you see fallback cards for categories, check the server logs for `[newsapi.ai/er] status` to verify Event Registry calls and ensure the API key env var is set in Netlify.
- Run `npm run build` locally before deploying to validate the Netlify adapter builds successfully.
