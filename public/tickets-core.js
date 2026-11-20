/* Ticket builder core (Matchday Edge). Pure functions, no DOM: used by tickets.js and the tests.
 *
 * A ticket's real chance is P = product of p_i, its odds O = product of o_i, so P = (product of p_i*o_i) / O.
 * For a target O, the best ticket maximises the product of p_i*o_i: every leg priced below fair costs its
 * margin, so fewer and fairer legs land more often. One leg per game (legs from the same game are correlated).
 * Dynamic programme over (legs used, log-odds bucket), keeping the exact log-odds sum in each state.
 */
(function (root) {
  "use strict";
  var STEP = 0.01;

  function stats(legs) {
    var P = 1, O = 1;
    legs.forEach(function (l) { P *= l.p; O *= l.odds; });
    return { legs: legs, chance: P, odds: O, fair: P > 0 ? 1 / P : null, value: P * O };
  }

  // legs: [{id, game, p, odds, ...}]
  // opts: {target, tolerance (default 1.15), minLegs, maxLegs, exactLegs, minOdds, maxOdds, pinned: [ids]}
  function build(legs, opts) {
    opts = opts || {};
    var target = Math.max(1.01, +opts.target || 3), tol = opts.tolerance || 1.15;
    var lo = Math.log(target), hi = Math.log(target * tol);
    var maxLegs = opts.exactLegs || opts.maxLegs || 8, minLegs = opts.exactLegs || opts.minLegs || 1;
    var minOdds = opts.minOdds || 1.01, maxOdds = opts.maxOdds || 1000;
    var pinSet = {}; (opts.pinned || []).forEach(function (id) { pinSet[id] = true; });

    var pinned = [], usedGame = {};
    legs.forEach(function (l) { if (pinSet[l.id] && !usedGame[l.game]) { pinned.push(l); usedGame[l.game] = true; } });
    var base = 0; pinned.forEach(function (l) { base += Math.log(l.odds); });
    var k0 = pinned.length;
    if (k0 > maxLegs) return null;

    // free legs grouped by game, best 10 per game by value then chance
    var byGame = {};
    legs.forEach(function (l) {
      if (usedGame[l.game] || pinSet[l.id] || !(l.p > 0 && l.p < 1) || l.odds < minOdds || l.odds > maxOdds) return;
      (byGame[l.game] = byGame[l.game] || []).push(l);
    });
    var games = Object.keys(byGame).map(function (g) {
      return byGame[g].sort(function (a, b) { return b.p * b.odds - a.p * a.odds || b.p - a.p; }).slice(0, 10);
    });

    var room = hi - base, NB = Math.max(1, Math.floor(room / STEP) + 1), K = maxLegs - k0;
    // best[k][b] = {s: sum log(p*o), x: exact sum log(o), chain}
    var best = [];
    for (var k = 0; k <= K; k++) best.push(new Array(NB + 1));
    best[0][0] = { s: 0, x: 0, chain: null };
    if (room >= 0) {
      games.forEach(function (opts2) {
        for (var k = K - 1; k >= 0; k--) {          // descending k: each game adds at most one leg
          var row = best[k], next = best[k + 1];
          for (var b = 0; b <= NB; b++) {
            var st = row[b]; if (!st) continue;
            for (var i = 0; i < opts2.length; i++) {
              var l = opts2[i], x = st.x + Math.log(l.odds);
              if (x > room + 1e-9) continue;
              var nb = Math.floor(x / STEP), s = st.s + Math.log(l.p * l.odds), cur = next[nb];
              if (!cur || s > cur.s + 1e-12) next[nb] = { s: s, x: x, chain: { leg: l, prev: st.chain } };
            }
          }
        }
      });
    }

    var pick = null, pickScore = -Infinity;
    for (var kk = 0; kk <= K; kk++) {
      var total = k0 + kk; if (total < minLegs || total > maxLegs || total === 0) continue;
      for (var bb = 0; bb <= NB; bb++) {
        var st2 = best[kk][bb]; if (!st2) continue;
        var lx = base + st2.x; if (lx < lo - 1e-9 || lx > hi + 1e-9) continue;
        // chance at this ticket's odds; small nudge toward the target itself
        var score = st2.s - lx - 0.02 * Math.abs(lx - lo);
        if (score > pickScore) { pickScore = score; pick = st2; }
      }
    }
    if (!pick && !(k0 >= minLegs && base >= lo - 1e-9 && base <= hi + 1e-9)) return null;
    var out = pinned.slice();
    for (var c = pick && pick.chain; c; c = c.prev) out.push(c.leg);
    return stats(out);
  }

  root.TicketCore = { build: build, stats: stats };
})(typeof self !== "undefined" ? self : this);
