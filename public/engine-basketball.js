/* Matchday Edge: basketball engine.
 * The final margin and the total are modelled as normal distributions. Their means come from
 * the bookmaker's spread, moneyline and total with the margin taken out (75%), blended with
 * the teams' recent points for and against (25%), plus injury adjustments. Every market
 * (moneyline, spread, total, team totals, first half, player props) is priced from those two
 * numbers, then compared with the price on offer. Same Bet / Lean / Skip rules as football.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HoopsEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // League shapes. sigma = spread of final margin / total around their means.
  var LEAGUES = {
    NBA: { minutes: 48, sigM: 12.5, sigT: 18.5, hca: 2.4, avgTotal: 228 },
    WNBA: { minutes: 40, sigM: 11.5, sigT: 15.5, hca: 2.5, avgTotal: 164 },
    NCAA: { minutes: 40, sigM: 11.5, sigT: 16, hca: 3.2, avgTotal: 145 },
    EURO: { minutes: 40, sigM: 11, sigT: 15, hca: 3.0, avgTotal: 162, h1Share: 0.5 }
  };
  function league(g) {
    var l = String(g.league || "").toUpperCase();
    if (/^NBA/.test(l)) return LEAGUES.NBA;
    if (/WNBA/.test(l)) return LEAGUES.WNBA;
    if (/NCAA|COLLEGE/.test(l)) return LEAGUES.NCAA;
    return LEAGUES.EURO; // EuroLeague, EuroCup, ACB, ABA, BBL, LNB, Lega A, national teams
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round(x, d) { var k = Math.pow(10, d || 0); return Math.round(x * k) / k; }
  function fair(p) { return p > 0 ? 1 / p : null; }
  function devig(odds) {
    var inv = odds.map(function (o) { return o ? 1 / o : 0; }), s = inv.reduce(function (a, b) { return a + b; }, 0);
    return inv.map(function (x) { return x / s; });
  }
  function erf(x) { var t = 1 / (1 + 0.3275911 * Math.abs(x)); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }
  function phi(z) { return Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); }
  function PhiInv(p) { // Acklam
    p = clamp(p, 1e-9, 1 - 1e-9);
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // P(X > line) for X ~ N(mu, sd), with the push on whole-number lines split out
  function overLine(mu, sd, line) {
    var isInt = Math.abs(line - Math.round(line)) < 1e-9;
    if (!isInt) return { win: 1 - Phi((line - mu) / sd), push: 0 };
    var push = Phi((line + 0.5 - mu) / sd) - Phi((line - 0.5 - mu) / sd);
    return { win: 1 - Phi((line + 0.5 - mu) / sd), push: push };
  }
  function lgamma(x) { var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5], y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); var s = 1.000000000190015; for (var j = 0; j < 6; j++) s += c[j] / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
  function nbPmf(k, mu, r) { var p = r / (r + mu); return Math.exp(lgamma(k + r) - lgamma(k + 1) - lgamma(r) + r * Math.log(p) + k * Math.log(1 - p)); }
  function nbOver(line, mu, r) { var s = 0; for (var k = 0; k <= Math.floor(line); k++) s += nbPmf(k, mu, r); return 1 - s; }

  // ---------- calibration (same rules as football) ----------
  var CAL = {};
  function setCalibration(stats) { CAL = stats || {}; }
  function calib(group, p) {
    var s = CAL[group]; if (!s || s.n < 8 || p == null) return p;
    var spread = Math.abs(s.meanP - 0.5); if (spread < 0.03) return p;
    var kRaw = clamp((s.hit - 0.5) / (s.meanP - 0.5), 0.4, 1.25), k = 1 + (s.n / (s.n + 25)) * (kRaw - 1);
    return clamp(0.5 + k * (p - 0.5), 0.01, 0.99);
  }
  function trackStats(legs) {
    var g = {};
    (legs || []).forEach(function (l) {
      if (l.won == null || l.p == null || l.void) return;
      var s = g[l.group] || (g[l.group] = { n: 0, wins: 0, sumP: 0, staked: 0, ret: 0 });
      s.n++; s.wins += l.won ? 1 : 0; s.sumP += l.p;
      if (l.odds) { s.staked++; s.ret += l.won ? l.odds : 0; }
    });
    Object.keys(g).forEach(function (k) { var s = g[k]; s.hit = s.wins / s.n; s.meanP = s.sumP / s.n; s.roi = s.staked ? s.ret / s.staked - 1 : null; });
    return g;
  }
  function modelOnly(p) { return 0.5 + 0.85 * (p - 0.5); }
  // Spreads and totals are priced near 50/50, so the football rule (Lean needs 55%) would mark
  // every one Skip. Here a Lean needs a non-negative edge and at least a coin flip.
  function grade(x) {
    if (x.odds) {
      if (x.ev >= 0.02 && x.p >= 0.45) return "Bet";
      if (x.ev >= 0 && x.p >= 0.5) return "Lean";
      return "Skip";
    }
    // 18 Nov: Clippers to win showed Lean at 65% with no moneyline price and lost by 25. A row
    // with no price only repeats the spread, so it needs a big favourite to be more than Skip.
    return x.p >= 0.72 ? "Lean" : "Skip";
  }
  // Which markets carry a price the bookmaker never showed (we filled in the standard 1.91).
  // 18 Nov: both losing best bets (Lakers -8.5, Clippers) came from the two games priced this way;
  // the real Lakers line had moved to 2.09. Assumed prices can't make a Bet or the best bet.
  function assumedMarkets(o) {
    var a = {}, b = String((o && o.book) || "");
    if (o && o.assumed) { o.assumed.forEach(function (k) { a[String(k).toLowerCase()] = true; }); return a; }
    if (/assum/i.test(b)) { // older files: only the book note says so
      var sp = /spread/i.test(b), to = /total/i.test(b);
      if (sp || !to) a.spread = true;
      if (to || !sp) a.total = true;
    }
    return a;
  }
  function confidence(ev, p) { return ev >= 0.04 && p >= 0.5 ? "Strong" : ev >= 0.015 ? "Lean" : ev >= -0.02 ? "Fair price" : "Thin"; }
  function sgn(x) { return (x > 0 ? "+" : "") + x; }

  // ---------- core model ----------
  function means(g) {
    var L = league(g), o = g.odds || {}, mus = [], muT = null, parts = [];
    if (o.spread && o.spread.h && o.spread.a) {
      var pS = devig([o.spread.h, o.spread.a])[0];
      mus.push(-o.spread.line + L.sigM * PhiInv(pS)); parts.push("spread");
    }
    if (o.ml && o.ml[0] && o.ml[1]) { mus.push(L.sigM * PhiInv(devig(o.ml)[0])); parts.push("moneyline"); }
    if (o.total && o.total.o && o.total.u) { muT = o.total.line + L.sigT * PhiInv(devig([o.total.o, o.total.u])[0]); parts.push("total"); }
    var mktM = mus.length ? mus.reduce(function (a, b) { return a + b; }, 0) / mus.length : null;
    var f = g.form || {}, fh = f.home, fa = f.away, formM = null, formT = null;
    if (fh && fa && fh.pf && fa.pf) {
      formM = ((fh.pf - fh.pa) - (fa.pf - fa.pa)) / 2 + L.hca * (g.neutral ? 0 : 1);
      formT = (fh.pf + fa.pa + fa.pf + fh.pa) / 2;
    }
    var muM = mktM != null ? (formM != null ? 0.75 * mktM + 0.25 * formM : mktM) : (formM != null ? formM : L.hca);
    if (muT == null) muT = formT != null ? formT : L.avgTotal; else if (formT != null) muT = 0.8 * muT + 0.2 * formT;
    var adj = g.adjust || {}, ah = +adj.home || 0, aa = +adj.away || 0; // points, negative for missing players
    muM += ah - aa; muT += ah + aa;
    return { L: L, muM: muM, muT: muT, market: { margin: mktM, total: o.total ? o.total.line : null }, form: { margin: formM, total: formT }, basis: parts };
  }

  function normName(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim(); }
  var STAT = { points: "pts", pts: "pts", rebounds: "reb", reb: "reb", assists: "ast", ast: "ast", threes: "threes", "3pt": "threes", "three pointers": "threes", "3-pointers": "threes", pra: "pra", "points + rebounds + assists": "pra", steals: "stl", blocks: "blk" };
  var STAT_LABEL = { pts: "points", reb: "rebounds", ast: "assists", threes: "threes", pra: "PRA", stl: "steals", blk: "blocks" };
  function parseProp(market) {
    var m = /(over|under)\s*([\d.]+)\s*(points \+ rebounds \+ assists|pra|points|pts|rebounds|reb|assists|ast|three pointers|3-pointers|threes|3pt|steals|blocks)/i.exec(market || "");
    if (!m) return null;
    return { side: m[1].toLowerCase(), line: +m[2], stat: STAT[m[3].toLowerCase()] };
  }
  function playerMean(pl, stat) {
    if (stat === "pra") return (pl.pts || 0) + (pl.reb || 0) + (pl.ast || 0);
    return pl[stat] || 0;
  }
  function overProb(stat, mu, line) {
    if (stat === "pts") return overLine(mu, Math.max(3.5, 0.3 * mu + 3), line).win;
    if (stat === "pra") return overLine(mu, Math.max(4.5, 0.24 * mu + 4.2), line).win;
    var r = stat === "reb" ? 9 : stat === "ast" ? 7 : stat === "threes" ? 10 : 6;
    return nbOver(line, Math.max(mu, 0.05), r);
  }
  function teamFactor(g, side, mean) {
    var f = g.form && g.form[side];
    return f && f.pf ? clamp(mean / f.pf, 0.85, 1.15) : 1;
  }
  function availability(pl) {
    var s = String(pl.status || "").toLowerCase();
    if (/^out|inactive|suspended/.test(s)) return 0;
    if (pl.start != null) return pl.start;
    return /doubtful/.test(s) ? 0.2 : /questionable|gtd|game-time/.test(s) ? 0.55 : /probable/.test(s) ? 0.92 : 1;
  }
  function players(g, teamMean) {
    var out = [];
    ["home", "away"].forEach(function (side) {
      var tf = teamFactor(g, side, teamMean[side]);
      ((g.players && g.players[side]) || []).forEach(function (pl) {
        var av = availability(pl);
        out.push({ name: pl.name, side: side, pos: pl.pos, status: pl.status || "", min: pl.min, av: av,
          pts: av === 0 || pl.pts == null ? null : pl.pts * tf, reb: av === 0 || pl.reb == null ? null : pl.reb, ast: av === 0 || pl.ast == null ? null : pl.ast * tf, threes: av === 0 || pl.threes == null ? null : pl.threes * tf, note: pl.note });
      });
    });
    return out.sort(function (a, b) { return (b.pts || 0) - (a.pts || 0); });
  }
  function propModel(g, pr, teamMean) {
    var pp = parseProp(pr.market); if (!pp) return null;
    var who = null, side = null;
    ["home", "away"].forEach(function (sd) { ((g.players && g.players[sd]) || []).forEach(function (pl) { if (!who && normName(pl.name) === normName(pr.player)) { who = pl; side = sd; } }); });
    if (!who) return { player: pr.player, market: pr.market, odds: pr.odds || null, p: null, grade: "Skip", basis: "player not in the data" };
    var av = availability(who), tf = teamFactor(g, side, teamMean[side]);
    var base = playerMean(who, pp.stat) * (pp.stat === "reb" ? 1 : tf);
    var pOver = av * overProb(pp.stat, base, pp.line) + (1 - av) * 0; // a player who sits loses the over (void rules vary)
    var p = pp.side === "over" ? pOver : (av * (1 - overProb(pp.stat, base, pp.line)));
    var hit = /^(\d+)\/(\d+)$/.exec(pr.hit || "");
    if (hit) p = (p * 10 + +hit[1]) / (10 + +hit[2]);
    var sub = "Player prop: " + STAT_LABEL[pp.stat];
    p = CAL[sub] && CAL[sub].n >= 8 ? calib(sub, p) : calib("Player prop", p);
    if (pr.odds) p = anchor(p, pr.odds, null, 0, ANCHOR.props);
    var ev = pr.odds ? p * pr.odds - 1 : null;
    return { player: pr.player, market: pr.market, odds: pr.odds || null, hitRate: pr.hit || null, p: p, fair: fair(p), ev: ev, mean: base,
      need: pr.odds ? 1 / pr.odds : null, basis: "season average × projected game pace" + (av < 1 ? " × " + Math.round(av * 100) + "% chance he plays" : ""),
      grade: ev == null ? (p >= 0.75 ? "Lean" : "Skip") : ev >= 0.03 ? "Bet" : ev >= 0 ? "Lean" : "Skip" };
  }

  // Anchor to the price (19 Nov). Re-scoring every graded leg so far (127 priced legs, three sports):
  // the bookmaker's own price, margin removed, predicted results better than the model (Brier 0.245 vs
  // 0.267), and legs where the model claimed a 3%+ edge won 46% against 66% predicted (ROI -15%).
  // So each probability keeps only a share of its disagreement with the price: 30% normally, 60% when
  // there is team news the price may not have caught yet (an `adjust`). The rest is the price's view.
  var ANCHOR = { k: 0.3, kNews: 0.6, sharp: 0.025, soft: 0.05, props: 0.08 }, CUR = { k: 0.3, m: 0.05 };
  function setCur(odds, adjusted) { CUR = { k: adjusted ? ANCHOR.kNews : ANCHOR.k, m: /pinnacle/i.test(String((odds && odds.book) || "")) ? ANCHOR.sharp : ANCHOR.soft }; }
  // q: the price's own fair probability (two-way devig when the other side is known, else margin estimate)
  function anchor(p, odds, q, push, margin) {
    if (!odds || p == null) return p;
    push = push || 0;
    if (q == null) q = Math.min(0.99, (1 - push) / odds / (1 + (margin == null ? CUR.m : margin)));
    return q + CUR.k * (p - q);
  }
  function takeAt(p, push) { return p > 0 ? Math.round((1.01 - (push || 0)) / p * 100) / 100 : null; }
  function analyse(g) {
    var m = means(g), L = m.L, o = g.odds || {};
    setCur(o, (+(g.adjust || {}).home || 0) !== 0 || (+(g.adjust || {}).away || 0) !== 0);
    var H = g.home.short || g.home.name, A = g.away.short || g.away.name;
    var muH = (m.muT + m.muM) / 2, muA = (m.muT - m.muM) / 2, sigTeam = L.sigT * 0.62;
    var pHome = Phi(m.muM / L.sigM);
    var mk = { home: pHome, away: 1 - pHome, margin: m.muM, total: m.muT, score: [muH, muA] };
    function spreadP(side, line) { // line from that side's view, e.g. -5.5
      var mu = side === "home" ? m.muM : -m.muM, r = overLine(mu, L.sigM, -line);
      return r;
    }
    function totalP(side, line) { var r = overLine(m.muT, L.sigT, line); return side === "over" ? r : { win: 1 - r.win - r.push, push: r.push }; }
    function teamTotP(team, side, line) { var r = overLine(team === "home" ? muH : muA, sigTeam, line); return side === "over" ? r : { win: 1 - r.win - r.push, push: r.push }; }
    // First-half share of the points: taken from the bookmaker's own first-half and full-game lines when
    // both exist, otherwise the league norm. 18 Nov: a fixed 49.5% invented "1H under" edges in European
    // games, where Pinnacle prices the first half at ~50% (Bosna 80.5 of 160.5).
    var shT = L.h1Share || 0.495, shM = 0.5;
    if (o.h1 && o.h1.total && o.total && o.total.line) shT = o.h1.total.line / o.total.line;
    if (o.h1 && o.h1.spread && o.spread && Math.abs(o.spread.line) >= 3) shM = Math.min(0.65, Math.max(0.35, o.h1.spread.line / o.spread.line));
    var h1 = { muM: m.muM * shM, muT: m.muT * shT, sigM: L.sigM * 0.72, sigT: L.sigT * 0.7 };

    var c = [], ASM = assumedMarkets(o);
    function add(group, label, odds, p, push) {
      if (!odds || p == null) return;
      push = push || 0; p = anchor(calib(group, p), odds, null, push);
      var ev = p * odds + push - 1, eff = p / Math.max(1 - push, 1e-6), asm = !!ASM[group.toLowerCase()];
      c.push({ group: group, label: label, odds: odds, p: p, push: push, fair: (1 - push) / p, ev: ev, takeAt: takeAt(p, push), assumed: asm || undefined,
        confidence: asm ? "Price unconfirmed" : confidence(ev, eff) });
    }
    if (o.ml) { add("Moneyline", H + " to win", o.ml[0], mk.home); add("Moneyline", A + " to win", o.ml[1], mk.away); }
    if (o.spread) {
      var sh = spreadP("home", o.spread.line), sa = spreadP("away", -o.spread.line);
      add("Spread", H + " " + sgn(o.spread.line), o.spread.h, sh.win, sh.push);
      add("Spread", A + " " + sgn(-o.spread.line), o.spread.a, sa.win, sa.push);
    }
    if (o.total) {
      var to = totalP("over", o.total.line), tu = totalP("under", o.total.line);
      add("Total", "Over " + o.total.line + " points", o.total.o, to.win, to.push);
      add("Total", "Under " + o.total.line + " points", o.total.u, tu.win, tu.push);
    }
    if (o.teamTotal) ["home", "away"].forEach(function (s) {
      var t = o.teamTotal[s]; if (!t) return; var nm = s === "home" ? H : A;
      var a1 = teamTotP(s, "over", t.line), a2 = teamTotP(s, "under", t.line);
      add("Team total", nm + " over " + t.line, t.o, a1.win, a1.push); add("Team total", nm + " under " + t.line, t.u, a2.win, a2.push);
    });
    if (o.h1) {
      if (o.h1.spread) { var hh = overLine(h1.muM, h1.sigM, -o.h1.spread.line), ha = overLine(-h1.muM, h1.sigM, o.h1.spread.line);
        add("1st half", "1H " + H + " " + sgn(o.h1.spread.line), o.h1.spread.h, hh.win, hh.push); add("1st half", "1H " + A + " " + sgn(-o.h1.spread.line), o.h1.spread.a, ha.win, ha.push); }
      if (o.h1.total) { var ho = overLine(h1.muT, h1.sigT, o.h1.total.line);
        add("1st half", "1H over " + o.h1.total.line, o.h1.total.o, ho.win, ho.push); add("1st half", "1H under " + o.h1.total.line, o.h1.total.u, 1 - ho.win - ho.push, ho.push); }
    }
    var props = (g.props || []).map(function (pr) { return propModel(g, pr, { home: muH, away: muA }); }).filter(Boolean);

    // ---- picks ----
    function best(list, key) { var b = null; list.forEach(function (x) { if (!b || key(x) > key(b)) b = x; }); return b; }
    var top = best(c.filter(function (x) { return !x.assumed && x.odds >= 1.45 && x.odds <= 3.2 && x.p >= 0.5 && x.ev >= 0.01; }), function (x) { return x.ev + 0.1 * x.p; });
    var likely = best(c.filter(function (x) { return x.group === "Moneyline" && !x.assumed && x.odds >= 1.1 && x.p >= 0.6; }), function (x) { return x.p; });
    var value = best(c.filter(function (x) { return !x.assumed && x.ev > 0 && x.odds <= 6; }), function (x) { return x.ev; });
    var noBet = top ? null : (c.some(function (x) { return x.assumed; })
      ? "No bet: the spread and total prices here were not published, so the 1.91 used is a guess. Check your bookmaker's line before backing anything."
      : "No bet: no price beats the fair odds by 1% once the model is anchored to the bookmaker.");
    var slip = [];
    function bestOf(group) { return best(c.filter(function (x) { return x.group === group; }), function (x) { return x.ev + 0.02 * x.p; }); }
    var fav = mk.home >= 0.5 ? "home" : "away", favName = fav === "home" ? H : A, pFav = Math.max(mk.home, mk.away);
    function row(market, x, fallback) {
      if (x) slip.push({ market: market, pick: x.label + (x.assumed ? " (price assumed)" : ""), p: x.p, odds: x.odds, fair: x.fair, ev: x.ev, push: x.push, takeAt: x.takeAt, assumed: x.assumed });
      else if (fallback) { var fp = calib(market, modelOnly(fallback.p)); slip.push({ market: market, pick: fallback.label, p: fp, odds: null, fair: fair(fp), ev: null }); }
    }
    row("Moneyline", bestOf("Moneyline"), { label: favName + " to win", p: pFav });
    var fairLine = Math.round(m.muM * 2) / 2; // home margin
    row("Spread", bestOf("Spread"), { label: (fav === "home" ? H : A) + " " + sgn(-Math.max(1.5, Math.abs(fairLine) - 3.5)), p: spreadP(fav, -Math.max(1.5, Math.abs(fairLine) - 3.5)).win });
    var tl = Math.round(m.muT) - 6.5;
    row("Total", bestOf("Total"), { label: "Over " + tl + " points", p: totalP("over", tl).win });
    row("Team total", bestOf("Team total"), null);
    row("1st half", bestOf("1st half"), null);
    var bp = best(props.filter(function (x) { return x.odds && x.p != null; }), function (x) { return x.ev; });
    if (bp) slip.push({ market: "Player prop", pick: bp.player + " " + bp.market, p: bp.p, odds: bp.odds, fair: bp.fair, ev: bp.ev });
    slip.forEach(function (r) { r.grade = grade(r); if (r.assumed && r.grade === "Bet") r.grade = "Lean"; });

    // builder: favourite (moneyline or a small handicap) + a total side, treated as independent
    var builds = [];
    var resLegs = [];
    if (pFav >= 0.58) resLegs.push({ label: favName + " to win", p: pFav });
    if (pFav >= 0.5) resLegs.push({ label: favName + " " + sgn(-Math.max(1.5, Math.round(Math.abs(m.muM) / 2) + 0.5)), p: spreadP(fav, -Math.max(1.5, Math.round(Math.abs(m.muM) / 2) + 0.5)).win });
    var lines = o.total ? [o.total.line - 8, o.total.line + 8] : [Math.round(m.muT) - 8.5, Math.round(m.muT) + 8.5];
    resLegs.forEach(function (r) {
      [{ label: "Over " + lines[0] + " points", p: totalP("over", lines[0]).win }, { label: "Under " + lines[1] + " points", p: totalP("under", lines[1]).win }].forEach(function (t) {
        var p = r.p * t.p; if (p >= 0.3 && 1 / p >= 1.6 && 1 / p <= 4.5) builds.push({ legs: [r.label, t.label], p: p, fair: 1 / p });
      });
    });
    var builder = best(builds, function (x) { return x.p; });
    if (builder) builder.p = calib("Bet builder", builder.p), builder.fair = 1 / builder.p;

    return { sport: "basketball", league: L, xs: { home: muH, away: muA }, margin: m.muM, total: m.muT, basis: m.basis, market: m.market, form: m.form,
      markets: mk, h1: h1, props: props, players: players(g, { home: muH, away: muA }),
      picks: { top: top, noBet: noBet, value: value, likely: likely, builder: builder, slip: slip, all: c } };
  }

  // ---------- live ----------
  // state: { period (1-4, 5+ = overtime), clock (minutes left in the period, e.g. 7.5 or "7:30"),
  //          home, away (points), liveSpread (home line, e.g. -3.5), liveTotal (e.g. 221.5), finished }
  function minutesLeft(L, st) {
    if (st.finished) return 0;
    var per = L.minutes / 4, p = +st.period || 1, clk = st.clock;
    if (typeof clk === "string" && clk.indexOf(":") > 0) { var a = clk.split(":"); clk = +a[0] + (+a[1] || 0) / 60; }
    clk = clk == null || clk === "" ? per : clamp(+clk, 0, p > 4 ? 5 : per);
    return p > 4 ? clk : (4 - p) * per + clk;
  }
  function live(g, st) {
    var pre = analyse(g), L = pre.league, H = g.home.short || g.home.name, A = g.away.short || g.away.name;
    st = st || {};
    var hs = +st.home || 0, as = +st.away || 0, diff = hs - as;
    var left = minutesLeft(L, st), ot = (+st.period || 1) > 4, frac = ot ? left / L.minutes : left / L.minutes, elapsed = ot ? 1 : 1 - frac;
    var muMr = pre.margin * frac, muTr = pre.total * frac;
    if (elapsed > 0.1 && !ot) { // how the game is actually going
      var paceObs = (hs + as) / elapsed, w = 0.4 * elapsed;
      muTr = frac * ((1 - w) * pre.total + w * paceObs);
      muMr = frac * ((1 - 0.25 * elapsed) * pre.margin + 0.25 * elapsed * (diff / elapsed));
    }
    if (left <= 2.5 && left > 0 && Math.abs(diff) <= 8) muTr += 2.5 * (left / 2.5) + 2; // intentional fouling
    var sdM = L.sigM * Math.sqrt(Math.max(frac, 0.0005)), sdT = L.sigT * Math.sqrt(Math.max(frac, 0.0005));
    var muFinalM = diff + muMr, muFinalT = hs + as + muTr;
    var pHome = left <= 0 ? (diff > 0 ? 1 : diff < 0 ? 0 : 0.5) : Phi(muFinalM / sdM);
    var mk = { home: pHome, away: 1 - pHome, projScore: [(muFinalT + muFinalM) / 2, (muFinalT - muFinalM) / 2], projTotal: muFinalT, projMargin: muFinalM, over: {} };
    var base = Math.round(muFinalT);
    [-9, -5, -2, 2, 5, 9].forEach(function (d) { var Lx = base + d + 0.5; if (Lx > hs + as) mk.over[Lx] = left <= 0 ? (hs + as > Lx ? 1 : 0) : 1 - Phi((Lx - muFinalT) / sdT); });
    var opts = [];
    function add(group, label, p) { if (p >= 0.6 && p <= 0.9) opts.push({ group: group, label: label, p: p, fair: 1 / p, takeAt: round(1.05 / p, 2) }); }
    add("Moneyline", H + " to win", mk.home); add("Moneyline", A + " to win", mk.away);
    Object.keys(mk.over).forEach(function (Lx) { add("Total", "Over " + Lx + " points", mk.over[Lx]); add("Total", "Under " + Lx + " points", 1 - mk.over[Lx]); });
    var fl = Math.round(muFinalM);
    [fl - 6.5, fl - 3.5, fl + 3.5, fl + 6.5].forEach(function (l) { // home covers -l when margin > l
      var p = 1 - Phi((l - muFinalM) / sdM);
      if (l > 0) add("Spread", H + " " + sgn(-l), p); else add("Spread", A + " " + sgn(l), 1 - p);
    });
    var checks = [];
    if (st.liveTotal != null && st.liveTotal !== "") { var lt = +st.liveTotal, po = 1 - Phi((lt - muFinalT) / sdT); checks.push({ label: "Over " + lt, p: po, fair: 1 / po }, { label: "Under " + lt, p: 1 - po, fair: 1 / (1 - po) }); }
    if (st.liveSpread != null && st.liveSpread !== "") { var ls = +st.liveSpread, pc = 1 - Phi((-ls - muFinalM) / sdM); checks.push({ label: H + " " + sgn(ls), p: pc, fair: 1 / pc }, { label: A + " " + sgn(-ls), p: 1 - pc, fair: 1 / (1 - pc) }); }
    var groups = {}; opts.forEach(function (x) { var b = groups[x.group]; if (!b || Math.abs(x.p - 0.72) < Math.abs(b.p - 0.72)) groups[x.group] = x; });
    return { pre: pre, minutesLeft: left, score: [hs, as], markets: mk, checks: checks, sd: { margin: sdM, total: sdT },
      picks: Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.p - a.p; }) };
  }

  return { _Phi: Phi, analyse: analyse, live: live, devig: devig, fair: fair, round: round, setCalibration: setCalibration, trackStats: trackStats, parseProp: parseProp, calibInfo: function (g) { var s = CAL[g]; return s || { n: 0 }; } };
});
