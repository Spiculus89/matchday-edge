// Grading from ESPN's public JSON (24 Nov 2026): finds each site game on ESPN, reads the final
// score, team stats and player lines, and settles the picks the page showed.
// Pure functions only; scripts/grade-espn.mjs does the fetching and writing.

const STOP = new Set(["fc", "cf", "ac", "sc", "afc", "club", "ssc", "rc", "fk", "sk", "the", "de", "cd", "ud", "sv", "as", "us", "ca", "se", "ec"]);
export function normName(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/gi, "o").replace(/æ/gi, "ae").replace(/ß/g, "ss").replace(/ł/gi, "l")
    .toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s) { return normName(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)); }
const tokEq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// Share of the site name's words found in any of ESPN's names for the team (0..1)
export function nameScore(site, names) {
  const t = tokens(site); if (!t.length) return 0;
  let best = 0;
  for (const n of names.filter(Boolean)) {
    const u = tokens(n); if (!u.length) continue;
    const hit = t.filter((w) => u.some((v) => tokEq(w, v))).length;
    best = Math.max(best, hit / Math.min(t.length, u.length));
  }
  return Math.min(1, best);
}
const teamNames = (c) => { const t = (c && c.team) || {}; return [t.displayName, t.shortDisplayName, t.name, t.location, t.nickname, t.abbreviation]; };

// The ESPN event for a site game: same kick-off (within 3 hours), best name match on both sides
export function matchEvent(match, events) {
  const t = Date.parse(match.kickoff || match.start);
  let best = null, bs = 0;
  for (const e of events || []) {
    if (t && Math.abs(Date.parse(e.date) - t) > 3 * 3600e3) continue;
    const cs = (e.competitions && e.competitions[0] && e.competitions[0].competitors) || [];
    const H = cs.find((c) => c.homeAway === "home"), A = cs.find((c) => c.homeAway === "away");
    if (!H || !A) continue;
    const sh = nameScore(match.home.name, teamNames(H)), sh2 = nameScore(match.home.short, teamNames(H));
    const sa = nameScore(match.away.name, teamNames(A)), sa2 = nameScore(match.away.short, teamNames(A));
    const s = Math.max(sh, sh2) + Math.max(sa, sa2);
    if (Math.min(Math.max(sh, sh2), Math.max(sa, sa2)) < 0.5) continue;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}

// ESPN league slug for a site competition name
const SLUGS = [
  [/emirates|uae/i, "uae.1"], [/saudi/i, "ksa.1"], [/brasil|brazil/i, "bra.1"], [/uruguay/i, "uru.1"], [/argentin/i, "arg.1"], [/liga mx|mexico/i, "mex.1"], [/\bmls\b/i, "usa.1"],
  [/champions league/i, "uefa.champions"], [/conference league/i, "uefa.europa.conf"], [/europa league/i, "uefa.europa"],
  [/nations league/i, "uefa.nations"], [/world cup qual/i, "fifa.worldq.uefa"], [/friendl/i, "fifa.friendly"],
  [/championship/i, "eng.2"], [/league one/i, "eng.3"], [/league two/i, "eng.4"], [/fa cup/i, "eng.fa"], [/efl cup|carabao|league cup/i, "eng.league_cup"],
  [/scottish|scotland/i, "sco.1"], [/premier league/i, "eng.1"],
  [/copa del rey/i, "esp.copa_del_rey"], [/laliga 2|segunda/i, "esp.2"], [/laliga|la liga|spain/i, "esp.1"],
  [/coppa italia/i, "ita.coppa_italia"], [/serie b/i, "ita.2"], [/serie a|italy/i, "ita.1"],
  [/pokal/i, "ger.dfb_pokal"], [/2\. bundesliga/i, "ger.2"], [/bundesliga|germany/i, "ger.1"],
  [/coupe de france/i, "fra.coupe_de_france"], [/ligue 2/i, "fra.2"], [/ligue 1|france/i, "fra.1"],
  [/eredivisie|netherlands/i, "ned.1"], [/portugal|primeira/i, "por.1"], [/belgi|pro league/i, "bel.1"], [/s[uü]per lig|turk/i, "tur.1"],
  [/ekstraklasa|poland/i, "pol.1"], [/greece|greek/i, "gre.1"], [/austria/i, "aut.1"], [/swiss|switzerland/i, "sui.1"], [/denmark|danish/i, "den.1"],
  [/norway|eliteserien/i, "nor.1"], [/sweden|allsvenskan/i, "swe.1"]
];
export function leagueSlug(competition) { for (const [re, s] of SLUGS) if (re.test(competition || "")) return s; return null; }

const num = (x) => { if (x == null) return null; const v = typeof x === "object" ? (x.value != null ? x.value : x.displayValue) : x; const n = Number(String(v).replace("%", "")); return Number.isFinite(n) ? n : null; };
const stat = (arr, name) => { const s = (arr || []).find((x) => x.name === name); return s ? num(s.value != null ? s.value : s.displayValue) : null; };

// Final score, team stats and player lines from an ESPN summary
export function parseSummary(js) {
  const comp = js && js.header && js.header.competitions && js.header.competitions[0];
  if (!comp) return null;
  const st = (comp.status && comp.status.type) || {};
  const text = [st.name, st.description, st.detail, st.shortDetail].join(" ");
  const finished = st.completed === true || st.state === "post";
  const extra = /AET|PEN|extra time|after extra|ET\)|Pens/i.test(text);
  const cs = comp.competitors || [];
  const side = {}; cs.forEach((c) => { side[c.team && c.team.id] = c.homeAway; });
  const H = cs.find((c) => c.homeAway === "home"), A = cs.find((c) => c.homeAway === "away");
  const out = { finished: finished && !/postpon|abandon|cancel|suspend/i.test(text), extra, status: st.name || st.description || "",
    home: H ? num(H.score) : null, away: A ? num(A.score) : null, teams: {}, players: { home: [], away: [] }, ok: {} };
  for (const t of (js.boxscore && js.boxscore.teams) || []) {
    const ha = t.homeAway || side[t.team && t.team.id]; if (!ha) continue;
    const s = t.statistics || [];
    out.teams[ha] = { corners: stat(s, "wonCorners"), fouls: stat(s, "foulsCommitted"), yellow: stat(s, "yellowCards"), red: stat(s, "redCards"),
      shots: stat(s, "totalShots"), sot: stat(s, "shotsOnTarget") };
  }
  for (const r of js.rosters || []) {
    const ha = r.homeAway || side[r.team && r.team.id]; if (!ha) continue;
    out.players[ha] = (r.roster || []).map((p) => {
      const s = p.stats || [];
      const apps = stat(s, "appearances");
      return { name: (p.athlete && (p.athlete.displayName || p.athlete.fullName)) || "", played: !!(p.starter || p.subbedIn || (apps != null && apps > 0)),
        shots: stat(s, "totalShots"), sot: stat(s, "shotsOnTarget"), fouls: stat(s, "foulsCommitted"), goals: stat(s, "totalGoals"), assists: stat(s, "goalAssists") };
    });
  }
  // Player lines are only trusted where they add up to the team total (RUNBOOK, 16 Nov)
  for (const ha of ["home", "away"]) {
    out.ok[ha] = {};
    for (const k of ["shots", "sot", "fouls"]) {
      const team = out.teams[ha] && out.teams[ha][k], pl = out.players[ha];
      out.ok[ha][k] = team != null && pl.length > 0 && pl.every((p) => !p.played || p[k] != null) && pl.reduce((a, p) => a + (p[k] || 0), 0) === team;
    }
    const goals = out.players[ha].reduce((a, p) => a + (p.goals || 0), 0);
    out.ok[ha].goals = out.players[ha].length > 0 && goals === (ha === "home" ? out.home : out.away);
  }
  return out;
}

