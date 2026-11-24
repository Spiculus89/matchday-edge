// football-data.co.uk (24 Nov 2026): free CSVs with every league game's score, shots, corners,
// fouls, cards and (English leagues) referee. Turned into per-team form, corner, foul and card
// rates and per-referee card rates, then attached to the site's upcoming games.
import { normName } from "./grade-lib.mjs";

const STOP = new Set(["fc", "cf", "ac", "sc", "afc", "club", "ssc", "rc", "fk", "sk", "the", "de", "cd", "ud", "sv", "as", "us", "ca", "se", "ec"]);
const toks = (s) => normName(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
const teq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// 0 unless one name's words are all in the other; then 1 + the share of words in common (prefers the closer name)
function score(site, names) {
  const t = toks(site); let full = false, jac = 0;
  for (const nm of names.filter(Boolean)) {
    const u = toks(nm); if (!t.length || !u.length) continue;
    const hit = t.filter((w) => u.some((v) => teq(w, v))).length;
    if (hit >= Math.min(t.length, u.length)) full = true;
    jac = Math.max(jac, hit / Math.max(t.length, u.length));
  }
  return full ? 1 + jac : 0;
}

export const MAIN = ["E0", "E1", "E2", "E3", "SC0", "D1", "D2", "I1", "I2", "SP1", "SP2", "F1", "F2", "N1", "B1", "P1", "T1", "G1"];
export const EXTRA = ["BRA", "POL", "ARG", "AUT", "DNK", "NOR", "SWE", "SWZ", "USA", "MEX"];
export const BASE = "https://www.football-data.co.uk/";
// season code of the European season a date falls in: 2026-11 -> "2627"
export function seasonCode(d, back = 0) {
  const y = d.getUTCFullYear() - (d.getUTCMonth() < 6 ? 1 : 0) - back;
  return String(y % 100).padStart(2, "0") + String((y + 1) % 100).padStart(2, "0");
}

// Site competition -> football-data division (league games only; cups search every file)
const DIV = [
  [/brasil|brazil/i, "BRA"], [/ekstraklasa|poland/i, "POL"], [/argentin/i, "ARG"], [/austria/i, "AUT"], [/denmark|danish/i, "DNK"],
  [/norway|eliteserien/i, "NOR"], [/sweden|allsvenskan/i, "SWE"], [/swiss|switzerland/i, "SWZ"], [/\bmls\b/i, "USA"], [/liga mx|mexico/i, "MEX"],
  [/champions league|europa|conference|nations|world cup|friendl|cup|pokal|copa|coppa|coupe/i, null],
  [/championship/i, "E1"], [/league one/i, "E2"], [/league two/i, "E3"], [/scottish|scotland/i, "SC0"], [/premier league/i, "E0"],
  [/laliga 2|segunda/i, "SP2"], [/laliga|la liga|spain/i, "SP1"], [/serie b/i, "I2"], [/serie a|italy/i, "I1"],
  [/2\. bundesliga/i, "D2"], [/bundesliga|germany/i, "D1"], [/ligue 2/i, "F2"], [/ligue 1|france/i, "F1"],
  [/eredivisie|netherlands/i, "N1"], [/belgi|pro league/i, "B1"], [/portugal|primeira/i, "P1"], [/s[uü]per lig|turk/i, "T1"], [/greece|greek/i, "G1"]
];
export function divFor(competition) { for (const [re, d] of DIV) if (re.test(competition || "")) return d; return null; }

// football-data's short names, with the full names the site uses
const ALIAS = {
  "Man City": "Manchester City", "Man United": "Manchester United", "Nott'm Forest": "Nottingham Forest", "Wolves": "Wolverhampton Wanderers",
  "Sheffield Weds": "Sheffield Wednesday", "QPR": "Queens Park Rangers", "West Brom": "West Bromwich Albion", "Ath Madrid": "Atletico Madrid",
  "Ath Bilbao": "Athletic Bilbao", "Sociedad": "Real Sociedad", "Espanol": "Espanyol", "Vallecano": "Rayo Vallecano", "Celta": "Celta Vigo",
  "Betis": "Real Betis", "La Coruna": "Deportivo La Coruna", "M'gladbach": "Borussia Monchengladbach", "Ein Frankfurt": "Eintracht Frankfurt",
  "FC Koln": "Cologne", "Leverkusen": "Bayer Leverkusen", "Dortmund": "Borussia Dortmund", "Paris SG": "Paris Saint-Germain", "St Etienne": "Saint-Etienne",
  "Sp Lisbon": "Sporting CP", "Sp Braga": "Braga", "Inter": "Inter Milan Internazionale", "Milan": "AC Milan", "Verona": "Hellas Verona", "Hamburg": "Hamburger SV",
  "St Truiden": "Sint-Truiden", "Nijmegen": "NEC Nijmegen", "For Sittard": "Fortuna Sittard", "Go Ahead Eagles": "Go Ahead Eagles", "Bodo/Glimt": "Bodoe/Glimt"
};

export function parseCsv(text) {
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = l.split(","); const o = {}; head.forEach((h, i) => { o[h] = c[i] != null ? c[i].trim() : ""; }); return o; });
}
function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s || ""); if (!m) return null;
  const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
