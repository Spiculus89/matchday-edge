// Turn API-Football responses into the small shapes the page needs.
// Parsers are defensive: a missing field gives null instead of an error, so one odd
// response never takes the whole page down.

const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? x : null; };

export function fixtureSummary(f) {
  const fx = f.fixture || {}, lg = f.league || {}, t = f.teams || {};
  return {
    fixtureId: fx.id,
    kickoff: fx.date,
    status: { short: fx.status && fx.status.short, long: fx.status && fx.status.long, elapsed: fx.status && fx.status.elapsed },
    referee: fx.referee || null,
    venue: { name: fx.venue && fx.venue.name, city: fx.venue && fx.venue.city },
    league: { id: lg.id, name: lg.name, country: lg.country, season: lg.season, round: lg.round, logo: lg.logo },
    home: { id: t.home && t.home.id, name: t.home && t.home.name, logo: t.home && t.home.logo },
    away: { id: t.away && t.away.id, name: t.away && t.away.name, logo: t.away && t.away.logo },
    goals: f.goals || { home: null, away: null },
    popularity: f.popularity || null
  };
}

function lineupSide(l) {
  if (!l) return null;
  const p = (x) => ({ id: x.player && x.player.id, name: x.player && x.player.name, number: x.player && x.player.number, pos: x.player && x.player.pos });
  return {
    teamId: l.team && l.team.id,
    formation: l.formation || null,
    coach: l.coach && l.coach.name,
    xi: (l.startXI || []).map(p),
    subs: (l.substitutes || []).map(p)
  };
}

export function lineups(f) {
  const ls = f.lineups || [];
  const homeId = f.teams && f.teams.home && f.teams.home.id, awayId = f.teams && f.teams.away && f.teams.away.id;
  const home = ls.find((l) => l.team && l.team.id === homeId) || ls[0];
  const away = ls.find((l) => l.team && l.team.id === awayId) || ls[1];
  const h = lineupSide(home), a = lineupSide(away);
  const confirmed = !!(h && h.xi.length >= 11 && a && a.xi.length >= 11);
  return confirmed ? { home: h, away: a } : null;
}

export function lineupForTeam(f, teamId) {
  const l = (f.lineups || []).find((x) => x.team && x.team.id === teamId);
  const s = lineupSide(l);
  return s && s.xi.length >= 11 ? { ...s, fixtureId: f.fixture && f.fixture.id, date: f.fixture && f.fixture.date, opponent: opponentName(f, teamId) } : null;
}
function opponentName(f, teamId) {
  const t = f.teams || {};
  if (t.home && t.home.id === teamId) return t.away && t.away.name;
  return t.home && t.home.name;
}

export function injuries(response) {
  return (response || []).map((r) => ({
    fixtureId: r.fixture && r.fixture.id,
    teamId: r.team && r.team.id,
    team: r.team && r.team.name,
    player: { id: r.player && r.player.id, name: r.player && r.player.name },
    type: r.player && r.player.type,     // "Missing Fixture" or "Questionable"
    reason: r.player && r.player.reason  // e.g. "Knee Injury", "Suspended", "Red Card"
  }));
}

// ---------- odds ----------
function pickBook(bookmakers) {
  if (!bookmakers || !bookmakers.length) return null;
  const pref = (process.env.ODDS_BOOKMAKER || "bet365").toLowerCase();
  return bookmakers.find((b) => String(b.name || "").toLowerCase() === pref)
    || bookmakers.slice().sort((a, b) => (b.bets || []).length - (a.bets || []).length)[0];
}
function bet(book, re) { return (book.bets || []).find((b) => re.test(b.name || "")); }
function val(b, re) { if (!b) return null; const v = (b.values || []).find((x) => re.test(String(x.value))); return v ? n(v.odd) : null; }
function overUnder(b) {
  if (!b) return null;
  const out = {};
  for (const v of b.values || []) {
    const m = /^(Over|Under)\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(String(v.value).trim());
    if (!m) continue;
    const line = String(parseFloat(m[2]));
    if (!/\.5$/.test(line)) continue; // half lines only: no pushes
    out[line] = out[line] || [null, null];
    out[line][/over/i.test(m[1]) ? 0 : 1] = n(v.odd);
  }
  Object.keys(out).forEach((k) => { if (!out[k][0] || !out[k][1]) delete out[k]; });
  return Object.keys(out).length ? out : null;
}