function findPlayer(F, name) {
  const n = normName(name), last = n.split(" ").pop(), first = n[0];
  const all = ["home", "away"].flatMap((ha) => F.players[ha].map((p) => ({ ...p, side: ha, n: normName(p.name) })));
  let hit = all.filter((p) => p.n === n);
  if (hit.length !== 1) hit = all.filter((p) => p.n.split(" ").pop() === last && p.n[0] === first);
  if (hit.length !== 1) hit = all.filter((p) => p.n.split(" ").pop() === last);
  return hit.length === 1 ? hit[0] : null;
}

// Settle one selection: true (won), false (lost), "void" (stake back) or null (can't tell from ESPN)
export function settle(sel, names, F) {
  const h = F.home, a = F.away, tot = h + a;
  const side = (t) => (t === names.home ? "home" : t === names.away ? "away" : null);
  const margin = (s) => (s === "home" ? h - a : a - h);
  const over = (dir, L, n) => (n === L ? "void" : dir === "Over" ? n > L : n < L);
  let m;
  if (sel === "Draw") return h === a;
  if (sel === "Either team to win") return h !== a;
  if ((m = /^(.*) to win to nil$/.exec(sel))) { const s = side(m[1]); return s ? margin(s) > 0 && (s === "home" ? a : h) === 0 : null; }
  if ((m = /^(.*) to win$/.exec(sel))) { const s = side(m[1]); return s ? margin(s) > 0 : null; }
  if ((m = /^(.*) or draw$/.exec(sel))) { const s = side(m[1]); return s ? margin(s) >= 0 : null; }
  if ((m = /^(.*) draw no bet$/.exec(sel))) { const s = side(m[1]); return !s ? null : h === a ? "void" : margin(s) > 0; }
  if ((m = /^(.*) ([+-]?\d+(?:\.\d+)?) \(Asian handicap\)$/.exec(sel))) {
    const s = side(m[1]), line = +m[2];
    if (!s || Math.abs(line * 4) % 2 === 1) return null; // quarter lines settle in halves
    const d = margin(s) + line; return d > 0 ? true : d < 0 ? false : "void";
  }
  if ((m = /^(Over|Under) (\d+(?:\.\d+)?) goals$/.exec(sel))) return over(m[1], +m[2], tot);
  if (sel === "Both teams to score" || sel === "BTTS") return h > 0 && a > 0;
  if (sel === "Both teams to score: No" || sel === "BTTS: No") return h === 0 || a === 0;
  if ((m = /^(Over|Under) (\d+(?:\.\d+)?) corners$/.exec(sel))) {
    const c = F.teams.home && F.teams.away && F.teams.home.corners != null && F.teams.away.corners != null ? F.teams.home.corners + F.teams.away.corners : null;
    return c == null ? null : over(m[1], +m[2], c);
  }
  if ((m = /^Most corners: (.*)$/.exec(sel))) {
    const s = side(m[1]), H = F.teams.home && F.teams.home.corners, A = F.teams.away && F.teams.away.corners;
    if (!s || H == null || A == null) return null;
    return s === "home" ? H > A : A > H;
  }
  if ((m = /^(Over|Under) (\d+(?:\.\d+)?) cards$/.exec(sel))) {
    const t = [F.teams.home, F.teams.away];
    if (t.some((x) => !x || x.yellow == null || x.red == null)) return null;
    const y = t[0].yellow + t[1].yellow, r = t[0].red + t[1].red, L = +m[2];
    // bookmakers differ on how a second yellow and a red count: too close to the line to call
    if (r > 0 && Math.abs(y + r - L) < 1.6) return null;
    return over(m[1], L, y + r);
  }
  if ((m = /^(.*) to score first$/.exec(sel))) return null;
  if ((m = /^(.*) to score$/.exec(sel))) {
    const p = findPlayer(F, m[1]);
    if (!p || !p.played || p.goals == null || !F.ok[p.side].goals) return null;
    return p.goals > 0;
  }
  return null;
}

