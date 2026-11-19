// Turn an OddsPapi fixture into the odds schema each sport page uses, and merge it into site files.
const r3 = x => Math.round(x * 1000) / 1000;
// group a bookmaker's markets by (type, period): [{hcp, main, o: {outcomeName: price}}]
function groups(fx, slug, MK) {
  const bk = fx.bookmakerOdds && fx.bookmakerOdds[slug]; if (!bk || bk.suspended) return null;
  const g = {};
  for (const [mid, m] of Object.entries(bk.markets || {})) {
    const def = MK[mid]; if (!def || m.marketActive === false) continue;
    const [, type, period, hcp, names] = def, o = {}; let main = false, ok = true;
    for (const [oid, out] of Object.entries(m.outcomes || {})) {
      const p = out.players && out.players["0"]; if (!p || !p.price || p.active === false) { ok = false; continue; }
      o[names[oid]] = p.price; if (p.mainLine) main = true;
    }
    if (!ok || Object.keys(o).length < Object.keys(names).length) continue;
    (g[type + "|" + period] ||= []).push({ hcp, main, o });
  }
  return g;
}
function pickMain(list, a, b) {
  if (!list || !list.length) return null;
  const m = list.filter(x => x.main); if (m.length === 1) return m[0];
  return (m.length ? m : list).slice().sort((x, y) => Math.abs(x.o[a] - x.o[b]) - Math.abs(y.o[a] - y.o[b]))[0];
}
const two = (x, a, b) => x && x.o[a] && x.o[b] ? [r3(x.o[a]), r3(x.o[b])] : null;
const line = (x, a, b, ka, kb) => x ? { line: x.hcp, [ka]: r3(x.o[a]), [kb]: r3(x.o[b]) } : null;

export function normalize(fx, slug, MK, sport) {
  const g = groups(fx, slug, MK); if (!g) return null;
  const out = {};
  if (sport === "football") {
    const x = g["1x2|fulltime"] && g["1x2|fulltime"][0]; if (x) { out.h = r3(x.o["1"]); out.d = r3(x.o.X); out.a = r3(x.o["2"]); }
    const ou = {}; (g["totals|fulltime"] || []).forEach(t => { if (t.hcp % 1 === 0.5 && t.hcp <= 5.5) ou[t.hcp.toFixed(1)] = two(t, "Over", "Under"); }); if (Object.keys(ou).length) out.ou = ou;
    const bt = g["bothteamsscore|fulltime"] && g["bothteamsscore|fulltime"][0]; if (bt) out.btts = two(bt, "Yes", "No");
    const ah = (g["spreads|fulltime"] || []).filter(t => t.hcp % 0.5 === 0 && t.o["1"] > 1.4 && t.o["2"] > 1.4).map(t => ({ line: t.hcp, home: r3(t.o["1"]), away: r3(t.o["2"]) })); if (ah.length) out.ah = ah.sort((p, q) => p.line - q.line);
    for (const [k, key] of [["corners", "totals-corners|fulltime"], ["cards", "totals-bookings|fulltime"]]) {
      const o = {}; (g[key] || []).forEach(t => { if (t.hcp % 1 === 0.5) o[t.hcp.toFixed(1)] = two(t, "Over", "Under"); }); if (Object.keys(o).length) out[k] = o;
    }
  } else {
    const ml = g["moneyline|result"] && g["moneyline|result"][0]; if (ml) out.ml = two(ml, "1", "2");
    const tot = pickMain(g["totals|result"], "Over", "Under"); if (tot) out.total = line(tot, "Over", "Under", "o", "u");
    const tt = {}; for (const [s, k] of [["home", "teamtotals-team1|result"], ["away", "teamtotals-team2|result"]]) { const t = pickMain(g[k], "Over", "Under"); if (t) tt[s] = line(t, "Over", "Under", "o", "u"); }
    if (tt.home || tt.away) out.teamTotal = tt;
    if (sport === "basketball") {
      const sp = pickMain(g["spreads|result"], "1", "2"); if (sp) out.spread = line(sp, "1", "2", "h", "a");
      const hs = pickMain(g["spreads|p1+p2"], "1", "2"), ht = pickMain(g["totals|p1+p2"], "Over", "Under");
      if (hs || ht) out.h1 = { ...(hs ? { spread: line(hs, "1", "2", "h", "a") } : {}), ...(ht ? { total: line(ht, "Over", "Under", "o", "u") } : {}) };
    } else {
      const rg = g["1x2|fulltime"] && g["1x2|fulltime"][0]; if (rg) out.reg = [r3(rg.o["1"]), r3(rg.o.X), r3(rg.o["2"])];
      const favHome = out.ml ? out.ml[0] <= out.ml[1] : true;
      const pk = (g["spreads|result"] || []).find(t => t.hcp === (favHome ? -1.5 : 1.5)); if (pk) out.puck = line(pk, "1", "2", "h", "a");
      const p1 = pickMain(g["totals|p1"], "Over", "Under"); if (p1) out.p1total = line(p1, "Over", "Under", "o", "u");
      // 60-minute markets: how European bookmakers usually settle hockey totals and handicaps
      const tr = pickMain(g["totals|fulltime"], "Over", "Under"); if (tr) out.totalReg = line(tr, "Over", "Under", "o", "u");
      const hr = (g["spreads|fulltime"] || []).find(t => t.hcp === (favHome ? -1.5 : 1.5)); if (hr) out.hcpReg = line(hr, "1", "2", "h", "a");
      const bt = g["bothteamsscore|fulltime"] && g["bothteamsscore|fulltime"][0]; if (bt) out.btts = two(bt, "Yes", "No");
    }
  }
  return Object.keys(out).length ? out : null;
}

