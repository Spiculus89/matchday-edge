# Matchday Edge

A static site with the day's biggest football matches, priced by a model built on bookmaker odds, team form, lineups, injuries, referees and news. It has no backend and needs no API keys.

The data is researched and refreshed several times a day by a scheduled Claude task. Each run writes `public/data/<date>.json`, checks it, and pushes to `main`, and Vercel redeploys automatically. The prediction engine (`public/engine.js`) runs in the browser.

- **Deploy:** import the repo in Vercel with framework *Other*. There's no build step and no environment variables.
- **Check the data locally:** `npm run check -- 2026-11-12`, then `npm test`.
- **How a run works:** see [RUNBOOK.md](RUNBOOK.md).
- **Track record and lessons:** `public/data/results.json` holds every graded pick and drives a per-market calibration; `public/data/lessons.json` lists each change to the model or the data process and what prompted it. The site shows both under the matches.

These are probabilities, not certainties. 18+, and never stake more than you can afford to lose.
