// How long each kind of data stays cached on the CDN, in seconds.
// The free plan's 100 requests a day is the budget; the comments show the daily cost
// for a typical day with 5 matches spread over two kick-off windows.

import { plan } from "./apifootball.js";

const FREE = {
  fixturesOfDay: 6 * 3600,      // 1 call  → ~4 a day
  liveNearKickoff: 15 * 60,     // 2 calls → lineups + injuries, every 15 min from 90 min before kick-off
  liveQuiet: 2 * 3600,          // 2 calls → every 2 h the rest of the day       (~40 a day for both)
  odds: 4 * 3600,               // 1 call per match                              (~25 a day)
  teams: 24 * 3600,             // 2 calls per team + 1 batch                    (~20 a day)
  scorers: 24 * 3600,           // 2 calls per competition                       (~6 a day)
  weather: 3600,                // Open-Meteo, not API-Football
  news: 30 * 60                 // Google News RSS, not API-Football
};
const PRO = {
  fixturesOfDay: 3600, liveNearKickoff: 3 * 60, liveQuiet: 30 * 60, odds: 30 * 60,
  teams: 12 * 3600, scorers: 12 * 3600, weather: 1800, news: 15 * 60
};

export function ttl(kind) {
  const t = plan() === "free" ? FREE : PRO;
  return t[kind];
}

// Live data refreshes faster when any match is within 90 minutes of kick-off or in play.
export function liveTtl(kickoffs, now = Date.now()) {
  const hot = kickoffs.some((k) => {
    const t = new Date(k).getTime();
    return now >= t - 90 * 60000 && now <= t + 120 * 60000;
  });
  return ttl(hot ? "liveNearKickoff" : "liveQuiet");
}

export function maxMatches() {
  const env = parseInt(process.env.MAX_MATCHES, 10);
  if (Number.isFinite(env) && env > 0) return Math.min(env, 20);
  return plan() === "free" ? 5 : 10;
}
