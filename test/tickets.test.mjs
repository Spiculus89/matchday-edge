import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/tickets-core.js", "utf8"), ctx);
const T = ctx.self.TicketCore;
// fair-ish legs: p*odds slightly under 1 (bookmaker margin), one game each unless noted
const leg = (id, game, p, odds) => ({ id, game, p, odds });
const legs = [
  leg("a1", "A", 0.75, 1.30), leg("a2", "A", 0.50, 1.95), leg("b1", "B", 0.70, 1.38), leg("c1", "C", 0.62, 1.55),
  leg("d1", "D", 0.55, 1.78), leg("e1", "E", 0.80, 1.22), leg("f1", "F", 0.45, 2.15), leg("g1", "G", 0.66, 1.47),
];
test("tickets: reaches the target within tolerance with the best real chance", () => {
  const r = T.build(legs, { target: 3, minOdds: 1.2, maxOdds: 2.2 });
  assert.ok(r && r.odds >= 3 && r.odds <= 3 * 1.15, "odds " + (r && r.odds));
  // brute force over all one-per-game combinations
  let best = 0;
  const games = [...new Set(legs.map(l => l.game))];
  (function rec(i, P, O) { if (i === games.length) { if (O >= 3 && O <= 3.45 && P > best) best = P; return; }
    rec(i + 1, P, O); legs.filter(l => l.game === games[i]).forEach(l => rec(i + 1, P * l.p, O * l.odds)); })(0, 1, 1);
  assert.ok(Math.abs(r.chance - best) < 0.004, `chance ${r.chance} vs best ${best}`);
  assert.equal(new Set(r.legs.map(l => l.game)).size, r.legs.length, "one leg per game");
});
test("tickets: exact leg count and kept legs are respected", () => {
  const r = T.build(legs, { target: 4, exactLegs: 4, minOdds: 1.2, maxOdds: 2.2, tolerance: 1.3 });
  assert.equal(r.legs.length, 4);
  const k = T.build(legs, { target: 4, minOdds: 1.2, maxOdds: 2.2, pinned: ["a2"], tolerance: 1.3 });
  assert.ok(k.legs.some(l => l.id === "a2") && !k.legs.some(l => l.id === "a1"));
});
test("tickets: impossible target returns null", () => {
  assert.equal(T.build(legs, { target: 500, maxLegs: 3, minOdds: 1.2, maxOdds: 2.2 }), null);
});
