// Fallback day files from the odds snapshot (runs in the odds GitHub Action, no Claude needed).
// When a sport has no file for a Warsaw date that has upcoming fixtures in latest.json, write one with
// Pinnacle prices only, so the site never shows yesterday's games. The morning research run enriches it.
import fs from "node:fs";
import { applyToGame } from "./odds-lib.mjs";

const L = JSON.parse(fs.readFileSync("public/data/odds/latest.json", "utf8"));
const T = JSON.parse(fs.readFileSync("data/odds-cache/tournaments.json", "utf8"));
const cfg = JSON.parse(fs.readFileSync("data/odds-config.json", "utf8"));
const NAME = {}; for (const sid of Object.keys(T)) for (const r of T[sid]) NAME[r[0]] = [r[1], r[2]];
const LEAGUE = { 132: "NBA", 138: "EuroLeague", 141: "EuroCup", 14051: "Basketball Champions League", 2388: "FIBA Europe Cup", 235: "ABA League", 264: "Liga ACB", 262: "Lega A", 304: "Greek Basket League", 519: "Turkish Super League", 156: "LNB Elite",
  234: "NHL", 268: "KHL", 261: "SHL", 134: "Liiga", 128: "National League", 225: "DEL" };
// football: top-tier European leagues first, then anything else in the snapshot; max 12
const FB_RANK = [7, 679, 34480, 17, 8, 23, 35, 34, 37, 238, 52, 38, 18, 44, 202, 325];
const CAPS = { basketball: { 132: 99, default: 4 }, hockey: { 234: 99, default: 3 }, football: { default: 99 } };
const MAX = { football: 12, basketball: 16, hockey: 14 };
const ascii = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "");
const code = s => ascii(s).replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "XXX";
const shortName = (n, sport, tid) => sport !== "football" && (tid === 132 || tid === 234) ? n.split(" ").slice(-1)[0] : n.replace(/^(BC|KK|HC|EHC|SC|HK|FC|CF|CD|SV|1\.\s?FC|AC|AS|SS|US|RC)\s+/i, "").split(" ").slice(0, 2).join(" ");
const warsawDate = iso => new Date(Date.parse(iso) + (/-(0[4-9]|10)-/.test(iso) ? 7200e3 : 3600e3)).toISOString().slice(0, 10);
const now = Date.now(), at = L.updatedAt;
const note = "Priced from Pinnacle's odds only (automatic fallback: the research run hasn't added form, team news or lineups yet). Fair prices and the most likely outcome; no value bet without that information.";
const dirs = { football: "public/data/", basketball: "public/data/basketball/", hockey: "public/data/hockey/" };
let wrote = 0;
for (const sport of ["football", "basketball", "hockey"]) {
  const fx = L.fixtures.filter(f => f.sport === sport && Date.parse(f.start) > now + 10 * 60e3 && Date.parse(f.start) < now + 30 * 3600e3 && f.odds && (f.odds.pinnacle || f.odds["admiralbet.ba"]));
  if (sport !== "football") fx.splice(0, fx.length, ...fx.filter(f => LEAGUE[f.tournamentId]));
  const rank = f => sport === "football" ? (FB_RANK.indexOf(f.tournamentId) + 1 || 99) : (f.tournamentId === 132 || f.tournamentId === 234 ? 0 : 1);
  fx.sort((a, b) => rank(a) - rank(b) || a.start.localeCompare(b.start));
  const byDate = {}, perLeague = {};
  for (const f of fx) {
    const cap = CAPS[sport][f.tournamentId] ?? CAPS[sport].default, d = warsawDate(f.start);
    if ((perLeague[d + f.tournamentId] = (perLeague[d + f.tournamentId] || 0) + 1) > cap) continue;
    (byDate[d] ||= []).push(f);
  }
  const dir = dirs[sport], idx = JSON.parse(fs.readFileSync(dir + "index.json", "utf8"));
  for (const [date, list] of Object.entries(byDate)) {
    const fn = dir + date + ".json";
    if (fs.existsSync(fn)) continue; // the research run (or an earlier fallback) already made this day
    const games = [], ids = new Set();
    for (const f of list.slice(0, MAX[sport])) {
      const [tn, country] = NAME[f.tournamentId] || ["", ""];
      const hs = shortName(f.home, sport, f.tournamentId), as = shortName(f.away, sport, f.tournamentId);
      const g = sport === "football"
        ? { id: (code(hs) + "-" + code(as)).toLowerCase(), competition: tn + (country ? ` (${country})` : ""), kickoff: f.start, home: { name: f.home, short: hs }, away: { name: f.away, short: as },
            context: note, odds: {}, news: [], lineups: { status: "pending", home: { xi: [] }, away: { xi: [] } } }
        : { id: (code(as) + "-" + code(hs)).toLowerCase(), league: LEAGUE[f.tournamentId], start: f.start, home: { name: f.home, short: hs, code: code(hs) }, away: { name: f.away, short: as, code: code(as) },
            context: note, odds: {}, players: { home: [], away: [] }, news: [], lineups: { status: "expected" } };
      g.sources = [{ title: "OddsPapi odds snapshot " + at.slice(0, 16).replace("T", " ") + " UTC", url: "https://oddspapi.io/" }];
      if (!applyToGame(g, f, sport, at)) continue;
      while (ids.has(g.id)) g.id += "x"; ids.add(g.id); games.push(g);
    }
    if (!games.length) continue;
    games.sort((a, b) => (a.kickoff || a.start).localeCompare(b.kickoff || b.start));
    const day = sport === "football" ? { date, updated: at, updateNote: "Automatic fallback from Pinnacle odds; the research run adds form, news and lineups.", skeleton: true, matches: games }
      : { date, updated: at, updateNote: "Automatic fallback from Pinnacle odds; the research run adds form, injuries and players.", skeleton: true, games };
    fs.writeFileSync(fn, JSON.stringify(day, null, 2) + "\n");
    const entry = sport === "football" ? { date, file: "data/" + date + ".json", title: [...new Set(games.map(g => g.competition.replace(/ \(.*\)$/, "")))].slice(0, 5).join(", ") } : { date, file: date + ".json" };
    idx.days = [entry, ...idx.days.filter(d => d.date !== date)].sort((a, b) => b.date.localeCompare(a.date));
    wrote++; console.log(`skeleton ${sport} ${date}: ${games.length} games`);
  }
  fs.writeFileSync(dir + "index.json", JSON.stringify(idx, null, 2) + "\n");
}
console.log(wrote ? `wrote ${wrote} fallback day files` : "no fallback needed");