// Player prop "Name 2+ shots on target"
export function settleProp(player, market, F) {
  const pm = /(\d+)\+?\s*(shots on target|shot on target|shots|shot|fouls committed|fouls|foul|tackles|tackle)/i.exec(market || "");
  if (!pm) return null;
  const k = +pm[1], w = pm[2].toLowerCase(), key = /target/.test(w) ? "sot" : /shot/.test(w) ? "shots" : /foul/.test(w) ? "fouls" : null;
  if (!key) return null; // ESPN has no tackles
  const p = findPlayer(F, player);
  if (!p || !p.played || p[key] == null || !F.ok[p.side][key]) return null;
  return p[key] >= k;
}

// The picks the page showed for one game, from BetEngine.analyse(match) (RUNBOOK step 0)
const GROUP = { Result: "Result", "Double chance": "Result", "Win to nil": "Result", "First goal": "Result", "Draw no bet": "Handicap", Handicap: "Handicap",
  Goals: "Goals", BTTS: "BTTS", Corners: "Corners", Cards: "Cards", Scorer: "Scorer" };
export function shownPicks(r) {
  const P = r.picks, out = [];
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  if (P.top) out.push({ group: GROUP[P.top.group] || P.top.group, pick: P.top.label + " (best bet)", p: r3(P.top.p), odds: P.top.odds || null, sel: [P.top.label] });
  if (P.likely) out.push({ group: GROUP[P.likely.group] || "Result", pick: P.likely.label + " (most likely)", p: r3(P.likely.p), odds: P.likely.odds || null, sel: [P.likely.label] });
  if (P.builder) out.push({ group: "Bet builder", pick: P.builder.legs.join(" + "), p: r3(P.builder.p), odds: null, sel: P.builder.legs });
  for (const row of P.slip || []) {
    if (row.grade !== "Bet" && row.grade !== "Lean") continue;
    let label = row.pick, group, sel;
    if (row.market === "Result / handicap") group = /draw no bet|Asian handicap/.test(label) ? "Handicap" : "Result";
    else if (row.market === "Total goals") group = "Goals";
    else if (row.market === "Both teams to score") { group = "BTTS"; label = row.pick === "Yes" ? "Both teams to score" : "Both teams to score: No"; }
    else if (row.market === "Anytime scorer") { group = "Scorer"; label = row.pick + " to score"; }
    else if (row.market === "Corners") group = "Corners";
    else if (row.market === "Cards") group = "Cards";
    else if (row.market === "Most corners") { group = "Most corners"; sel = ["Most corners: " + row.pick]; }
    else continue; // assists: no group for them on the track record
    out.push({ group, pick: label + " (" + row.grade + ")", p: r3(row.p), odds: row.odds || null, sel: sel || [label] });
  }
  for (const pr of P.props || []) if (pr.odds) out.push({ group: "Player prop", pick: pr.player + " " + pr.market, p: r3(pr.p), odds: pr.odds, prop: pr });
  return out;
}

// Settle a shown pick: {won, void} or null
export function settleShown(x, names, F) {
  if (x.prop) { const w = settleProp(x.prop.player, x.prop.market, F); return w == null ? null : { won: w }; }
  const res = x.sel.map((s) => settle(s, names, F));
  if (res.some((v) => v == null)) return null;
  if (res.some((v) => v === false)) return { won: false };
  if (res.every((v) => v === "void")) return { won: false, void: true };
  if (res.some((v) => v === "void")) return null; // a void leg inside a builder: settle by hand
  return { won: true };
}