export function odds(response) {
  const r = (response || [])[0];
  if (!r) return null;
  const book = pickBook(r.bookmakers);
  if (!book) return null;
  const o = { book: book.name, updated: r.update || null };
  const mw = bet(book, /^Match Winner$/i);
  o.h = val(mw, /^Home$/i); o.d = val(mw, /^Draw$/i); o.a = val(mw, /^Away$/i);
  if (!(o.h && o.d && o.a)) { delete o.h; delete o.d; delete o.a; }
  o.ou = overUnder(bet(book, /^Goals Over\/Under$/i));
  const bt = bet(book, /^Both Teams (To )?Score$/i);
  if (val(bt, /^Yes$/i) && val(bt, /^No$/i)) o.btts = [val(bt, /^Yes$/i), val(bt, /^No$/i)];
  const dc = bet(book, /^Double Chance$/i);
  if (dc) o.dc = { "1X": val(dc, /^Home\/Draw$/i), "X2": val(dc, /^Draw\/Away$/i), "12": val(dc, /^Home\/Away$/i) };
  const dnb = bet(book, /^Home\/Away$|^Draw No Bet$/i);
  if (val(dnb, /^Home$/i) && val(dnb, /^Away$/i)) o.dnb = { home: val(dnb, /^Home$/i), away: val(dnb, /^Away$/i) };
  const wtn = bet(book, /^Win to Nil$/i);
  if (wtn) o.wtn = { home: val(wtn, /^Home$/i), away: val(wtn, /^Away$/i) };
  const fg = bet(book, /^(First Team to Score|Team To Score First)$/i);
  if (fg) o.firstGoal = { home: val(fg, /^Home$/i), away: val(fg, /^Away$/i) };
  const ah = bet(book, /^Asian Handicap$/i);
  if (ah) {
    const lines = {};
    for (const v of ah.values || []) {
      const m = /^(Home|Away)\s*([+-]?[0-9]+(?:\.[0-9]+)?)$/i.exec(String(v.value).trim());
      if (!m) continue;
      const side = m[1].toLowerCase(), L = parseFloat(m[2]);
      const homeLine = side === "home" ? L : -L;
      const k = String(homeLine);
      lines[k] = lines[k] || { line: homeLine };
      lines[k][side] = n(v.odd);
    }
    o.ah = Object.values(lines).filter((x) => x.home && x.away).sort((a, b) => a.line - b.line);
  }
  o.corners = overUnder(bet(book, /^(Corners Over Under|Total Corners|Corners Over\/Under)$/i));
  o.cards = overUnder(bet(book, /^(Cards Over\/Under|Total Cards|Cards Over Under)$/i));
  const sc = bet(book, /^Anytime Goal ?Scorer$/i);
  if (sc) {
    o.scorers = {};
    for (const v of sc.values || []) { const x = n(v.odd); if (x) o.scorers[String(v.value)] = x; }
  }
  Object.keys(o).forEach((k) => { if (o[k] == null) delete o[k]; });
  return o;
}

// ---------- players and teams ----------
export function scorers(response) {
  return (response || []).map((r) => {
    const s = (r.statistics || [])[0] || {};
    return {
      id: r.player && r.player.id, name: r.player && r.player.name,
      teamId: s.team && s.team.id, team: s.team && s.team.name,
      pos: s.games && s.games.position,
      apps: s.games && (s.games.appearences != null ? s.games.appearences : s.games.appearances),
      minutes: s.games && s.games.minutes,
      goals: s.goals && s.goals.total || 0,
      assists: s.goals && s.goals.assists || 0,
      shots: s.shots && s.shots.total || null,
      sot: s.shots && s.shots.on || null,
      pens: s.penalty && s.penalty.scored || 0,
      yellows: s.cards && s.cards.yellow || 0
    };
  });
}

function sumMinuteBuckets(obj) {
  if (!obj) return null;
  let t = 0, seen = false;
  for (const k of Object.keys(obj)) { const v = obj[k] && obj[k].total; if (v != null) { t += v; seen = true; } }
  return seen ? t : null;
}

export function teamStats(r) {
  if (!r || Array.isArray(r) && !r.length) return null;
  const s = Array.isArray(r) ? r[0] : r;
  const played = s.fixtures && s.fixtures.played && s.fixtures.played.total || 0;
  const g = s.goals || {};
  const gf = n(g.for && g.for.average && g.for.average.total);
  const ga = n(g.against && g.against.average && g.against.average.total);
  const yellow = sumMinuteBuckets(s.cards && s.cards.yellow);
  const red = sumMinuteBuckets(s.cards && s.cards.red);
  return {
    played, gf, ga,
    form: s.form || null,
    cleanSheets: s.clean_sheet && s.clean_sheet.total,
    failedToScore: s.failed_to_score && s.failed_to_score.total,
    yellowsPg: played && yellow != null ? yellow / played : null,
    redsPg: played && red != null ? red / played : null,
    goalsTotal: g.for && g.for.total && g.for.total.total
  };
}
