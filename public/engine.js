/* Matchday Edge — prediction engine.
   Pure functions, no network. Runs in the browser (window.BetEngine) and in Node (require).
   Input: one match object from data/YYYY-MM-DD.json. Output: probabilities, fair odds and picks. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BetEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAXG = 10;              // goals per team considered in the score matrix
  var BASE_GOALS = 1.35;      // average goals per team per international match
  var DC_RHO = -0.06;         // Dixon-Coles low-score correction
  var MARKET_WEIGHT = 0.75;   // how much the bookmaker-implied goal rates count vs. team stats

  // ---------- small maths helpers ----------
  var LOGF = [0];
  for (var i = 1; i <= 60; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
  function pois(k, l) { return l <= 0 ? (k === 0 ? 1 : 0) : Math.exp(-l + k * Math.log(l) - LOGF[k]); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function round(x, d) { var m = Math.pow(10, d || 0); return Math.round(x * m) / m; }
  function fair(p) { return p > 0 ? 1 / p : null; }

  // Negative binomial pmf (mean mu, dispersion r). Corners and cards are over-dispersed counts.
  function nbPmf(k, mu, r) {
    var p = r / (r + mu);
    var lg = lgamma(k + r) - lgamma(r) - LOGF[Math.min(k, 60)];
    return Math.exp(lg + r * Math.log(p) + k * Math.log(1 - p));
  }
  function lgamma(z) { // Lanczos
    var g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1; var x = c[0];
    for (var i = 1; i < g + 2; i++) x += c[i] / (z + i);
    var t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function nbDist(mu, r, max) { var d = [], s = 0; for (var k = 0; k <= max; k++) { d[k] = nbPmf(k, mu, r); s += d[k]; } return d.map(function (v) { return v / s; }); }
  function overFromDist(d, line) { var s = 0; for (var k = 0; k < d.length; k++) if (k > line) s += d[k]; return s; }

  // ---------- score matrix ----------
  function tau(x, y, lh, la, rho) {
    if (x === 0 && y === 0) return 1 - lh * la * rho;
    if (x === 0 && y === 1) return 1 + lh * rho;
    if (x === 1 && y === 0) return 1 + la * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  }
  function scoreMatrix(lh, la, rho) {
    var M = [], s = 0;
    for (var h = 0; h <= MAXG; h++) {
      M[h] = [];
      for (var a = 0; a <= MAXG; a++) {
        var v = pois(h, lh) * pois(a, la) * tau(h, a, lh, la, rho);
        M[h][a] = Math.max(v, 0); s += M[h][a];
      }
    }
    for (h = 0; h <= MAXG; h++) for (a = 0; a <= MAXG; a++) M[h][a] /= s;
    return M;
  }
  function sumIf(M, f) { var s = 0; for (var h = 0; h <= MAXG; h++) for (var a = 0; a <= MAXG; a++) if (f(h, a)) s += M[h][a]; return s; }

  // ---------- bookmaker odds ----------
  function devig(odds) { // proportional margin removal
    var inv = odds.map(function (o) { return o ? 1 / o : 0; });
    var s = inv.reduce(function (a, b) { return a + b; }, 0);
    return { probs: inv.map(function (v) { return v / s; }), margin: s - 1 };
  }

  // Find the goal rates that best reproduce the market's 1X2, over/under 2.5 and BTTS prices.
  function fitToMarket(odds) {
    var t = {};
    if (odds.h && odds.d && odds.a) { var p = devig([odds.h, odds.d, odds.a]).probs; t.h = p[0]; t.d = p[1]; t.a = p[2]; }
    if (odds.ou && odds.ou["2.5"]) t.o25 = devig(odds.ou["2.5"]).probs[0];
    if (odds.btts) t.btts = devig(odds.btts).probs[0];
    if (t.h == null) return null;
    function loss(lh, la) {
      var M = scoreMatrix(lh, la, DC_RHO);
      var ph = sumIf(M, function (h, a) { return h > a; }), pd = sumIf(M, function (h, a) { return h === a; });
      var e = Math.pow(ph - t.h, 2) + Math.pow(pd - t.d, 2) + Math.pow(1 - ph - pd - t.a, 2);
      if (t.o25 != null) e += 0.8 * Math.pow(sumIf(M, function (h, a) { return h + a > 2; }) - t.o25, 2);
      if (t.btts != null) e += 0.4 * Math.pow(sumIf(M, function (h, a) { return h > 0 && a > 0; }) - t.btts, 2);
      return e;
    }
    var best = { e: Infinity, lh: 1.3, la: 1.1 };
    for (var lh = 0.15; lh <= 4.5; lh += 0.1) for (var la = 0.15; la <= 4.5; la += 0.1) {
      var e = loss(lh, la); if (e < best.e) best = { e: e, lh: lh, la: la };
    }
    var c = best;
    for (lh = c.lh - 0.1; lh <= c.lh + 0.1; lh += 0.01) for (la = c.la - 0.1; la <= c.la + 0.1; la += 0.01) {
      if (lh <= 0.05 || la <= 0.05) continue;
      e = loss(lh, la); if (e < best.e) best = { e: e, lh: lh, la: la };
    }
    return { lh: best.lh, la: best.la, fitError: Math.sqrt(best.e / 5), target: t };
  }

  // Goal rates from team form, independent of the market: last-20 goals and xG, plus this
  // competition's games (small sample, low weight). Ratings are damped toward the average
  // because international form comes against opponents of very different strength.
  function fromStats(st, season, neutral) {
    if (!st || !st.home || !st.away) return null;
    season = season || {};
    function att(s, cur) {
      var v = s.xgf != null ? 0.55 * s.gf + 0.45 * s.xgf : s.gf;
      return cur && cur.gf != null ? 0.8 * v + 0.2 * cur.gf : v;
    }
    function def(s, cur) {
      var v = s.xga != null ? 0.55 * s.ga + 0.45 * s.xga : s.ga;
      return cur && cur.ga != null ? 0.8 * v + 0.2 * cur.ga : v;
    }
    function rate(a, d) { return BASE_GOALS * Math.pow(a / BASE_GOALS, 0.8) * Math.pow(d / BASE_GOALS, 0.8); }
    var ha = neutral ? 1 : 1.08, aa = neutral ? 1 : 0.93;
    return {
      lh: clamp(rate(att(st.home, season.home), def(st.away, season.away)) * ha, 0.15, 4.5),
      la: clamp(rate(att(st.away, season.away), def(st.home, season.home)) * aa, 0.15, 4.5)
    };
  }

  // ---------- markets from a score matrix ----------
  function markets(M, lh, la) {
    var m = {};
    m.home = sumIf(M, function (h, a) { return h > a; });
    m.draw = sumIf(M, function (h, a) { return h === a; });
    m.away = 1 - m.home - m.draw;
    m.dc = { "1X": m.home + m.draw, "X2": m.draw + m.away, "12": m.home + m.away };
    m.dnb = { home: m.home / (m.home + m.away), away: m.away / (m.home + m.away) };
    m.over = {}; [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].forEach(function (L) { m.over[L] = sumIf(M, function (h, a) { return h + a > L; }); });
    m.btts = sumIf(M, function (h, a) { return h > 0 && a > 0; });
    m.wtn = { home: sumIf(M, function (h, a) { return h > a && a === 0; }), away: sumIf(M, function (h, a) { return a > h && h === 0; }) };
    var p00 = M[0][0];
    m.firstGoal = { home: (1 - p00) * lh / (lh + la), away: (1 - p00) * la / (lh + la), none: p00 };
    m.homeOver = {}; m.awayOver = {};
    [0.5, 1.5, 2.5].forEach(function (L) {
      m.homeOver[L] = sumIf(M, function (h) { return h > L; });
      m.awayOver[L] = sumIf(M, function (h, a) { return a > L; });
    });
    // Asian handicap for the home side; fair price accounts for stake returned on a push
    m.ah = [];
    [-2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5].forEach(function (L) {
      var win = sumIf(M, function (h, a) { return h - a + L > 0; });
      var push = sumIf(M, function (h, a) { return h - a + L === 0; });
      var lose = 1 - win - push;
      m.ah.push({ line: L, homeWin: win, push: push, awayWin: lose,
        homeFair: win > 0 ? (1 - push) / win : null, awayFair: lose > 0 ? (1 - push) / lose : null });
    });
    var cs = [];
    for (var h = 0; h <= 6; h++) for (var a = 0; a <= 6; a++) cs.push({ score: h + "-" + a, p: M[h][a] });
    cs.sort(function (x, y) { return y.p - x.p; });
    m.correctScores = cs.slice(0, 8);
    m.totalDist = []; for (var g = 0; g <= 7; g++) m.totalDist[g] = sumIf(M, function (h, a) { return g < 7 ? h + a === g : h + a >= 7; });
    return m;
  }

  // Fit the mean of an over-dispersed count to a bookmaker over/under line (corners, cards).
  function fitCountMean(ou, r, prefer) {
    if (!ou) return null;
    var lines = Object.keys(ou).map(parseFloat).filter(function (L) { return ou[String(L)] && ou[String(L)][0] && ou[String(L)][1]; });
    if (!lines.length) return null;
    lines.sort(function (a, b) { return Math.abs(a - prefer) - Math.abs(b - prefer); });
    var L = lines[0], pr = ou[String(L)], target = devig(pr).probs[0];
    var lo = 0.5, hi = 30;
    for (var i = 0; i < 40; i++) { var mid = (lo + hi) / 2; if (overFromDist(nbDist(mid, r, 60), L) < target) lo = mid; else hi = mid; }
    return { mean: (lo + hi) / 2, line: L, pOver: target };
  }

  // ---------- corners ----------
  function corners(match, lh, la) {
    var s = match.season || {}, hs = s.home || {}, as = s.away || {};
    var share = Math.pow(lh / la, 0.3);
    var priorH = 5.0 * share / (0.5 + 0.5 * share) * 0.95 * (match.neutral ? 1 : 1.05);
    var priorA = 5.0 / (0.5 + 0.5 * share) * 0.95 * (match.neutral ? 1 : 0.95);
    var w = 0.4; // small samples: lean on the prior
    var ch = hs.corners != null ? w * hs.corners + (1 - w) * priorH : priorH;
    var ca = as.corners != null ? w * as.corners + (1 - w) * priorA : priorA;
    var r = 9, source = "team averages";
    var fit = fitCountMean(match.odds && match.odds.corners, r, 9.5);
    if (fit) { // the bookmaker line sets the total; team strength sets the split
      var f = fit.mean / (ch + ca); ch *= f; ca *= f; source = "bookmaker line " + fit.line;
    }
    var dist = nbDist(ch + ca, r, 30), dh = nbDist(ch, r, 20), da = nbDist(ca, r, 20);
    var over = {}; [7.5, 8.5, 9.5, 10.5, 11.5].forEach(function (L) { over[L] = overFromDist(dist, L); });
    var hOver = {}, aOver = {}; [2.5, 3.5, 4.5, 5.5, 6.5].forEach(function (L) { hOver[L] = overFromDist(dh, L); aOver[L] = overFromDist(da, L); });
    var hMore = 0, aMore = 0;
    for (var i = 0; i <= 20; i++) for (var j = 0; j <= 20; j++) { if (i > j) hMore += dh[i] * da[j]; else if (j > i) aMore += dh[i] * da[j]; }
    return { home: ch, away: ca, total: ch + ca, over: over, homeOver: hOver, awayOver: aOver, homeMore: hMore, awayMore: aMore, tie: 1 - hMore - aMore, source: source };
  }

  // ---------- cards (yellow cards; reds reported separately) ----------
  function cards(match, pHome, pAway) {
    var ref = match.referee || {}, s = match.season || {}, ts = match.teamStats || {};
    var n = ref.games || 0, prior = 4.1;
    var refY = n > 0 && ref.yellowsPg != null ? (n * ref.yellowsPg + 6 * prior) / (n + 6) : prior;
    var closeness = 1 - Math.abs(pHome - pAway);
    var tension = (0.92 + 0.16 * closeness) * (match.cardBoost || 1);
    var fh = (s.home && s.home.fouls) || null, fa = (s.away && s.away.fouls) || null;
    var yh = ts.home && ts.home.yellowsPg, ya = ts.away && ts.away.yellowsPg;
    var mu, shareH, source;
    if (yh != null && ya != null) { // each side's own yellow cards per game this season
      var teamsY = yh + ya;
      mu = (0.6 * teamsY + 0.4 * refY) * tension; shareH = clamp(yh / Math.max(teamsY, 0.1), 0.3, 0.7); source = "team card averages";
    } else {
      fh = fh || 11; fa = fa || 11;
      var foulY = (fh + fa) * 0.17;
      mu = (0.5 * refY + 0.5 * foulY) * tension; shareH = clamp(fh / (fh + fa) + 0.08 * (pAway - pHome), 0.3, 0.7); source = "fouls and referee";
    }
    var r = 12;
    var fit = fitCountMean(match.odds && match.odds.cards, r, 4.5);
    if (fit) { mu = fit.mean; source = "bookmaker line " + fit.line; }
    var d = nbDist(mu, r, 20);
    var over = {}; [2.5, 3.5, 4.5, 5.5].forEach(function (L) { over[L] = overFromDist(d, L); });
    var dh = nbDist(mu * shareH, r, 15), da = nbDist(mu * (1 - shareH), r, 15);
    var hOver = {}, aOver = {}; [0.5, 1.5, 2.5].forEach(function (L) { hOver[L] = overFromDist(dh, L); aOver[L] = overFromDist(da, L); });
    var rp = (ts.home && ts.home.redsPg != null && ts.away && ts.away.redsPg != null) ? ts.home.redsPg + ts.away.redsPg : null;
    var redsPg = n > 0 && ref.redsPg != null ? (n * ref.redsPg + 8 * 0.12) / (n + 8) : rp != null ? 0.5 * rp + 0.5 * 0.12 : 0.12;
    return { total: mu, home: mu * shareH, away: mu * (1 - shareH), over: over, homeOver: hOver, awayOver: aOver,
      redCard: 1 - Math.exp(-redsPg), refAdj: refY, source: source };
  }

  // Weather: heavy rain, strong wind, heat and snow all trim scoring a little.
  function weatherFactor(wx) {
    if (!wx) return { factor: 1, notes: [] };
    var f = 1, notes = [];
    if (wx.precipMm >= 4) { f *= 0.94; notes.push("heavy rain"); } else if (wx.precipMm >= 1) { f *= 0.97; notes.push("rain"); }
    if (wx.windKmh >= 40) { f *= 0.94; notes.push("strong wind"); } else if (wx.windKmh >= 25) { f *= 0.97; notes.push("windy"); }
    if (wx.tempC >= 30) { f *= 0.97; notes.push("heat"); }
    if ([71, 73, 75, 77, 85, 86].indexOf(wx.code) >= 0 || wx.tempC <= -3) { f *= 0.95; notes.push("snow or frost"); }
    // bookmakers price some of this in already, so apply half the effect
    return { factor: Math.max(0.85, Math.sqrt(f)), notes: notes };
  }

  function normName(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/ø/g, "o").replace(/ł/g, "l").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function bookOddsFor(name, map) {
    if (!map) return null;
    var nn = normName(name), parts = nn.split(" "), last = parts[parts.length - 1];
    var keys = Object.keys(map);
    for (var i = 0; i < keys.length; i++) if (normName(keys[i]) === nn) return map[keys[i]];
    for (i = 0; i < keys.length; i++) {
      var k = normName(keys[i]), kp = k.split(" ");
      if (kp[kp.length - 1] === last && (kp[0][0] === parts[0][0] || kp.length === 1 || parts.length === 1)) return map[keys[i]];
    }
    return null;
  }

  // ---------- players ----------
  function players(match, lh, la) {
    var out = [];
    ["home", "away"].forEach(function (side) {
      var list = (match.players && match.players[side]) || [];
      var lam = side === "home" ? lh : la;
      var sumS = 0, sumG = 0, sumA = 0;
      list.forEach(function (p) { sumS += p.shots || 0; sumG += p.goals || 0; sumA += p.assists || 0; });
      var team = (match.teamTotals && match.teamTotals[side]) || {};
      var S = team.shots || Math.max(sumS * 1.7, 1), G = team.goals || Math.max(sumG * 1.6, 1);
      var A = team.assists || Math.max(sumA * 1.8, 0.7 * G, 1);
      list.forEach(function (p) {
        // additive smoothing: a few games of data should not hand one player half a team's goals
        var sShare = (p.shots || 0) / (S + 40), gShare = (p.goals || 0) / (G + 6);
        var posDefault = p.pos === "FW" ? 0.06 : p.pos === "AM" ? 0.045 : p.pos === "MF" ? 0.03 : 0.015;
        // shrink toward a positional default: small samples overstate a hot streak
        var w0 = (p.shots || p.goals) ? 0.8 * (0.5 * sShare + 0.5 * gShare) + 0.2 * posDefault : posDefault;
        var w = clamp(w0 + (p.pens ? 0.06 : 0), 0.01, 0.45);
        var aw = p.assists != null ? 0.6 * (p.assists / A) + 0.4 * w0 : 0.45 * w0;
        var start = p.start != null ? p.start : 0.5;
        var mins = start * 0.86 + (1 - start) * 0.15;
        var k = mins / 0.86; // shares were measured on mostly full games
        var pg = 1 - Math.exp(-lam * w * k);
        var pa = 1 - Math.exp(-lam * 0.72 * aw * k);
        var pga = 1 - (1 - pg) * (1 - pa) * 0.97;
        var bo = bookOddsFor(p.name, match.odds && match.odds.scorers);
        out.push({ name: p.name, team: side, pos: p.pos, start: start, scorer: pg, assist: pa, scoreOrAssist: pga,
          scorerFair: fair(pg), assistFair: fair(pa), scorerOdds: bo, scorerEv: bo ? pg * bo - 1 : null, note: p.note || null });
      });
    });
    return out;
  }

  // ---------- learning from results ----------
  // results.json holds every graded pick. For each market group we compare the chance the
  // model gave with how often it actually landed. If a market lands less often than promised,
  // its chances are pulled toward 50/50 (both sides of the line alike, so Over and Under stay
  // consistent); if it lands more often, they are stretched a little. Nothing moves until a
  // market has 8 graded picks, and the data gets half weight at 25.
  var CAL = {};
  function setCalibration(stats) { CAL = stats || {}; }
  // What the track record is doing to one market right now (shown on the site).
  // state: anchored (1X2 follows the bookmaker), collecting (< 8 picks), none, trimmed or stretched.
  function calibInfo(group) {
    var s = CAL[group], n = s ? s.n : 0;
    if (group === "Result") return { state: "anchored", n: n, k: 1 };
    if (!s || n < 8) return { state: "collecting", n: n, need: 8, k: 1 };
    if (Math.abs(s.meanP - 0.5) < 0.03) return { state: "none", n: n, k: 1 };
    var kRaw = clamp((s.hit - 0.5) / (s.meanP - 0.5), 0.4, 1.25);
    var k = 1 + (n / (n + 25)) * (kRaw - 1);
    return { state: k < 0.995 ? "trimmed" : k > 1.005 ? "stretched" : "none", n: n, k: k };
  }
  function calib(group, p) {
    if (p == null) return p;
    var k = calibInfo(group).k; if (k === 1) return p;
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
  // Counts the model prices on its own (no bookmaker line to anchor them) are pulled toward
  // 50/50: on 12 Nov "Over 7.5 corners" in Italy-France and "England most corners" both missed.
  function modelOnly(p) { return 0.5 + 0.8 * (p - 0.5); }

  // Every slip row gets a verdict, so weak picks are labelled Skip instead of sitting in the slip.
  function grade(x) {
    if (x.odds) {
      if (x.ev >= 0.015 && x.p >= 0.45) return "Bet";
      if (x.ev >= -0.02 && x.p >= 0.55) return "Lean";
      return "Skip";
    }
    return x.p >= 0.64 ? "Lean" : "Skip";
  }

  // ---------- player props (shots, shots on target, fouls, tackles) ----------
  // Bookmakers price "1+ shot on target" at 1.30 (needs 77%) for wingers who average under one
  // a game. Every prop now gets a model chance, and a prop is only a bet if that beats the price.
  var PROP_PRIOR = {
    shots:   { FW: 2.5, AM: 1.8, MF: 1.0, DF: 0.55, GK: 0 },
    sot:     { FW: 0.95, AM: 0.65, MF: 0.33, DF: 0.17, GK: 0 },
    fouls:   { FW: 1.15, AM: 1.0, MF: 1.35, DF: 1.05, GK: 0.08 },
    tackles: { FW: 0.55, AM: 1.0, MF: 1.8, DF: 1.6, GK: 0.02 }
  };
  function parseProp(market) {
    var m = /(\d+)\+?\s*(shots on target|shot on target|shots|shot|fouls committed|fouls|foul|tackles|tackle)/i.exec(market || "");
    if (!m) return null;
    var w = m[2].toLowerCase();
    return { k: +m[1], stat: /target/.test(w) ? "sot" : /shot/.test(w) ? "shots" : /foul/.test(w) ? "fouls" : "tackles" };
  }
  function nbAtLeast(k, mu, r) { var s = 0; for (var i = 0; i < k; i++) s += nbPmf(i, mu, r); return 1 - s; }
  function propModel(match, prop, lh, la) {
    var pp = parseProp(prop.market); if (!pp) return null;
    var who = null, side = null;
    ["home", "away"].forEach(function (sd) { ((match.players && match.players[sd]) || []).forEach(function (pl) {
      if (!who && normName(pl.name) === normName(prop.player)) { who = pl; side = sd; } }); });
    var pos = (who && who.pos) || prop.pos || "MF";
    var prior = PROP_PRIOR[pp.stat][pos] != null ? PROP_PRIOR[pp.stat][pos] : PROP_PRIOR[pp.stat].MF;
    var rate = prior, basis = "position average";
    var own = who && who[pp.stat + "90"];
    if (own != null) { rate = 0.75 * own + 0.25 * prior; basis = "player per-90"; }
    else if (who && (pp.stat === "shots" || pp.stat === "sot") && who.shots && match.teamTotals && match.teamTotals[side] && match.teamTotals[side].shots) {
      var teamPg = (match.season && match.season[side] && match.season[side].shots) || 12;
      var est = who.shots / match.teamTotals[side].shots * teamPg * (pp.stat === "sot" ? (pos === "FW" ? 0.4 : 0.33) : 1);
      rate = 0.6 * est + 0.4 * prior; basis = "share of team shots";
    }
    if (pp.stat === "shots" || pp.stat === "sot") rate *= Math.pow((side === "away" ? la : lh) / BASE_GOALS, 0.5);
    var start = who && who.start != null ? who.start : 0.7;
    var mins = start * 0.85 + (1 - start) * 0.12;
    var mu = rate * mins;
    var p = nbAtLeast(pp.k, mu, pp.stat === "fouls" || pp.stat === "tackles" ? 6 : 4);
    var hit = /^(\d+)\/(\d+)$/.exec(prop.hit || "");
    if (hit) p = (p * 10 + +hit[1]) / (10 + +hit[2]); // last-5 hit rates are noisy: worth 5 games against 10 of model
    p = calib("Player prop", p);
    var ev = prop.odds ? p * prop.odds - 1 : null;
    return { player: prop.player, market: prop.market, odds: prop.odds || null, hitRate: prop.hit || null, p: p, fair: fair(p), ev: ev,
      need: prop.odds ? 1 / prop.odds : null, basis: basis, mean: mu,
      grade: ev == null ? (p >= 0.75 ? "Lean" : "Skip") : ev >= 0.03 ? "Bet" : ev >= 0 ? "Lean" : "Skip" };
  }

  // ---------- picks ----------
  function ahLabel(name, line) { return name + " " + (line > 0 ? "+" : "") + line + " (Asian handicap)"; }

  function candidates(m, o, names, ctx) {
    var c = [];
    function add(label, group, p, odds, pair, push) {
      if (!odds || p == null) return;
      push = push || 0;
      p = calib(group, p);
      c.push({ label: label, group: group, p: p, push: push || null, odds: odds, implied: pair != null ? pair : 1 / odds,
        ev: p * odds + push - 1 });
    }
    if (o.h) { var dv = devig([o.h, o.d, o.a]).probs;
      add(names.home + " to win", "Result", m.home, o.h, dv[0]); add("Draw", "Result", m.draw, o.d, dv[1]); add(names.away + " to win", "Result", m.away, o.a, dv[2]); }
    if (o.dc) {
      add(names.home + " or draw", "Double chance", m.dc["1X"], o.dc["1X"]);
      add(names.away + " or draw", "Double chance", m.dc["X2"], o.dc["X2"]);
      add("Either team to win", "Double chance", m.dc["12"], o.dc["12"]);
    }
    if (o.dnb) { var d2 = devig([o.dnb.home, o.dnb.away]).probs;
      add(names.home + " draw no bet", "Draw no bet", m.dnb.home, o.dnb.home, d2[0]); add(names.away + " draw no bet", "Draw no bet", m.dnb.away, o.dnb.away, d2[1]); }
    if (o.ou) Object.keys(o.ou).forEach(function (L) {
      var pr = o.ou[L], dv2 = devig(pr).probs, pO = m.over[L];
      if (pO == null) return;
      add("Over " + L + " goals", "Goals", pO, pr[0], dv2[0]); add("Under " + L + " goals", "Goals", 1 - pO, pr[1], dv2[1]);
    });
    if (o.btts) { var db = devig(o.btts).probs; add("Both teams to score", "BTTS", m.btts, o.btts[0], db[0]); add("Both teams to score: No", "BTTS", 1 - m.btts, o.btts[1], db[1]); }
    if (o.wtn) { add(names.home + " to win to nil", "Win to nil", m.wtn.home, o.wtn.home); add(names.away + " to win to nil", "Win to nil", m.wtn.away, o.wtn.away); }
    if (o.firstGoal) { add(names.home + " to score first", "First goal", m.firstGoal.home, o.firstGoal.home); add(names.away + " to score first", "First goal", m.firstGoal.away, o.firstGoal.away); }
    if (o.ah) o.ah.forEach(function (b) {
      var mk = null; for (var i = 0; i < m.ah.length; i++) if (Math.abs(m.ah[i].line - b.line) < 1e-9) mk = m.ah[i];
      if (!mk) return; // quarter lines are skipped
      var dv = devig([b.home, b.away]).probs, nopush = 1 - mk.push;
      add(ahLabel(names.home, b.line), "Handicap", mk.homeWin, b.home, dv[0] * nopush, mk.push);
      add(ahLabel(names.away, -b.line), "Handicap", mk.awayWin, b.away, dv[1] * nopush, mk.push);
    });
    if (ctx && o.corners) Object.keys(o.corners).forEach(function (L) {
      var po = ctx.corners.over[L]; if (po == null) return;
      var pr = o.corners[L], dv = devig(pr).probs;
      add("Over " + L + " corners", "Corners", po, pr[0], dv[0]); add("Under " + L + " corners", "Corners", 1 - po, pr[1], dv[1]);
    });
    if (ctx && o.cards) Object.keys(o.cards).forEach(function (L) {
      var po = ctx.cards.over[L]; if (po == null) return;
      var pr = o.cards[L], dv = devig(pr).probs;
      add("Over " + L + " cards", "Cards", po, pr[0], dv[0]); add("Under " + L + " cards", "Cards", 1 - po, pr[1], dv[1]);
    });
    if (ctx) ctx.players.forEach(function (pl) {
      if (pl.scorerOdds && pl.start >= 0.6) add(pl.name + " to score", "Scorer", pl.scorer, pl.scorerOdds);
    });
    return c;
  }

  function confidence(x) {
    if (x.ev >= 0.04 && x.p >= 0.5) return "Strong";
    if (x.ev >= 0.015) return "Lean";
    if (x.ev >= -0.02) return "Fair price";
    return "Thin";
  }

  function best(arr, score) { var b = null, bs = -Infinity; arr.forEach(function (x) { var s = score(x); if (s > bs) { bs = s; b = x; } }); return b; }

  // Pick the side of a count market (corners, cards) at the line that gives a ~62% shot.
  function lineSide(overMap, unit) {
    var opts = [];
    Object.keys(overMap).forEach(function (L) {
      var po = overMap[L];
      opts.push({ label: (po >= 0.5 ? "Over " : "Under ") + L + " " + unit, p: Math.max(po, 1 - po) });
    });
    return best(opts.filter(function (x) { return x.p >= 0.55; }), function (x) { return -Math.abs(x.p - 0.63); });
  }

  // One recommendation per market, the way a bettor builds a slip.
  function slip(m, o, names, cands, ctx) {
    var out = [];
    var fav = m.home >= m.away ? "home" : "away", favName = names[fav], dog = fav === "home" ? "away" : "home";
    function find(label) { for (var i = 0; i < cands.length; i++) if (cands[i].label === label) return cands[i]; return null; }
    // Result or handicap: the favourite's line that lands in a 1.55-2.40 price range
    var opts = [];
    var pw = fav === "home" ? m.home : m.away, pdnb = fav === "home" ? m.dnb.home : m.dnb.away, pdc = pw + m.draw;
    var w = find(favName + " to win");
    opts.push(w ? { label: favName + " to win", p: w.p, odds: w.odds, ev: w.ev } : { label: favName + " to win", p: pw, odds: null, fair: fair(pw) });
    var dnb = find(favName + " draw no bet");
    opts.push(dnb ? { label: favName + " draw no bet", p: dnb.p, odds: dnb.odds, ev: dnb.ev } : { label: favName + " draw no bet", p: pdnb, push: m.draw, odds: null, fair: (1 - m.draw) / pw });
    var dc = find(favName + " or draw");
    opts.push(dc ? { label: favName + " or draw", p: dc.p, odds: dc.odds, ev: dc.ev } : { label: favName + " or draw", p: pdc, odds: null, fair: fair(pdc) });
    m.ah.forEach(function (a) {
      var line = fav === "home" ? a.line : -a.line;
      if (line >= -0.5 || line < -2.5) return; // -0.5 is the same bet as "to win"

      var p = fav === "home" ? a.homeWin : a.awayWin, f = fav === "home" ? a.homeFair : a.awayFair;
      var push = a.push;
      var lab = ahLabel(favName, line), bk = find(lab);
      if (!bk && line < -1) return; // 12 Nov: model-only -1.5 for England lost on a 2-1; keep push protection
      opts.push({ label: lab, p: p, push: push, fair: f, odds: bk ? bk.odds : null, ev: bk ? bk.ev : null });
    });
    var res = best(opts.filter(function (x) { var pr = x.odds || x.fair; return pr >= 1.55 && pr <= 2.4; }), function (x) { return x.p + (x.ev != null ? x.ev : -0.03); })
      || best(opts, function (x) { return -Math.abs((x.odds || x.fair) - 1.8); });
    if (res) out.push({ market: "Result / handicap", pick: res.label, p: res.p, odds: res.odds, fair: res.fair || fair(res.p), ev: res.ev, push: res.push });
    // Goals line
    var goals = best(cands.filter(function (x) { return x.group === "Goals" && x.p >= 0.52 && x.p <= 0.8; }), function (x) { return x.ev + 0.2 * (x.p - 0.5); });
    if (goals) out.push({ market: "Total goals", pick: goals.label, p: goals.p, odds: goals.odds, ev: goals.ev, fair: fair(goals.p) });
    else { var gl = lineSide({ 1.5: m.over[1.5], 2.5: m.over[2.5], 3.5: m.over[3.5] }, "goals"); if (gl) out.push({ market: "Total goals", pick: gl.label, p: gl.p, odds: null, fair: fair(gl.p) }); }
    // BTTS
    var by = find("Both teams to score"), bn = find("Both teams to score: No");
    var bt = by && bn ? (by.p >= bn.p ? by : bn) : null;
    if (!bt) bt = { label: m.btts >= 0.5 ? "Both teams to score" : "Both teams to score: No", p: Math.max(m.btts, 1 - m.btts), odds: null };
    out.push({ market: "Both teams to score", pick: bt.label === "Both teams to score" ? "Yes" : "No", p: bt.p, odds: bt.odds, ev: bt.ev, fair: fair(bt.p) });
    // Players: likely starters only
    var starters = ctx.players.filter(function (p) { return p.start >= 0.6; });
    var priced = starters.filter(function (p) { return p.scorerOdds && p.scorer >= 0.22; });
    var sc = priced.length ? best(priced, function (p) { return p.scorerEv + 0.5 * p.scorer; }) : best(starters, function (p) { return p.scorer; });
    if (sc) out.push({ market: "Anytime scorer", pick: sc.name, p: sc.scorer, odds: sc.scorerOdds || null, fair: sc.scorerFair, ev: sc.scorerEv });
    var as = best(starters, function (p) { return p.assist; });
    if (as) out.push({ market: "Assist", pick: as.name, p: as.assist, odds: null, fair: as.assistFair });
    // Corners and cards
    function bookCount(group) {
      return best(cands.filter(function (x) { return x.group === group && x.p >= 0.52 && x.p <= 0.82; }), function (x) { return x.ev + 0.2 * (x.p - 0.5); });
    }
    var cb = bookCount("Corners"), cs = cb ? null : lineSide(ctx.corners.over, "corners");
    if (cb) out.push({ market: "Corners", pick: cb.label, p: cb.p, odds: cb.odds, ev: cb.ev, fair: fair(cb.p) });
    else if (cs) { var cp = calib("Corners", modelOnly(cs.p)); out.push({ market: "Corners", pick: cs.label, p: cp, odds: null, fair: fair(cp) }); }
    var mc = ctx.corners.homeMore >= ctx.corners.awayMore ? { n: names.home, p: ctx.corners.homeMore } : { n: names.away, p: ctx.corners.awayMore };
    var mcp = calib("Most corners", modelOnly(mc.p));
    out.push({ market: "Most corners", pick: mc.n, p: mcp, odds: null, fair: fair(mcp) });
    var kb = bookCount("Cards"), cd = kb ? null : lineSide(ctx.cards.over, "cards");
    if (kb) out.push({ market: "Cards", pick: kb.label, p: kb.p, odds: kb.odds, ev: kb.ev, fair: fair(kb.p) });
    else if (cd) { var kp = calib("Cards", modelOnly(cd.p)); out.push({ market: "Cards", pick: cd.label, p: kp, odds: null, fair: fair(kp) }); }
    return out;
  }

  function pickBets(m, o, names, M, ctx) {
    var c = candidates(m, o, names, ctx);
    c.forEach(function (x) { x.edge = x.p - x.implied; x.confidence = confidence(x); });
    var top = best(c.filter(function (x) { return x.odds >= 1.35 && x.odds <= 3.5 && x.p >= 0.5 && x.ev >= -0.02 && x.group !== "Scorer"; }), function (x) { return 2 * x.ev + 0.25 * (x.p - 0.5); });
    var safe = best(c.filter(function (x) { return x.odds >= 1.2 && x.ev >= -0.07 && x !== top; }), function (x) { return x.p + 0.5 * x.ev; });
    var value = best(c.filter(function (x) { return x.odds >= 2.4 && x.p >= 0.18 && x !== top && x !== safe; }), function (x) { return x.ev; });
    // Bet builder: result leg x goals leg x BTTS leg, priced exactly from the score matrix
    var fav = m.home >= m.away ? "home" : "away";
    var favName = names[fav];
    // A result leg only goes in when the favourite really is one: on 12 Nov the builder
    // "France to win" (46%) sank, while builders on 55%+ favourites landed.
    var pFav = fav === "home" ? m.home : m.away;
    var res = [];
    if (pFav >= 0.55) res.push({ label: favName + " to win", f: fav === "home" ? function (h, a) { return h > a; } : function (h, a) { return a > h; } });
    if (pFav + m.draw >= 0.72) res.push({ label: favName + " or draw", f: fav === "home" ? function (h, a) { return h >= a; } : function (h, a) { return a >= h; } });
    res.push({ label: null, f: function () { return true; } });
    var gl = [
      { label: "Over 1.5 goals", f: function (h, a) { return h + a >= 2; } },
      { label: "Over 2.5 goals", f: function (h, a) { return h + a >= 3; } },
      { label: "Under 3.5 goals", f: function (h, a) { return h + a <= 3; } }
    ];
    var bt = [
      { label: null, f: function () { return true; } },
      { label: "Both teams to score", f: function (h, a) { return h > 0 && a > 0; } },
      { label: "BTTS: No", f: function (h, a) { return h === 0 || a === 0; } }
    ];
    var builds = [];
    res.forEach(function (r) { gl.forEach(function (g) { bt.forEach(function (b) {
      var p = sumIf(M, function (h, a) { return r.f(h, a) && g.f(h, a) && b.f(h, a); });
      var legs = []; if (r.label) legs.push(r.label); legs.push(g.label); if (b.label) legs.push(b.label);
      if (legs.length < 2) return;
      builds.push({ legs: legs, p: p, fair: 1 / p });
    }); }); });
    var winBuilds = builds.filter(function (x) { return x.legs[0] === favName + " to win" && x.fair >= 1.9 && x.fair <= 4.5; });
    var builder = best(winBuilds.length ? winBuilds : builds.filter(function (x) { return x.fair >= 1.9 && x.fair <= 4.5 && x.p >= 0.3; }), function (x) { return x.p + 0.03 * x.legs.length; });
    // Props join a slip only when the model beats the price; the rest are flagged Skip
    var props = (ctx.props || []).slice().sort(function (a, b) { return (b.ev || -1) - (a.ev || -1); });
    var s = slip(m, o, names, c, ctx);
    c.sort(function (a, b) { return b.ev - a.ev; });
    s.forEach(function (row) { row.grade = grade(row); });
    var noBet = !top ? "No bet: every price on offer is shorter than the model's fair odds." : null;
    return { top: top, noBet: noBet, safe: safe, value: value, builder: builder, slip: s, props: props, all: c };
  }

  // ---------- main ----------
  function analyse(match) {
    var o = match.odds || {};
    var names = { home: match.home.short || match.home.name, away: match.away.short || match.away.name };
    var mk = fitToMarket(o);
    var st = fromStats(match.form20, match.season, match.neutral);
    var lh, la, method;
    if (mk && st) { lh = MARKET_WEIGHT * mk.lh + (1 - MARKET_WEIGHT) * st.lh; la = MARKET_WEIGHT * mk.la + (1 - MARKET_WEIGHT) * st.la; method = "market+form"; }
    else if (mk) { lh = mk.lh; la = mk.la; method = "market"; }
    else if (st) { lh = st.lh; la = st.la; method = "form"; }
    else { lh = 1.35; la = 1.15; method = "prior"; }
    var adj = match.adjust || {};
    lh *= adj.home || 1; la *= adj.away || 1;
    var wx = weatherFactor(match.weather);
    lh *= wx.factor; la *= wx.factor;
    var M = scoreMatrix(lh, la, DC_RHO);
    var m = markets(M, lh, la);
    var marketProbs = o.h ? devig([o.h, o.d, o.a]) : null;
    var ctx = {
      corners: corners(match, lh, la),
      cards: cards(match, m.home, m.away),
      players: players(match, lh, la).sort(function (a, b) { return b.scorer - a.scorer; }),
      props: (match.props || []).map(function (pr) { return propModel(match, pr, lh, la); }).filter(Boolean)
    };
    return {
      id: match.id, xg: { home: lh, away: la }, method: method,
      market: mk ? { lh: mk.lh, la: mk.la, fitError: mk.fitError, probs: marketProbs.probs, margin: marketProbs.margin } : null,
      form: st, markets: m, weather: wx,
      corners: ctx.corners, cards: ctx.cards, players: ctx.players, props: ctx.props,
      picks: pickBets(m, o, names, M, ctx)
    };
  }


  // ---------- live (in-play) ----------
  // state: { minute, home, away (goals), redHome, redAway, cornersHome, cornersAway,
  //          yellowsHome, yellowsAway, sotHome, sotAway (optional), finished }
  // The pre-match goal rates are scaled to the minutes left (goals come a little faster late
  // on), adjusted for the score (trailing sides push, leaders sit deeper), red cards, and how
  // the game is actually going (shots on target against what the pre-match rates expected).
  function live(match, st) {
    var pre = analyse(match);
    st = st || {};
    var names = { home: match.home.short || match.home.name, away: match.away.short || match.away.name };
    var t = clamp(+st.minute || 0, 0, 120), hg = +st.home || 0, ag = +st.away || 0;
    var rH = +st.redHome || 0, rA = +st.redAway || 0;
    function F(x) { return 0.85 * x + 0.15 * x * x / 90; } // intensity rises from 0.85 to 1.15
    var end = Math.max(94, t + 2), full = F(94);
    var rem = st.finished ? 0 : clamp((F(end) - F(Math.min(t, end))) / full, 0, 1);
    var elapsed = clamp(F(Math.min(t, 94)) / full, 0, 1);
    var lh = pre.xg.home, la = pre.xg.away;
    // how the game is going: shots on target vs. ~3.2 per expected goal
    var form = { home: 1, away: 1 };
    if (st.sotHome != null && st.sotAway != null && elapsed > 0.15) {
      var w = 0.55 * elapsed;
      form.home = 1 + w * (clamp(st.sotHome / Math.max(lh * 3.2 * elapsed, 0.3), 0.4, 2.2) - 1);
      form.away = 1 + w * (clamp(st.sotAway / Math.max(la * 3.2 * elapsed, 0.3), 0.4, 2.2) - 1);
    }
    var d = hg - ag, sH = 1, sA = 1;
    if (d === 1) { sH = 0.9; sA = 1.15; } else if (d >= 2) { sH = 0.9; sA = 1.05; }
    else if (d === -1) { sA = 0.9; sH = 1.15; } else if (d <= -2) { sA = 0.9; sH = 1.05; }
    var redH = Math.pow(0.7, rH) * Math.pow(1.25, rA), redA = Math.pow(0.7, rA) * Math.pow(1.25, rH);
    var rh = lh * rem * sH * redH * form.home, ra = la * rem * sA * redA * form.away;
    var M = scoreMatrix(Math.max(rh, 1e-6), Math.max(ra, 1e-6), 0);
    function P(f) { return sumIf(M, function (i, j) { return f(hg + i, ag + j, i, j); }); }
    var mk = {};
    mk.home = P(function (h, a) { return h > a; }); mk.draw = P(function (h, a) { return h === a; }); mk.away = 1 - mk.home - mk.draw;
    mk.noMoreGoals = M[0][0];
    var tot = rh + ra;
    mk.nextGoal = { home: tot > 0 ? rh / tot * (1 - M[0][0]) : 0, away: tot > 0 ? ra / tot * (1 - M[0][0]) : 0, none: M[0][0] };
    mk.btts = P(function (h, a) { return h > 0 && a > 0; });
    var now = hg + ag; mk.over = {};
    [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5].forEach(function (L) { if (L > now) mk.over[L] = P(function (h, a) { return h + a > L; }); });
    var cs = [];
    for (var i = 0; i <= 6; i++) for (var j = 0; j <= 6; j++) cs.push({ score: (hg + i) + "-" + (ag + j), p: M[i][j] });
    cs.sort(function (x, y) { return y.p - x.p; }); mk.correctScores = cs.slice(0, 6);
    // corners: trailing sides win more of them
    var cH = +st.cornersHome || 0, cA = +st.cornersAway || 0, cRem = rem;
    var chm = pre.corners.home * cRem * (d < 0 ? 1.3 : d > 0 ? 0.85 : 1) * Math.pow(0.85, rH);
    var cam = pre.corners.away * cRem * (d > 0 ? 1.3 : d < 0 ? 0.85 : 1) * Math.pow(0.85, rA);
    var cd = nbDist(chm + cam, 9, 25), cNow = cH + cA, corners = { now: cNow, restMean: chm + cam, over: {} };
    for (var L = Math.floor(cNow) + 0.5; L <= cNow + 6.5; L += 1) { var s0 = 0; for (var k = 0; k < cd.length; k++) if (cNow + k > L) s0 += cd[k]; corners.over[L] = s0; }
    // cards: more of them late and in close games
    var yNow = (+st.yellowsHome || 0) + (+st.yellowsAway || 0);
    var ym = pre.cards.total * clamp(rem * 1.15, 0, 1) * (Math.abs(d) <= 1 ? 1.1 : 0.9);
    var yd = nbDist(ym, 12, 15), cards = { now: yNow, restMean: ym, over: {} };
    for (var L2 = Math.floor(yNow) + 0.5; L2 <= yNow + 4.5; L2 += 1) { var s1 = 0; for (var k2 = 0; k2 < yd.length; k2++) if (yNow + k2 > L2) s1 += yd[k2]; cards.over[L2] = s1; }

    // live picks: best of each market at a 60-88% chance, with the price that makes it worth it
    var opts = [];
    function add(group, label, p) { if (p >= 0.6 && p <= 0.9) opts.push({ group: group, label: label, p: p, fair: 1 / p, takeAt: round(1.05 / p, 2) }); }
    add("Result", names.home + " to win", mk.home); add("Result", names.away + " to win", mk.away);
    add("Result", names.home + " or draw", mk.home + mk.draw); add("Result", names.away + " or draw", mk.away + mk.draw);
    Object.keys(mk.over).forEach(function (L) { add("Goals", "Over " + L + " goals", mk.over[L]); add("Goals", "Under " + L + " goals", 1 - mk.over[L]); });
    add("BTTS", "Both teams to score", mk.btts); add("BTTS", "Both teams to score: No", 1 - mk.btts);
    if (rem > 0.08) { add("Next goal", names.home + " next goal", mk.nextGoal.home); add("Next goal", names.away + " next goal", mk.nextGoal.away); }
    if (st.cornersHome != null && st.cornersAway != null) Object.keys(corners.over).forEach(function (L) { add("Corners", "Over " + L + " corners", modelOnly(corners.over[L])); add("Corners", "Under " + L + " corners", modelOnly(1 - corners.over[L])); });
    if (st.yellowsHome != null && st.yellowsAway != null) Object.keys(cards.over).forEach(function (L) { add("Cards", "Over " + L + " cards", modelOnly(cards.over[L])); add("Cards", "Under " + L + " cards", modelOnly(1 - cards.over[L])); });
    var groups = {}; opts.forEach(function (o) { var g = groups[o.group]; if (!g || Math.abs(o.p - 0.72) < Math.abs(g.p - 0.72)) groups[o.group] = o; });
    var picks = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (a, b) { return b.p - a.p; });
    return { pre: pre, minute: t, score: [hg, ag], remainingXg: { home: rh, away: ra }, form: form, markets: mk, corners: corners, cards: cards, picks: picks, finished: !!st.finished };
  }

  return { analyse: analyse, live: live, devig: devig, scoreMatrix: scoreMatrix, fair: fair, round: round,
    setCalibration: setCalibration, trackStats: trackStats, calibInfo: calibInfo, parseProp: parseProp };
});
