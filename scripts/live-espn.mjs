// Live snapshot of today's site games from ESPN (score, minute, shots, on target, corners, cards,
// possession, scorers and red cards) run through the page's live model. Prints to the log only.
// Usage: node scripts/live-espn.mjs [YYYY-MM-DD]   (run by the "Live" workflow; the sandbox can't reach ESPN)
import fs from "node:fs"; import vm from "node:vm";
import { leagueSlug, matchEvent, parseSummary } from "./grade-lib.mjs";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const date = process.argv[2] || new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
const day = JSON.parse(fs.readFileSync(`public/data/${date}.json`, "utf8"));
const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/engine.js", "utf8"), ctx);
const E = ctx.self.BetEngine; E.setCalibration(E.trackStats(JSON.parse(fs.readFileSync("public/data/results.json", "utf8")).legs));
const get = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; } catch (e) { return null; } };
const boards = {};
const now = Date.now();
for (const m of day.matches) {
  const ko = Date.parse(m.kickoff); if (ko > now || ko < now - 4 * 3600e3) continue;
  const slug = leagueSlug(m.competition); if (!slug) continue;
  const ymd = new Date(ko).toISOString().slice(0, 10).replace(/-/g, "");
  if (!boards[slug]) boards[slug] = ((await get(`${BASE}${slug}/scoreboard?dates=${ymd}`)) || {}).events || [];
  const ev = matchEvent(m, boards[slug]); if (!ev) { console.log(`${m.id}: not on ESPN`); continue; }
  const js = await get(`${BASE}${slug}/summary?event=${ev.id}`), F = parseSummary(js); if (!F) { console.log(`${m.id}: no summary`); continue; }
  const st = ((js.header.competitions[0].status) || {}), clock = (st.type && st.type.shortDetail) || st.displayClock || "";
  const minute = st.type && st.type.state === "post" ? 90 : /HT|Half/i.test(clock) ? 45 : parseInt(clock, 10) || 0;
  const poss = {}; for (const t of (js.boxscore && js.boxscore.teams) || []) { const s = (t.statistics || []).find((x) => x.name === "possessionPct"); if (s) poss[t.homeAway] = s.displayValue; }
  const evs = ((js.keyEvents || js.commentary || []).filter((k) => k.type && /goal|red/i.test(k.type.text || "")) || [])
    .map((k) => `${(k.clock && k.clock.displayValue) || ""} ${(k.type && k.type.text) || ""}: ${((k.participants || [])[0] || {}).athlete ? k.participants[0].athlete.displayName : ""} (${(k.team && (k.team.abbreviation || k.team.displayName)) || ""})`);
  const t = F.teams, h = t.home || {}, a = t.away || {};
  console.log(`\n== ${m.home.short} ${F.home}-${F.away} ${m.away.short} [${clock}] (${m.id})`);
  console.log(`   shots ${h.shots}-${a.shots}, on target ${h.sot}-${a.sot}, corners ${h.corners}-${a.corners}, yellows ${h.yellow}-${a.yellow}, reds ${h.red}-${a.red}, fouls ${h.fouls}-${a.fouls}, possession ${poss.home || "?"}-${poss.away || "?"}`);
  if (evs.length) console.log(`   ${evs.join(" | ")}`);
  if (!m.odds) { console.log("   no pre-match price: no live model"); continue; }
  const L = E.live(m, { minute, home: F.home, away: F.away, redHome: h.red || 0, redAway: a.red || 0, sotHome: h.sot, sotAway: a.sot,
    cornersHome: h.corners, cornersAway: a.corners, yellowsHome: h.yellow, yellowsAway: a.yellow, finished: F.finished });
  const k = L.markets, pct = (x) => Math.round(x * 100) + "%";
  console.log(`   model: 1X2 ${pct(k.home)}/${pct(k.draw)}/${pct(k.away)}, next goal ${pct(k.nextGoal.home)}/${pct(k.nextGoal.away)}/none ${pct(k.nextGoal.none)}, BTTS ${pct(k.btts)}, remaining xG ${L.remainingXg.home.toFixed(2)}-${L.remainingXg.away.toFixed(2)}, form ${L.form.home.toFixed(2)}/${L.form.away.toFixed(2)}`);
  for (const p of (L.picks || []).slice(0, 4)) console.log(`   pick: ${p.label} (${p.group}) ${pct(p.p)}, take at ${p.takeAt}+`);
}
