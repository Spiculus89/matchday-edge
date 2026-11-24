// Builds data/backtest/scorer-lines.json: every finished game this season in the main leagues,
// with each player's line (started, shots, on target, goals, assists) and ESPN's pre-match odds.
// Run from GitHub Actions (the cloud sandbox can't reach ESPN): node scripts/backtest-fetch.mjs
import fs from "node:fs";
const S = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const LEAGUES = ["eng.1", "eng.2", "esp.1", "ita.1", "ger.1", "fra.1"];
const MONTHS = ["202608", "202609", "202610", "202611"];
const get = async (u) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { "user-agent": "matchday-edge backtest" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch (e) { /* retry */ } await new Promise((s) => setTimeout(s, 1000 * (i + 1))); } return null; };
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const st = (arr, name) => { const s = (arr || []).find((x) => x.name === name); return s ? num(s.value != null ? s.value : s.displayValue) : null; };
const out = { built: new Date().toISOString(), games: [], names: {} };
for (const lg of LEAGUES) {
  const ids = new Set();
  for (const mo of MONTHS) { const sb = await get(`${S}${lg}/scoreboard?dates=${mo}`); for (const e of (sb && sb.events) || []) if (e.status && e.status.type && e.status.type.completed) ids.add(e.id); }
  const list = [...ids];
  for (let i = 0; i < list.length; i += 6) {
    await Promise.all(list.slice(i, i + 6).map(async (id) => {
      const js = await get(`${S}${lg}/summary?event=${id}`); if (!js || !js.header) return;
      const c = js.header.competitions[0], cs = c.competitors || [];
      const H = cs.find((x) => x.homeAway === "home"), A = cs.find((x) => x.homeAway === "away");
      if (!H || !A) return;
      const side = {}; side[H.team.id] = 0; side[A.team.id] = 1;
      const g = { id, lg, d: c.date, h: H.team.id, a: A.team.id, hg: num(H.score), ag: num(A.score), p: [] };
      const pc = (js.pickcenter || [])[0];
      if (pc) g.o = { ml: [pc.homeTeamOdds && pc.homeTeamOdds.moneyLine, pc.drawOdds && pc.drawOdds.moneyLine, pc.awayTeamOdds && pc.awayTeamOdds.moneyLine], ou: pc.overUnder,
        over: pc.overOdds != null ? pc.overOdds : null, under: pc.underOdds != null ? pc.underOdds : null, by: pc.provider && pc.provider.name };
      for (const r of js.rosters || []) {
        const sd = side[r.team && r.team.id]; if (sd == null) continue;
        for (const p of r.roster || []) {
          const s = p.stats || [], played = p.starter || p.subbedIn; if (!played || !p.athlete) continue;
          out.names[p.athlete.id] = p.athlete.displayName;
          g.p.push([p.athlete.id, sd, p.starter ? 1 : 2, (p.position && p.position.abbreviation) || "", st(s, "totalShots"), st(s, "shotsOnTarget"), st(s, "totalGoals"), st(s, "goalAssists"), p.subbedOut ? 1 : 0]);
        }
      }
      out.games.push(g);
    }));
  }
  console.log(lg, list.length, "finished games");
}
fs.mkdirSync("data/backtest", { recursive: true });
fs.writeFileSync("data/backtest/scorer-lines.json", JSON.stringify(out) + "\n");
console.log("games", out.games.length, "with odds", out.games.filter((g) => g.o && g.o.ml && g.o.ml[0] != null).length, "sample odds", JSON.stringify(out.games.find((g) => g.o)?.o));