const n = (x) => (x === "" || x == null || isNaN(+x) ? null : +x);
// One compact game per CSV row, from either file layout (main leagues or the "new" extra leagues)
export function toGames(rows, div) {
  return rows.map((r) => ({
    div: r.Div || div, date: parseDate(r.Date), home: r.HomeTeam || r.Home, away: r.AwayTeam || r.Away,
    hg: n(r.FTHG != null ? r.FTHG : r.HG), ag: n(r.FTAG != null ? r.FTAG : r.AG), ref: r.Referee || null,
    hs: n(r.HS), as: n(r.AS), hst: n(r.HST), ast: n(r.AST), hf: n(r.HF), af: n(r.AF), hc: n(r.HC), ac: n(r.AC),
    hy: n(r.HY), ay: n(r.AY), hr: n(r.HR), ar: n(r.AR)
  })).filter((g) => g.date && g.home && g.away && g.hg != null && g.ag != null);
}

const r2 = (x) => Math.round(x * 100) / 100;
const avg = (arr, f) => { const v = arr.map(f).filter((x) => x != null); return v.length ? { n: v.length, v: r2(v.reduce((a, b) => a + b, 0) / v.length) } : { n: 0, v: null }; };
// Per team: last 20 games (any division in the files), the current season in its latest division, and stat rates
export function buildTeams(games, today, curSeasonStart) {
  const by = {};
  for (const g of games) for (const side of ["home", "away"]) (by[g[side]] = by[g[side]] || []).push(g);
  const out = {};
  for (const [team, list] of Object.entries(by)) {
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    const last = list.filter((g) => g.date <= today).slice(0, 20);
    if (!last.length) continue;
    const me = (g) => (g.home === team ? "h" : "a"), op = (g) => (g.home === team ? "a" : "h");
    const pick = (g, k) => g[me(g) + k], opp = (g, k) => g[op(g) + k];
    const div = last[0].div, cur = last.filter((g) => g.div === div && g.date >= curSeasonStart);
    const homeG = last.filter((g) => g.home === team), awayG = last.filter((g) => g.away === team);
    const t = { div, n: last.length, gf: avg(last, (g) => pick(g, "g")).v, ga: avg(last, (g) => opp(g, "g")).v,
      cur: { n: cur.length, gf: avg(cur, (g) => pick(g, "g")).v, ga: avg(cur, (g) => opp(g, "g")).v } };
    const cf = avg(last, (g) => pick(g, "c"));
    if (cf.n >= 6) {
      t.corners = { n: cf.n, cf: cf.v, ca: avg(last, (g) => opp(g, "c")).v,
        home: { n: avg(homeG, (g) => g.hc).n, cf: avg(homeG, (g) => g.hc).v, ca: avg(homeG, (g) => g.ac).v },
        away: { n: avg(awayG, (g) => g.ac).n, cf: avg(awayG, (g) => g.ac).v, ca: avg(awayG, (g) => g.hc).v } };
      t.fouls = avg(last, (g) => pick(g, "f")).v; t.shots = avg(last, (g) => pick(g, "s")).v; t.sot = avg(last, (g) => pick(g, "st")).v;
      t.yellowsPg = avg(last, (g) => pick(g, "y")).v; t.redsPg = avg(last, (g) => pick(g, "r")).v;
    }
    out[team] = t;
  }
  return out;
}
// Per referee (English leagues): cards and fouls per game over the files' two seasons
export function buildReferees(games) {
  const by = {};
  for (const g of games) if (g.ref && g.hy != null && g.ay != null) (by[g.ref] = by[g.ref] || []).push(g);
  const out = {};
  for (const [ref, list] of Object.entries(by)) {
    out[ref] = { games: list.length, yellowsPg: avg(list, (g) => g.hy + g.ay).v, redsPg: avg(list, (g) => (g.hr != null && g.ar != null ? g.hr + g.ar : null)).v,
      foulsPg: avg(list, (g) => (g.hf != null && g.af != null ? g.hf + g.af : null)).v };
  }
  return out;
}

