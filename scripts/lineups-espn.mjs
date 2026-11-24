// Confirmed lineups from ESPN's public JSON for games kicking off within the next 2.5 hours
// (ESPN's match summary lists the starters about an hour before kick-off), then the
// "Not priced yet" notes come off games the odds run has priced.
// Usage: node scripts/lineups-espn.mjs   (from GitHub Actions; the cloud sandbox can't reach ESPN)
import fs from "node:fs";
import { leagueSlug, matchEvent } from "./grade-lib.mjs";

const S = "https://site.api.espn.com/apis/site/v2/sports/soccer/", now = Date.now();
const get = async (u) => { for (let i = 0; i < 2; i++) { try { const r = await fetch(u, { headers: { "user-agent": "matchday-edge lineups" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); } catch (e) { /* retry */ } await new Promise((s) => setTimeout(s, 1500)); } return null; };
const warsaw = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
const ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
const NOTE = /Not priced yet:.*?don't bet from them\.\s*/s;
const boards = {};
let filled = 0, cleaned = 0;
for (const date of [...new Set([warsaw(now), warsaw(now + 3 * 3600e3)])]) {
  const file = `public/data/${date}.json`; if (!fs.existsSync(file)) continue;
  const day = JSON.parse(fs.readFileSync(file, "utf8")); let changed = false;
  for (const m of day.matches) {
    const ko = Date.parse(m.kickoff);
    if (m.odds && m.odds.h && NOTE.test(m.context || "") && ko > now - 3 * 3600e3) { m.context = m.context.replace(NOTE, ""); changed = true; cleaned++; }
    if (m.result || (m.lineups && m.lineups.status === "confirmed") || ko < now - 15 * 60e3 || ko > now + 150 * 60e3) continue;
    const slug = leagueSlug(m.competition); if (!slug) { console.log(`${m.id}: no ESPN league`); continue; }
    let ev = null;
    for (const d of [...new Set([ymd(ko), ymd(ko - 6 * 3600e3)])]) {
      const k = slug + d; if (!(k in boards)) { const js = await get(`${S}${slug}/scoreboard?dates=${d}`); boards[k] = (js && js.events) || []; }
      ev = matchEvent(m, boards[k]); if (ev) break;
    }
    if (!ev) { console.log(`${m.id}: not found on ESPN ${slug}`); continue; }
    const js = await get(`${S}${slug}/summary?event=${ev.id}`);
    const comp = js && js.header && js.header.competitions && js.header.competitions[0];
    const side = {}; ((comp && comp.competitors) || []).forEach((c) => { side[c.team && c.team.id] = c.homeAway; });
    const L = {};
    for (const r of (js && js.rosters) || []) {
      const ha = r.homeAway || side[r.team && r.team.id]; if (!ha) continue;
      const xi = (r.roster || []).filter((p) => p.starter && p.athlete).sort((a, b) => (+a.formationPlace || 99) - (+b.formationPlace || 99)).map((p) => p.athlete.displayName);
      if (xi.length === 11) L[ha] = { formation: r.formation || "", xi };
    }
    if (!L.home || !L.away) { console.log(`${m.id}: ESPN ${ev.id} has no lineups yet`); continue; }
    const at = new Date().toISOString().slice(11, 16);
    m.lineups = { ...(m.lineups || {}), status: "confirmed", source: `ESPN confirmed lineups, read ${at} UTC`, home: L.home, away: L.away };
    m.sources = m.sources || [];
    if (!m.sources.some((x) => /espn\.com\/soccer\/match/.test(x.url || ""))) m.sources.push({ title: "ESPN match page (confirmed lineups)", url: `https://www.espn.com/soccer/match/_/gameId/${ev.id}` });
    changed = true; filled++;
    console.log(`${m.id}: confirmed ${L.home.formation || "?"} v ${L.away.formation || "?"} (ESPN ${ev.id})`);
  }
  if (changed) { day.updated = new Date().toISOString(); fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n"); }
}
console.log(`lineups: ${filled} games confirmed, ${cleaned} "not priced" notes removed`);