// ---------- matching site games to fixtures ----------
const ALIAS = { "korea republic": "south korea", "ir iran": "iran", "turkiye": "turkey", "czechia": "czech republic", "usa": "united states", "la clippers": "los angeles clippers" };
export function norm(s) {
  let n = String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return ALIAS[n] || n;
}
function sameTeam(a, b) {
  a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true;
  const ta = a.split(" ").filter(w => w.length > 2 && !/^(fc|cf|ac|sc|afc|the|club)$/.test(w)), tb = b.split(" ");
  return ta.length > 0 && ta.every(w => tb.includes(w)) || tb.filter(w => w.length > 2).length > 0 && tb.filter(w => w.length > 2 && !/^(fc|cf|ac|sc|afc|club)$/.test(w)).every(w => a.split(" ").includes(w));
}
export function findFixture(game, fixtures) {
  const H = game.home && (game.home.name || game.home), A = game.away && (game.away.name || game.away);
  const t = Date.parse(game.start || game.kickoff || "");
  return fixtures.find(f => sameTeam(H, f.home) && sameTeam(A, f.away) && (!t || Math.abs(Date.parse(f.start) - t) < 6 * 3600e3))
    || fixtures.find(f => sameTeam(H, f.away) && sameTeam(A, f.home) && (!t || Math.abs(Date.parse(f.start) - t) < 6 * 3600e3) && (f.swapped = true));
}
const fmt = (o, sport) => sport === "football"
  ? [o.h && `1X2 ${o.h}/${o.d}/${o.a}`, o.ou && o.ou["2.5"] && `O/U 2.5 ${o.ou["2.5"].join("/")}`].filter(Boolean).join(", ")
  : [o.ml && `win ${o.ml.join("/")}`, o.spread && `${o.spread.line > 0 ? "+" : ""}${o.spread.line} ${o.spread.h}/${o.spread.a}`, o.puck && `${o.puck.line > 0 ? "+" : ""}${o.puck.line} ${o.puck.h}/${o.puck.a}`, o.total && `total ${o.total.line} ${o.total.o}/${o.total.u}`].filter(Boolean).join(", ");

// Merge main-book odds into a site game; local-book prices are kept alongside for comparison.
export function applyToGame(game, fx, sport, at) {
  if (!fx || game.result || Date.parse(game.start || game.kickoff || 0) <= Date.now()) return false;
  const main = fx.odds.pinnacle, local = fx.odds["admiralbet.ba"]; if (!main && !local) return false;
  const src = main || local, old = game.odds || {};
  const keep = sport === "football" ? ["dnb", "dc", "wtn", "firstGoal", "scorers", "assists", "props"] : ["props"];
  const o = {};
  keep.forEach(k => { if (old[k] != null) o[k] = old[k]; });
  // the main book first; anything it lacks comes from the local book
  for (const [k, v] of Object.entries(local || {})) o[k] = v;
  for (const [k, v] of Object.entries(src)) o[k] = v;
  if (sport === "football" && (old.corners || old.cards)) { if (!o.corners && old.corners) o.corners = old.corners; if (!o.cards && old.cards) o.cards = old.cards; }
  const when = at.slice(11, 16) + " UTC";
  o.book = `${main ? "Pinnacle" : "AdmiralBet BA"} via OddsPapi, ${at.slice(0, 10)} ${when}` + (main && local ? "; lines Pinnacle lacks are AdmiralBet BA" : "");
  if (local) o.local = { book: "AdmiralBet BA", ...local, text: fmt(local, sport) };
  game.odds = o;
  // Team news already set as an `adjust` is in the new price by now: keep it for the record, stop applying it
  // (otherwise the refreshed line and the adjustment would count the same injury twice).
  const adj = game.adjust, live = adj && Object.values(adj).some(v => typeof v === "number" && v !== 0 && v !== 1);
  if (live) { game.adjustPriced = { ...adj, retiredAt: at }; delete game.adjust; }
  return true;
}

// Site competition/league text -> OddsPapi tournament ID
export function tournamentFor(text, sportId, cfg, T) {
  const raw = String(text || ""), country = (/\(([^)]+)\)/.exec(raw) || [])[1];
  const base = norm(raw.replace(/\(.*?\)/g, "").split(/[,–-]/)[0]);
  const bySport = (cfg.aliasesBySport || {})[sportId] || {};
  for (const [k, id] of Object.entries(bySport)) if (base === k) return id;
  for (const [k, id] of Object.entries(cfg.aliases || {})) if (base === k) return id;
  const rows = (T && T[sportId]) || [], hits = rows.filter(r => norm(r[1]) === base);
  if (!hits.length) { for (const [k, id] of Object.entries(cfg.aliases || {})) if (base.includes(k)) return id; return null; }
  const c = country && hits.find(r => norm(r[2]) === norm(country));
  return (c || hits.sort((a, b) => b[3] - a[3])[0])[0];
}