// The football-data team for a site team: full name match, preferring the game's own division; ties are skipped
export function findTeam(site, teams, div) {
  let best = null, bs = 0, tie = false;
  for (const [name, t] of Object.entries(teams)) {
    const s = Math.max(score(site.name, [name, ALIAS[name]]), site.short ? score(site.short, [name, ALIAS[name]]) : 0) + (div && t.div === div ? 0.5 : 0);
    if (s < 1) continue;
    if (s > bs + 1e-9) { bs = s; best = name; tie = false; } else if (Math.abs(s - bs) < 1e-9) tie = true;
  }
  return best && !tie ? best : null;
}
function findRef(name, refs) {
  const parts = String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1], first = parts[0][0];
  const hit = Object.keys(refs).filter((r) => { const p = r.toLowerCase().split(/\s+/); return p[p.length - 1] === last && p[0][0] === first; });
  return hit.length === 1 ? hit[0] : null;
}

const SKELETON = /^Priced from Pinnacle's odds only \(automatic fallback/;
// Fill what's missing on one upcoming game; returns a list of what was added
export function attach(m, db) {
  const added = [], div = divFor(m.competition);
  const hn = findTeam(m.home, db.teams, div), an = findTeam(m.away, db.teams, div);
  const H = hn && db.teams[hn], A = an && db.teams[an];
  if (H && A && !m.form20 && H.n >= 8 && A.n >= 8) {
    m.form20 = { home: { gf: H.gf, ga: H.ga, games: H.n }, away: { gf: A.gf, ga: A.ga, games: A.n } };
    added.push("form");
  }
  if (H && A) {
    const s = m.season = m.season || {}; s.home = s.home || {}; s.away = s.away || {};
    const league = div && H.div === div && A.div === div;
    if (league && s.home.gf == null && H.cur.n >= 5 && A.cur.n >= 5) { s.home.gf = H.cur.gf; s.home.ga = H.cur.ga; s.away.gf = A.cur.gf; s.away.ga = A.cur.ga; added.push("season goals"); }
    if (H.corners && A.corners && s.home.corners == null && s.away.corners == null) {
      const venue = H.corners.home.n >= 4 && A.corners.away.n >= 4;
      s.home.corners = r2(venue ? (H.corners.home.cf + A.corners.away.ca) / 2 : (H.corners.cf + A.corners.ca) / 2);
      s.away.corners = r2(venue ? (A.corners.away.cf + H.corners.home.ca) / 2 : (A.corners.cf + H.corners.ca) / 2);
      added.push("corners");
    }
    for (const [k, v] of [["fouls", "fouls"], ["shots", "shots"], ["sot", "sot"]]) {
      if (s.home[k] == null && H[v] != null) s.home[k] = H[v];
      if (s.away[k] == null && A[v] != null) s.away[k] = A[v];
    }
    if (H.yellowsPg != null && A.yellowsPg != null && !(m.teamStats && m.teamStats.home && m.teamStats.home.yellowsPg != null)) {
      m.teamStats = { home: { yellowsPg: H.yellowsPg, redsPg: H.redsPg }, away: { yellowsPg: A.yellowsPg, redsPg: A.redsPg } };
      added.push("cards");
    }
  }
  if (m.referee && m.referee.name && m.referee.yellowsPg == null) {
    const rn = findRef(m.referee.name, db.refs || {}), R = rn && db.refs[rn];
    if (R && R.games >= 3) { Object.assign(m.referee, { games: R.games, yellowsPg: R.yellowsPg, redsPg: R.redsPg, foulsPg: R.foulsPg, note: `football-data.co.uk: ${R.games} league games as ${rn}, last two seasons` }); added.push("referee"); }
  }
  if (added.length) {
    m.sources = m.sources || [];
    if (!m.sources.some((x) => /football-data\.co\.uk/.test(x.url || ""))) m.sources.push({ title: `football-data.co.uk results and match stats (${hn || "?"}, ${an || "?"}: last ${H ? H.n : 0} and ${A ? A.n : 0} league games)`, url: BASE });
    if (added.includes("form") && SKELETON.test(m.context || "")) m.context = "Pinnacle odds with automatic form, corners and cards from football-data.co.uk (last 20 league games); the research run adds team news and lineups.";
  }
  return added;
}
