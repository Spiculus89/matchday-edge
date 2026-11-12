// Runs the engine over every match in public/data/<date>.json and fails on bad data.
// Usage: node scripts/check.mjs 2026-11-12
import fs from "node:fs"; import vm from "node:vm";
const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/engine.js", "utf8"), ctx); const E = ctx.self.BetEngine;
const idx = JSON.parse(fs.readFileSync("public/data/index.json", "utf8"));
const date = process.argv[2] || idx.days[0].date;
const day = JSON.parse(fs.readFileSync(`public/data/${date}.json`, "utf8"));
let bad = 0;
for (const m of day.matches) {
  try {
    const r = E.analyse(m), k = r.markets;
    if (Math.abs(k.home + k.draw + k.away - 1) > 1e-6) throw new Error("1X2 does not sum to 1");
    if (m.odds && m.odds.h) { const mg = r.market.margin; if (mg < 0 || mg > 0.15) throw new Error(`odd 1X2 margin ${(mg*100).toFixed(1)}%`); }
    if (m.odds && m.odds.ou) for (const [L, pr] of Object.entries(m.odds.ou)) { const s = 1/pr[0] + 1/pr[1]; if (s < 1 || s > 1.15) throw new Error(`O/U ${L} margin looks wrong (${s.toFixed(3)})`); }
    if (!m.lineups || !m.lineups.home || m.lineups.home.xi.length !== 11 || m.lineups.away.xi.length !== 11) throw new Error("lineups must have 11 per side");
    console.log(`ok  ${m.home.name} v ${m.away.name}: ${r.picks.top ? r.picks.top.label + " @" + r.picks.top.odds : "no priced pick"}`);
  } catch (e) { bad++; console.log(`BAD ${m.home && m.home.name} v ${m.away && m.away.name}: ${e.message}`); }
}
if (!idx.days.some((d) => d.date === date)) { bad++; console.log("BAD index.json has no entry for " + date); }
process.exit(bad ? 1 : 0);
