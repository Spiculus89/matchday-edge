// Player stats for the site's upcoming games, from ESPN's public JSON.
//   node scripts/players.mjs fetch    squads and season lines for every team in today's and tomorrow's files
//                                     (cached in data/players/, refreshed once a day)
//   node scripts/players.mjs attach   offline: builds players + teamTotals for upcoming games. Lists it made
//                                     itself are rebuilt (e.g. once lineups are in); research lists are kept.
import fs from "node:fs";
import { leagueSlug } from "./grade-lib.mjs";
import { findEspnTeam, teamsFromList, parseRoster, parseStats, sideFromTeam, AUTO } from "./players-lib.mjs";

const OUT = "data/players", mode = process.argv[2] || "attach", now = Date.now();
const S = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
// domestic leagues searched for teams in cup games (and their own games)
const DOMESTIC = ["eng.1", "eng.2", "esp.1", "ita.1", "ger.1", "fra.1", "ned.1", "por.1", "bel.1", "tur.1", "sco.1", "gre.1", "aut.1", "sui.1", "den.1",
  "nor.1", "swe.1", "cze.1", "pol.1", "bra.1", "arg.1", "usa.1", "mex.1", "ksa.1", "uru.1", "svk.1", "cro.1", "srb.1", "ukr.1", "cyp.1", "isr.1"];
const warsaw = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
const read = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return d; } };
const index = read(`${OUT}/index.json`, { teams: {} });

function upcoming(days) {
  const out = [];
  for (const f of fs.readdirSync("public/data")) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (!m || !days.includes(m[1])) continue;
    const day = read(`public/data/${f}`, { matches: [] });
    for (const g of day.matches || []) if (!g.result && Date.parse(g.kickoff) > now) out.push({ file: `public/data/${f}`, day, g });
  }
  return out;
}
const key = (site) => site.name;

if (mode === "fetch") {
  const get = async (u) => {
    for (let i = 0; i < 2; i++) {
      try { const r = await fetch(u, { headers: { "user-agent": "matchday-edge (daily squad stats)" }, signal: AbortSignal.timeout(20000) }); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch (e) { /* retry */ }
      await new Promise((s) => setTimeout(s, 1500));
    }
    return null;
  };
  const days = [warsaw(now), warsaw(now + 864e5)];
  const games = upcoming(days);
  // team lists, cached for a week
  let lists = read(`${OUT}/teams.json`, null);
  if (!lists || now - Date.parse(lists.updated) > 7 * 864e5) {
    const teams = [];
    for (const slug of DOMESTIC) teams.push(...teamsFromList(await get(`${S}${slug}/teams`), slug));
    lists = { updated: new Date(now).toISOString(), teams };
  }
  let fetched = 0, missing = [];
  const todo = new Map();
  for (const { g } of games) for (const side of ["home", "away"]) {
    const site = g[side], slug = leagueSlug(g.competition);
    const t = findEspnTeam(site, lists.teams, slug);
    if (!t) { missing.push(site.name); continue; }
    const prev = index.teams[key(site)];
    if (prev && prev.id === t.id && now - Date.parse(prev.fetched) < 20 * 3600e3 && fs.existsSync(`${OUT}/${prev.file}`)) continue;
    todo.set(key(site), t);
  }
  for (const [k, t] of todo) {
    const rj = await get(`${S}${t.slug}/teams/${t.id}/roster`);
    if (!rj) { missing.push(k + " (roster)"); continue; }
    const year = (rj.season && rj.season.year) || new Date(now).getUTCFullYear();
    const players = parseRoster(rj);
    // season lines, 6 at a time
    for (let i = 0; i < players.length; i += 6) {
      await Promise.all(players.slice(i, i + 6).map(async (p) => {
        p.stats = parseStats(await get(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${t.slug}/seasons/${year}/types/1/athletes/${p.id}/statistics`));
      }));
    }
    const file = `${t.slug}-${t.id}.json`;
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(`${OUT}/${file}`, JSON.stringify({ team: t.names[0], slug: t.slug, id: t.id, season: year, fetched: new Date().toISOString(), players }) + "\n");
    index.teams[k] = { slug: t.slug, id: t.id, espn: t.names[0], file, fetched: new Date().toISOString() };
    fetched++;
    console.log(`${k} -> ${t.names[0]} (${t.slug}): ${players.length} players, ${players.filter((p) => p.stats && p.stats.apps).length} with ${year} appearances`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  // squads not needed for two weeks are dropped
  for (const [k, v] of Object.entries(index.teams)) if (now - Date.parse(v.fetched) > 14 * 864e5) {
    delete index.teams[k];
    if (!Object.values(index.teams).some((x) => x.file === v.file)) try { fs.unlinkSync(`${OUT}/${v.file}`); } catch (e) { /* gone */ }
  }
  fs.writeFileSync(`${OUT}/teams.json`, JSON.stringify(lists) + "\n");
  fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1) + "\n");
  console.log(`players: ${fetched} squads fetched for ${games.length} games${missing.length ? `; not found on ESPN: ${[...new Set(missing)].join(", ")}` : ""}`);
} else {
  const games = upcoming([warsaw(now), warsaw(now + 864e5), warsaw(now + 2 * 864e5)]);
  const changed = new Set();
  for (const { file, day, g } of games) {
    if (g.players && g.players.source !== AUTO && ((g.players.home || []).length || (g.players.away || []).length)) continue; // research list
    const sides = {};
    for (const side of ["home", "away"]) {
      const ix = index.teams[key(g[side])], team = ix && read(`${OUT}/${ix.file}`, null);
      const lu = g.lineups && g.lineups[side];
      const lineup = lu && { xi: lu.xi, confirmed: g.lineups.status === "confirmed" };
      sides[side] = team && sideFromTeam(team, lineup);
    }
    if (!sides.home || !sides.away) continue;
    const before = JSON.stringify([g.players, g.teamTotals]);
    g.players = { source: AUTO, home: sides.home.players, away: sides.away.players };
    if (!g.teamTotals || g.teamTotals.source === AUTO) g.teamTotals = { source: AUTO, home: sides.home.totals, away: sides.away.totals };
    if (JSON.stringify([g.players, g.teamTotals]) !== before) {
      g.sources = g.sources || [];
      if (!g.sources.some((x) => /espn\.com\/soccer\/player/.test(x.url || "") || /ESPN squad/.test(x.title || ""))) g.sources.push({ title: "ESPN squad and season player stats (shots, on target, goals, assists, fouls, tackles, minutes)", url: "https://www.espn.com/soccer/" });
      changed.add(file); console.log(`${g.id}: ${sides.home.players.length} + ${sides.away.players.length} players`);
    }
  }
  const days = new Map(); for (const { file, day } of games) if (changed.has(file)) days.set(file, day);
  for (const [file, day] of days) fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n");
  console.log(`players attach: ${changed.size} day files updated`);
}
