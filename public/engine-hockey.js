/* Matchday Edge: ice hockey engine.
 * Goals in regulation are Poisson for each team. The two scoring rates are fitted to the
 * bookmaker's moneyline (incl. overtime) and total with the margin taken out (75%), blended with
 * recent goals for and against (25%), then adjusted for goalie or injury news. Overtime/shootout:
 * a regulation tie goes to OT, won slightly more often by the stronger side, and adds one goal to
 * the total (NHL settles totals and puck lines including OT and shootout). Same Bet / Lean / Skip
 * rules as football.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HockeyEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var AVG = 3.05, MAXG = 12;
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round(x, d) { var k = Math.pow(10, d || 0); return Math.round(x * k) / k; }
  function fair(p) { return p > 0 ? 1 / p : null; }
  function devig(odds) { var inv = odds.map(function (o) { return o ? 1 / o : 0; }), s = inv.reduce(function (a, b) { return a + b; }, 0); return inv.map(function (x) { return x / s; }); }
  function pois(k, l) { var p = Math.exp(-l); for (var i = 1; i <= k; i++) p *= l / i; return p; }
  function lgamma(x) { var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5], y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); var s = 1.000000000190015; for (var j = 0; j < 6; j++) s += c[j] / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
  function nbPmf(k, mu, r) { var p = r / (r + mu); return Math.exp(lgamma(k + r) - lgamma(k + 1) - lgamma(r) + r * Math.log(p) + k * Math.log(1 - p)); }
  function nbOver(line, mu, r) { var s = 0; for (var k = 0; k <= Math.floor(line); k++) s += nbPmf(k, mu, r); return 1 - s; }
  function erf(x) { var t = 1 / (1 + 0.3275911 * Math.abs(x)); var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  function Phi(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function poisM(lh, la) { var M = []; for (var i = 0; i <= MAXG; i++) { M[i] = []; for (var j = 0; j <= MAXG; j++) M[i][j] = pois(i, lh) * pois(j, la); } return M; }
  // Pulled goalie. A plain Poisson grid has far too many one-goal regulation results: in the NHL the
  // side trailing by one pulls its goalie in ~98% of games, the leader then scores into the empty
  // net roughly 30% of the time and the trailer ties it about 18% (both well above the normal rate
  // for those minutes, which the grid already has). 18 Nov: four of five best bets were underdog
  // +1.5 puck lines, and Capitals +1.5 lost 5-2 on exactly this. The extra goals are moved here,
  // so the fit to the bookmaker's lines and every puck line, total and team total see them.
  var ENG = { lead1: 0.22, tie1: 0.10, lead2: 0.15, cut2: 0.07 };
  function lateGame(M) {
    var N = M.map(function (r) { return r.slice(); });
    for (var i = 0; i <= MAXG; i++) for (var j = 0; j <= MAXG; j++) {
      var d = i - j, p = M[i][j], ad = Math.abs(d); if (p < 1e-12 || (ad !== 1 && ad !== 2)) continue;
      var e = ad === 1 ? ENG.lead1 : ENG.lead2, t = ad === 1 ? ENG.tie1 : ENG.cut2;
      if (d > 0) { if (i < MAXG) { N[i + 1][j] += p * e; N[i][j] -= p * e; } if (j < MAXG) { N[i][j + 1] += p * t; N[i][j] -= p * t; } }
      else { if (j < MAXG) { N[i][j + 1] += p * e; N[i][j] -= p * e; } if (i < MAXG) { N[i + 1][j] += p * t; N[i][j] -= p * t; } }
    }
    return N;
  }
  function matrix(lh, la) { return lateGame(poisM(lh, la)); }
  function sumIf(M, f) { var s = 0; for (var i = 0; i <= MAXG; i++) for (var j = 0; j <= MAXG; j++) if (f(i, j)) s += M[i][j]; return s; }
  function otShare(lh, la) { return clamp(0.5 + 0.6 * (lh - la) / (lh + la), 0.4, 0.6); }
  // full-game (incl. OT/SO) outcome distribution: returns function(fn(h,a,ot)) summing probabilities
  function fullGame(lh, la) {
    var M = matrix(lh, la), q = otShare(lh, la);
    return {
      M: M, q: q,
      P: function (f) {
        var s = 0;
        for (var i = 0; i <= MAXG; i++) for (var j = 0; j <= MAXG; j++) {
          var p = M[i][j]; if (p < 1e-12) continue;
          if (i !== j) { if (f(i, j, false)) s += p; }
          else { if (f(i + 1, j, true)) s += p * q; if (f(i, j + 1, true)) s += p * (1 - q); }
        }
        return s;
      }
    };
  }
  function markets(lh, la) {
    var G = fullGame(lh, la), M = G.M, mk = {};
    mk.regHome = sumIf(M, function (i, j) { return i > j; }); mk.regDraw = sumIf(M, function (i, j) { return i === j; }); mk.regAway = 1 - mk.regHome - mk.regDraw;
    mk.home = mk.regHome + mk.regDraw * G.q; mk.away = 1 - mk.home;
    mk.puckHome = G.P(function (h, a) { return h - a >= 2; }); mk.puckAway = G.P(function (h, a) { return a - h >= 2; });
    mk.over = {}; [4.5, 5.5, 6.5, 7.5].forEach(function (L) { mk.over[L] = G.P(function (h, a) { return h + a > L; }); });
    mk.btts = sumIf(M, function (i, j) { return i > 0 && j > 0; });
    mk.ot = mk.regDraw;
    var cs = []; for (var i = 0; i <= 7; i++) for (var j = 0; j <= 7; j++) cs.push({ score: i + "-" + j, p: M[i][j] }); cs.sort(function (a, b) { return b.p - a.p; }); mk.correctScores = cs.slice(0, 6);
    mk.teamOver = function (side, L) { return G.P(function (h, a) { return (side === "home" ? h : a) > L; }); };
    mk.G = G; return mk;
  }

  // ---------- calibration ----------
  var CAL = {};
  function setCalibration(stats) { CAL = stats || {}; }
  function calib(group, p) {
    var s = CAL[group]; if (!s || s.n < 8 || p == null) return p;
    if (Math.abs(s.meanP - 0.5) < 0.03) return p;
    var kRaw = clamp((s.hit - 0.5) / (s.meanP - 0.5), 0.4, 1.25), k = 1 + (s.n / (s.n + 25)) * (kRaw - 1);
    return clamp(0.5 + k * (p - 0.5), 0.01, 0.99);
  }
  function trackStats(legs) {
    var g = {};
    (legs || []).forEach(function (l) {
      if (l.won == null || l.p == null || l.void) return;
      var s = g[l.group] || (g[l.group] = { n: 0, wins: 0, sumP: 0, staked: 0, ret: 0 });
      s.n++; s.wins += l.won ? 1 : 0; s.sumP += l.p; if (l.odds) { s.staked++; s.ret += l.won ? l.odds : 0; }
    });
    Object.keys(g).forEach(function (k) { var s = g[k]; s.hit = s.wins / s.n; s.meanP = s.sumP / s.n; s.roi = s.staked ? s.ret / s.staked - 1 : null; });
    return g;
  }
  function modelOnly(p) { return 0.5 + 0.8 * (p - 0.5); }
  function grade(x) {
    if (x.odds) { if (x.ev >= 0.015 && x.p >= 0.45) return "Bet"; if (x.ev >= -0.02 && x.p >= 0.55) return "Lean"; return "Skip"; }
    return x.p >= 0.64 ? "Lean" : "Skip";
  }
  function confidence(ev, p) { return ev >= 0.04 && p >= 0.5 ? "Strong" : ev >= 0.015 ? "Lean" : ev >= -0.02 ? "Fair price" : "Thin"; }

  // ---------- fit ----------
  function fit(g) {
    var o = g.odds || {}, f = g.form || {}, fh = f.home, fa = f.away;
    var formH = fh && fa && fh.gf != null ? (fh.gf + fa.ga) / 2 * (g.neutral ? 1 : 1.03) : AVG * 1.03;
    var formA = fh && fa && fa.gf != null ? (fa.gf + fh.ga) / 2 * (g.neutral ? 1 : 0.97) : AVG * 0.97;
    // shrink small samples toward the league average
    var n = Math.min((fh && fh.games) || 10, (fa && fa.games) || 10), k = n / (n + 6);
    formH = k * formH + (1 - k) * AVG * 1.03; formA = k * formA + (1 - k) * AVG * 0.97;
    var targets = [];
    if (o.ml && o.ml[0] && o.ml[1]) targets.push({ w: 2, p: devig(o.ml)[0], f: function (mk) { return mk.home; } });
    if (o.reg && o.reg[0]) { var r = devig(o.reg); targets.push({ w: 1.5, p: r[0], f: function (mk) { return mk.regHome; } }, { w: 1.5, p: r[1], f: function (mk) { return mk.regDraw; } }); }
    if (o.total && o.total.o && o.total.u) { var L = o.total.line, pt = devig([o.total.o, o.total.u])[0];
      targets.push({ w: 2, p: pt, f: function (mk) { var ov = mk.G.P(function (h, a) { return h + a > L; }), pu = mk.G.P(function (h, a) { return h + a === L; }); return ov / Math.max(1 - pu, 1e-6); } }); }
    if (o.puck && o.puck.h && o.puck.a) { var pp = devig([o.puck.h, o.puck.a])[0], ln = o.puck.line;
      targets.push({ w: 1, p: pp, f: function (mk) { return mk.G.P(function (h, a) { return h - a + ln > 0; }); } }); }
    var lh = formH, la = formA, mkt = null;
    if (targets.length) {
      var best = null;
      function tryAt(a, b) {
        if (a <= 0.8 || b <= 0.8 || Math.abs(a - b) > 2.6) return;
        var mk = markets(a, b), e = 0;
        targets.forEach(function (t) { var d = t.f(mk) - t.p; e += t.w * d * d; });
        if (!best || e < best.e) best = { e: e, a: a, b: b };
      }
      for (var a = 1.6; a <= 4.8; a += 0.1) for (var b = 1.4; b <= 4.6; b += 0.1) tryAt(a, b); // coarse
      var ca = best.a, cb = best.b;
      for (var a2 = ca - 0.1; a2 <= ca + 0.1001; a2 += 0.02) for (var b2 = cb - 0.1; b2 <= cb + 0.1001; b2 += 0.02) tryAt(a2, b2); // fine
      mkt = { home: best.a, away: best.b };
      lh = 0.75 * best.a + 0.25 * formH; la = 0.75 * best.b + 0.25 * formA;
    }
    var adj = g.adjust || {};
    lh *= adj.home || 1; la *= adj.away || 1;
    return { lh: lh, la: la, market: mkt, form: { home: formH, away: formA } };
  }

  // ---------- players ----------
  function normName(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, "").trim(); }
  function parseProp(market) {
    var s = String(market || "").toLowerCase(), m;
    if (/anytime|to score/.test(s)) return { stat: "goals", side: "over", line: 0.5 };
    if ((m = /(over|under)\s*([\d.]+)\s*(shots on goal|shots|sog|points|pts|assists|goals|saves|blocked shots|blocks)/.exec(s)))
      return { side: m[1], line: +m[2], stat: /shot|sog/.test(m[3]) && !/block/.test(m[3]) ? "sog" : /point|pts/.test(m[3]) ? "points" : /assist/.test(m[3]) ? "assists" : /goal/.test(m[3]) ? "goals" : /save/.test(m[3]) ? "saves" : "blocks" };
    return null;
  }
  var LABEL = { sog: "shots on goal", points: "points", assists: "assists", goals: "goals", saves: "saves", blocks: "blocked shots" };
  function avail(pl) { var s = String(pl.status || "").toLowerCase(); if (/^out|ir|injured reserve|scratch|suspend/.test(s)) return 0; return pl.start != null ? pl.start : /doubt/.test(s) ? 0.2 : /day-to-day|dtd|questionable|gtd/.test(s) ? 0.6 : 1; }
  function teamF(g, side, lam) { var f = g.form && g.form[side]; return f && f.gf ? clamp(lam / f.gf, 0.8, 1.25) : 1; }
  function playerRates(g, pl, side, lam) {
    var tf = teamF(g, side, lam), av = avail(pl), gp = pl.gp || 1;
    var per = function (x) { return x == null ? 0 : (pl.perGame ? x : x / gp); };
    return { av: av, goals: per(pl.g) * tf, assists: per(pl.a) * tf, points: (per(pl.g) + per(pl.a)) * tf, sog: per(pl.sog) * Math.sqrt(tf), blocks: per(pl.blk) };
  }
  function players(g, lh, la) {
    var out = [];
    ["home", "away"].forEach(function (side) {
      ((g.players && g.players[side]) || []).forEach(function (pl) {
        if (pl.pos === "G") return;
        var r = playerRates(g, pl, side, side === "home" ? lh : la);
        out.push({ name: pl.name, side: side, pos: pl.pos, status: pl.status || "", av: r.av, scorer: r.av * (1 - Math.exp(-r.goals)), point: r.av * (1 - Math.exp(-r.points)), sog: r.av * r.sog, note: pl.note });
      });
    });
    return out.sort(function (a, b) { return b.scorer - a.scorer; });
  }
  function propModel(g, pr, lh, la) {
    var pp = parseProp(pr.market); if (!pp) return null;
    var who = null, side = null;
    ["home", "away"].forEach(function (sd) { ((g.players && g.players[sd]) || []).forEach(function (pl) { if (!who && normName(pl.name) === normName(pr.player)) { who = pl; side = sd; } }); });
    if (!who) return { player: pr.player, market: pr.market, odds: pr.odds || null, p: null, grade: "Skip", basis: "player not in the data" };
    var pOver, mean;
    if (pp.stat === "saves") {
      var oppSide = side === "home" ? "away" : "home", f = g.form && g.form[oppSide], oppShots = (f && f.sog) || 29.5;
      var oppL = side === "home" ? la : lh, scale = f && f.gf ? clamp(oppL / f.gf, 0.85, 1.2) : 1;
      mean = Math.max(oppShots * scale - oppL, 10); var av0 = avail(who);
      pOver = av0 * (1 - Phi((pp.line + 0.5 - mean) / 5.6));
    } else {
      var r = playerRates(g, who, side, side === "home" ? lh : la); mean = r[pp.stat];
      var raw = pp.stat === "sog" || pp.stat === "blocks" ? nbOver(pp.line, Math.max(mean, 0.05), 6) : 1 - (function () { var s = 0; for (var k = 0; k <= Math.floor(pp.line); k++) s += pois(k, mean); return s; })();
      pOver = r.av * raw;
    }
    var p = pp.side === "over" ? pOver : (avail(who) - pOver);
    var hit = /^(\d+)\/(\d+)$/.exec(pr.hit || ""); if (hit) p = (p * 10 + +hit[1]) / (10 + +hit[2]);
    var sub = "Player prop: " + LABEL[pp.stat];
    p = CAL[sub] && CAL[sub].n >= 8 ? calib(sub, p) : calib("Player prop", p);
    if (pr.odds) p = anchor(p, pr.odds, null, 0, ANCHOR.props);
    var ev = pr.odds ? p * pr.odds - 1 : null;
    return { player: pr.player, market: pr.market, odds: pr.odds || null, hitRate: pr.hit || null, p: p, fair: fair(p), ev: ev, mean: mean, need: pr.odds ? 1 / pr.odds : null,
      basis: pp.stat === "saves" ? "opponent shots minus expected goals" : "per-game rate × projected team scoring",
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
    var F = fit(g), lh = F.lh, la = F.la, mk = markets(lh, la), o = g.odds || {};
    setCur(o, ((g.adjust || {}).home && g.adjust.home !== 1) || ((g.adjust || {}).away && g.adjust.away !== 1));
    var H = g.home.short || g.home.name, A = g.away.short || g.away.name;
    var c = [];
    function add(group, label, odds, p, push) { if (!odds || p == null) return; push = push || 0; p = anchor(calib(group, p), odds, null, push); var ev = p * odds + push - 1; c.push({ group: group, label: label, odds: odds, p: p, push: push, fair: (1 - push) / p, ev: ev, takeAt: takeAt(p, push), confidence: confidence(ev, p / Math.max(1 - push, 1e-6)) }); }
    if (o.ml) { add("Moneyline", H + " to win (incl. OT)", o.ml[0], mk.home); add("Moneyline", A + " to win (incl. OT)", o.ml[1], mk.away); }
    if (o.reg) { add("60-min result", H + " in regulation", o.reg[0], mk.regHome); add("60-min result", "Draw after 60 min", o.reg[1], mk.regDraw); add("60-min result", A + " in regulation", o.reg[2], mk.regAway); }
    if (o.puck) {
      var ln = o.puck.line;
      add("Puck line", H + " " + (ln > 0 ? "+" : "") + ln, o.puck.h, mk.G.P(function (h, a) { return h - a + ln > 0; }));
      add("Puck line", A + " " + (-ln > 0 ? "+" : "") + (-ln), o.puck.a, mk.G.P(function (h, a) { return a - h - ln > 0; }));
    }
    if (o.total) { var L = o.total.line, po = mk.G.P(function (h, a) { return h + a > L; }), pu = mk.G.P(function (h, a) { return h + a === L; }); add("Total", "Over " + L + " goals", o.total.o, po, pu); add("Total", "Under " + L + " goals", o.total.u, 1 - po - pu, pu); }
    if (o.btts) { add("BTTS", "Both teams to score", o.btts[0], mk.btts); add("BTTS", "Both teams to score: No", o.btts[1], 1 - mk.btts); }
    if (o.teamTotal) ["home", "away"].forEach(function (s) { var t = o.teamTotal[s]; if (!t) return; var p = mk.teamOver(s, t.line), nm = s === "home" ? H : A; add("Team total", nm + " over " + t.line, t.o, p); add("Team total", nm + " under " + t.line, t.u, 1 - p); });
    if (o.p1total) { var p1 = 1 - (function () { var s = 0, l = (lh + la) * 0.31; for (var k = 0; k <= Math.floor(o.p1total.line); k++) s += pois(k, l); return s; })(); add("1st period", "1st period over " + o.p1total.line, o.p1total.o, p1); add("1st period", "1st period under " + o.p1total.line, o.p1total.u, 1 - p1); }
    var props = (g.props || []).map(function (pr) { return propModel(g, pr, lh, la); }).filter(Boolean);

    function best(list, key) { var b = null; list.forEach(function (x) { if (!b || key(x) > key(b)) b = x; }); return b; }
    var top = best(c.filter(function (x) { return x.odds >= 1.45 && x.odds <= 3.2 && x.p >= 0.5 && x.ev >= 0.01; }), function (x) { return x.ev + 0.1 * x.p; });
    var likely = best(c.filter(function (x) { return (x.group === "Moneyline" || x.group === "60-min result") && x.odds >= 1.1 && x.p >= 0.6; }), function (x) { return x.p; });
    var value = best(c.filter(function (x) { return x.ev > 0 && x.odds <= 6; }), function (x) { return x.ev; });
    var slip = [], fav = mk.home >= mk.away ? "home" : "away", favName = fav === "home" ? H : A;
    function bestOf(gr) { return best(c.filter(function (x) { return x.group === gr; }), function (x) { return x.ev + 0.02 * x.p; }); }
    function row(market, x, fb) { if (x) slip.push({ market: market, pick: x.label, p: x.p, odds: x.odds, fair: x.fair, ev: x.ev, takeAt: x.takeAt }); else if (fb) { var fp = calib(market, modelOnly(fb.p)); slip.push({ market: market, pick: fb.label, p: fp, odds: null, fair: fair(fp), ev: null }); } }
    row("Moneyline", bestOf("Moneyline"), { label: favName + " to win (incl. OT)", p: Math.max(mk.home, mk.away) });
    row("60-min result", bestOf("60-min result"), null);
    row("Puck line", bestOf("Puck line"), { label: (fav === "home" ? A : H) + " +1.5", p: fav === "home" ? 1 - mk.puckHome : 1 - mk.puckAway });
    row("Total", bestOf("Total"), { label: mk.over[5.5] >= 0.5 ? "Over 5.5 goals" : "Under 6.5 goals", p: mk.over[5.5] >= 0.5 ? mk.over[5.5] : 1 - mk.over[6.5] });
    row("BTTS", bestOf("BTTS"), null);
    row("Team total", bestOf("Team total"), null); row("1st period", bestOf("1st period"), null);
    var bp = best(props.filter(function (x) { return x.odds && x.p != null; }), function (x) { return x.ev; });
    if (bp) slip.push({ market: "Player prop", pick: bp.player + " " + bp.market, p: bp.p, odds: bp.odds, fair: bp.fair, ev: bp.ev });
    slip.forEach(function (r) { r.grade = grade(r); });
    // builder from the full joint distribution
    var builds = [], G = mk.G, pf = Math.max(mk.home, mk.away);
    var res = []; if (pf >= 0.56) res.push({ label: favName + " to win (incl. OT)", f: fav === "home" ? function (h, a) { return h > a; } : function (h, a) { return a > h; } });
    res.push({ label: (fav === "home" ? A : H) + " +1.5", f: fav === "home" ? function (h, a) { return a - h + 1.5 > 0; } : function (h, a) { return h - a + 1.5 > 0; } });
    var tots = [{ label: "Over 4.5 goals", f: function (h, a) { return h + a > 4.5; } }, { label: "Under 6.5 goals", f: function (h, a) { return h + a < 6.5; } }, { label: "Over 5.5 goals", f: function (h, a) { return h + a > 5.5; } }];
    res.forEach(function (r) { tots.forEach(function (t) { var p = G.P(function (h, a) { return r.f(h, a) && t.f(h, a); }); if (p >= 0.3 && 1 / p >= 1.6 && 1 / p <= 4.5) builds.push({ legs: [r.label, t.label], p: p, fair: 1 / p }); }); });
    var builder = best(builds, function (x) { return x.p - Math.abs(1 / x.p - 2.2) * 0.05; });
    if (builder) { builder.p = calib("Bet builder", builder.p); builder.fair = 1 / builder.p; }
    return { sport: "hockey", xg: { home: lh, away: la }, market: F.market, form: F.form, markets: mk, props: props, players: players(g, lh, la),
      picks: { top: top, noBet: top ? null : "No bet: no price beats the fair odds by 1% once the model is anchored to the bookmaker.", value: value, likely: likely, builder: builder, slip: slip, all: c } };
  }

  // ---------- live ----------
  // state: { period (1-3, 4 = OT), minute (elapsed in the period, 0-20), home, away (goals),
  //          ppHome / ppAway (true while on the power play), sogHome, sogAway, finished }
  function live(g, st) {
    var pre = analyse(g), lh = pre.xg.home, la = pre.xg.away, H = g.home.short || g.home.name, A = g.away.short || g.away.name;
    st = st || {};
    var per = clamp(+st.period || 1, 1, 4), min = clamp(+st.minute || 0, 0, 20), hs = +st.home || 0, as = +st.away || 0, d = hs - as;
    var elapsed = per >= 4 ? 60 : (per - 1) * 20 + min, left = st.finished ? 0 : Math.max(0, 60 - elapsed), frac = left / 60;
    var rh = lh * frac, ra = la * frac;
    if (st.sogHome != null && st.sogAway != null && elapsed >= 10) { // shots vs. what the pre-match rates implied (~10 shots per goal)
      var w = 0.5 * elapsed / 60;
      rh *= 1 + w * (clamp(st.sogHome / Math.max(lh * 10 * elapsed / 60, 1), 0.5, 2) - 1);
      ra *= 1 + w * (clamp(st.sogAway / Math.max(la * 10 * elapsed / 60, 1), 0.5, 2) - 1);
    }
    if (d === -1) { rh *= 1.12; ra *= 0.95; } else if (d === 1) { ra *= 1.12; rh *= 0.95; }
    // empty net in the last ~3 minutes when a side trails by 1-2: both rates jump, the leader's most
    if (per === 3 && left <= 3.5 && left > 0 && Math.abs(d) >= 1 && Math.abs(d) <= 2) {
      var en = left / 60 * 9; if (d > 0) { ra += en * 0.35; rh += en; } else { rh += en * 0.35; ra += en; }
    }
    if (st.ppHome) rh += 0.17; if (st.ppAway) ra += 0.17;
    var M = poisM(Math.max(rh, 1e-6), Math.max(ra, 1e-6)), q = otShare(lh, la), mk = {}, tie = 0;
    function P(f) { var s = 0; for (var i = 0; i <= MAXG; i++) for (var j = 0; j <= MAXG; j++) { var p = M[i][j]; if (p < 1e-12) continue; var h = hs + i, a = as + j; if (h !== a) { if (f(h, a)) s += p; } else { if (f(h + 1, a)) s += p * q; if (f(h, a + 1)) s += p * (1 - q); } } return s; }
    if (per >= 4) { mk.home = d > 0 ? 1 : d < 0 ? 0 : q; mk.away = 1 - mk.home; mk.regHome = d > 0 ? 1 : 0; mk.regDraw = d === 0 ? 1 : 0; }
    else { mk.home = P(function (h, a) { return h > a; }); mk.away = 1 - mk.home; mk.regHome = sumIf(M, function (i, j) { return hs + i > as + j; }); mk.regDraw = sumIf(M, function (i, j) { return hs + i === as + j; }); }
    mk.regAway = 1 - mk.regHome - mk.regDraw;
    mk.nextGoal = { home: rh / (rh + ra) * (1 - M[0][0]), away: ra / (rh + ra) * (1 - M[0][0]), none: M[0][0] };
    mk.over = {}; var now = hs + as; [4.5, 5.5, 6.5, 7.5, 8.5].forEach(function (L) { if (L > now) mk.over[L] = P(function (h, a) { return h + a > L; }); });
    mk.puckHome = P(function (h, a) { return h - a >= 2; }); mk.puckAway = P(function (h, a) { return a - h >= 2; });
    var opts = [];
    function add(gr, label, p) { if (p >= 0.6 && p <= 0.9) opts.push({ group: gr, label: label, p: p, fair: 1 / p, takeAt: round(1.05 / p, 2) }); }
    add("Moneyline", H + " to win (incl. OT)", mk.home); add("Moneyline", A + " to win (incl. OT)", mk.away);
    add("60-min result", H + " or draw (60 min)", mk.regHome + mk.regDraw); add("60-min result", A + " or draw (60 min)", mk.regAway + mk.regDraw);
    Object.keys(mk.over).forEach(function (L) { add("Total", "Over " + L + " goals", mk.over[L]); add("Total", "Under " + L + " goals", 1 - mk.over[L]); });
    add("Puck line", H + " +1.5", 1 - mk.puckAway); add("Puck line", A + " +1.5", 1 - mk.puckHome);
    if (left > 4) { add("Next goal", H + " next goal", mk.nextGoal.home); add("Next goal", A + " next goal", mk.nextGoal.away); }
    var groups = {}; opts.forEach(function (x) { var b = groups[x.group]; if (!b || Math.abs(x.p - 0.72) < Math.abs(b.p - 0.72)) groups[x.group] = x; });
    return { pre: pre, minutesLeft: left, score: [hs, as], remaining: { home: rh, away: ra }, markets: mk, picks: Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.p - a.p; }) };
  }

  return { analyse: analyse, live: live, devig: devig, fair: fair, round: round, setCalibration: setCalibration, trackStats: trackStats, parseProp: parseProp };
});
