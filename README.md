# Matchday Edge

The day's biggest football matches, priced by a model built on bookmaker odds, team form, lineups, injuries, weather and news. For every match you get a best bet, a pick per market (result or Asian handicap, total goals, BTTS, anytime scorer, assist, corners, cards), the most likely scores, predicted or confirmed lineups, injury and suspension news, and the forecast at the stadium.

It runs on Vercel's free plan with free data sources:

| Data | Source | Cost |
|---|---|---|
| Fixtures, odds, referees, injuries and suspensions, confirmed lineups, top scorers, team stats | [API-Football](https://www.api-football.com) | Free plan, 100 requests a day |
| Weather at the venue for kick-off | [Open-Meteo](https://open-meteo.com) | Free for non-commercial use, no key |
| Team news headlines (injuries, returns, team news) | Google News RSS search | Free, no key |

## Deploy (about 5 minutes)

1. **Get an API-Football key.** Sign up at [dashboard.api-football.com](https://dashboard.api-football.com) (no card needed) and copy the key from *Account → My Access*.
2. **Put this code in a GitHub repository** (already done if you're reading this on GitHub).
3. **Import it into Vercel.** On [vercel.com](https://vercel.com) choose *Add New → Project*, pick the repository, and leave the framework preset as *Other*. There is no build step.
4. **Add the key.** Before you click *Deploy*, open *Environment Variables* and add `API_FOOTBALL_KEY` with your key. Add `APP_TIMEZONE` too if you are not in Poland (default `Europe/Warsaw`).
5. **Deploy.** Open the URL Vercel gives you. If you forgot the key, the page tells you how to add it; redeploy afterwards.

Every push to the repository redeploys the site automatically.

## How it stays up to date

The page fetches its data from this site's own `/api/*` routes. Each route is cached on Vercel's CDN for a set time, so however many people open the site, API-Football is only called when a cache expires. While the page is open it reloads every 5 minutes, and the **Refresh** button reloads on demand.

| Data | Refreshes every (free plan) | API-Football calls a day* |
|---|---|---|
| Which matches are the biggest today | 6 hours | ~4 |
| Lineups, score, referee, injuries and suspensions | 15 min from 90 min before kick-off, otherwise 2 hours | ~40 |
| Odds (result, goals, BTTS, handicap, corners, cards, scorers) | 4 hours | ~25 |
| Team averages and last starting XI | 24 hours | ~20 |
| Top scorers and assisters | 24 hours | ~6 |
| Weather | 1 hour | 0 (Open-Meteo) |
| News headlines | 30 min | 0 (Google News) |

\*For a typical day with 5 matches in two kick-off windows. The page shows how many calls are left today. If the allowance runs out it keeps showing the last cached data until it resets at 00:00 UTC.

Vercel's free plan only allows cron jobs once a day, so the app refreshes when someone opens it rather than on a timer. You never see data older than the cache times above.

### Want faster updates or more matches?

API-Football's Pro plan (7,500 requests a day) costs about $19 a month. Set `API_FOOTBALL_PLAN=pro` and the app switches to refreshing lineups every 3 minutes, odds every 30 minutes, and shows 10 matches.

## Settings (Vercel environment variables)

| Variable | Required | Default | What it does |
|---|---|---|---|
| `API_FOOTBALL_KEY` | yes | | Your API-Football key |
| `API_FOOTBALL_PLAN` | no | `free` | `free` or `pro`; sets refresh times and match count |
| `APP_TIMEZONE` | no | `Europe/Warsaw` | Defines "today" for the fixture list |
| `MAX_MATCHES` | no | 5 (free) / 10 (pro) | How many matches to show |
| `ODDS_BOOKMAKER` | no | `bet365` | Preferred bookmaker name; falls back to the one with the most markets |
| `OPEN_METEO_KEY` | no | | Use Open-Meteo's paid commercial API |
| `DEBUG_TOKEN` | no | | Enables `/api/debug` to inspect raw API-Football responses |

## How the model works

- **Goals.** The bookmaker's prices for the result, over/under 2.5 and BTTS are stripped of their margin. The engine then finds the two goal rates that best reproduce them. These are blended 75/25 with each team's goals for and against in the competition, pulled toward the average by sample size. Heavy rain, strong wind, heat and snow at the venue trim the rates a little.
- **Every scoreline** comes from a Dixon-Coles adjusted Poisson grid. Results, double chance, draw no bet, Asian handicaps, totals, BTTS, win-to-nil and correct scores all follow from it.
- **Corners and cards** use an over-dispersed (negative binomial) count. When the bookmaker offers a line, the model is fitted to it; otherwise it uses team averages.
- **Scorers and assists.** Each team's expected goals are shared out by the players' goals, shots and assists this season, then scaled by how likely each player is to start. That chance is 100% once lineups are confirmed. Before that, a player who started the team's last match gets 85%, a fitness doubt 45%, and someone injured or suspended is removed.
- **Picks** compare the model's chance with the bookmaker's price. *Strong* and *Lean* mean the model sees an edge; *Fair price* means it doesn't; *Thin* means the bookmaker's price is short. Markets without bookmaker odds show *fair odds*: only bet if your bookmaker pays more.

Because the model starts from the market, it rarely disagrees with bookmakers by much, and that is deliberate: betting markets are hard to beat. Treat the picks as a well-organised second opinion, not a guarantee. 18+, and never stake more than you can afford to lose.

## Known limits

- The free data feed has no referee card history. Cards use the bookmaker's line or the two teams' card averages, and the referee is shown by name.
- Predicted lineups are the last starting XI minus injured or suspended players, so a manager's rotation is invisible until the team sheet lands (about an hour before kick-off).
- Google News is a public RSS feed with no guarantee it will keep working. If it fails, the app still shows API-Football's injury and suspension list.
- Open-Meteo's free API and Vercel's Hobby plan are for non-commercial use. If you start charging for the app, move both to paid plans.

## Run it locally

```bash
npm run dev:mock   # offline, with realistic sample data, at http://localhost:3000
npm test           # engine, parsers and every API route against the offline mock
cp .env.example .env.local   # add your key, then:
npm run dev        # real data
```

No dependencies to install. Node 20 or newer is all it needs.

## Checking an API mapping

If a market or lineup looks wrong, set `DEBUG_TOKEN` in Vercel, then open
`/api/debug?token=YOUR_TOKEN&path=odds&fixture=FIXTURE_ID` to see the raw API-Football response. Each debug call uses one request from the daily allowance.
