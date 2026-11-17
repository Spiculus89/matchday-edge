// Checks a basketball or hockey day file. Usage: node scripts/check-sport.mjs basketball 2026-11-18
import fs from "node:fs"; import vm from "node:vm";
const sport = process.argv[2], file = { basketball: ["engine-basketball.js", "HoopsEngine"], hockey: ["engine-hockey.js", "HockeyEngine"] }[sport];
if (!file) { console.log("usage: check-sport.mjs basketball|hockey <date>"); process.exit(1); }
const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/" + file[0], "utf8"), ctx); const E = ctx.self[file[1]];
const dir = `public/data/${sport}/`;
if (fs.existsSync(dir + "results.json")) E.setCalibration(E.trackStats(JSON.parse(fs.readFileSync(dir + "results.json", "utf8")).legs));
const idx = JSON.parse(fs.readFileSync(dir + "index.json", "utf8")), date = process.argv[3] || idx.days[0].date;
const day = JSON.parse(fs.readFileSync(`${dir}${date}.json`, "utf8"));
let bad = 0;
const margin = (a, b) => 1 / a + 1 / b;
for (const g of day.games) {
  try {
    if (!g.id || !g.start || !g.home || !g.away || !g.league) throw new Error("needs id, start, league, home, away");
    const o = g.odds || {};
    for (const [k, pr] of [["moneyline", o.ml], ["spread", o.spread && [o.spread.h, o.spread.a]], ["puck line", o.puck && [o.puck.h, o.puck.a]], ["total", o.total && [o.total.o, o.total.u]]]) {
      if (!pr) continue; const s = margin(pr[0], pr[1]); if (s < 1 || s > 1.12) throw new Error(`${k} margin looks wrong (${s.toFixed(3)})`);
    }
    if (!o.ml && !o.spread && !o.puck) throw new Error("needs a moneyline, spread or puck line");
    const r = E.analyse(g), k = r.markets;
    if (!(k.home > 0 && k.home < 1) || Math.abs(k.home + k.away - 1) > 1e-6) throw new Error("win chances look wrong");
    console.log(`ok  ${g.away.name} @ ${g.home.name}: ${r.picks.top ? r.picks.top.label + " @" + (+r.picks.top.odds).toFixed(2) : "no bet"}`);
  } catch (e) { bad++; console.log(`BAD ${g.away && g.away.name} @ ${g.home && g.home.name}: ${e.message}`); }
}
if (!idx.days.some((d) => d.date === date)) { bad++; console.log("BAD index.json has no entry for " + date); }
process.exit(bad ? 1 : 0);
