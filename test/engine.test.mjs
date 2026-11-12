import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ctx = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../public/engine.js", import.meta.url), "utf8"), ctx);
const E = ctx.self.BetEngine;

const base = {
  id: "t", home: { name: "Home" }, away: { name: "Away" },
  odds: { h: 1.8, d: 3.8, a: 4.6, ou: { "2.5": [1.85, 1.95] }, btts: [1.8, 1.95] },
  players: { home: [{ name: "Striker", pos: "FW", start: 1, goals: 6, shots: 30 }], away: [] }
};

test("probabilities add up and match the market closely", () => {
  const r = E.analyse(base);
  const m = r.markets;
  assert.ok(Math.abs(m.home + m.draw + m.away - 1) < 1e-9);
  const book = E.devig([1.8, 3.8, 4.6]).probs;
  assert.ok(Math.abs(m.home - book[0]) < 0.03, "home win stays within 3 points of the margin-free price");
  assert.ok(m.over[0.5] > m.over[1.5] && m.over[1.5] > m.over[2.5]);
});

test("Asian handicap 0 equals draw no bet, -0.5 equals a win", () => {
  const m = E.analyse(base).markets;
  const ah0 = m.ah.find((a) => a.line === 0), ahm = m.ah.find((a) => a.line === -0.5);
  assert.ok(Math.abs(ah0.homeWin - m.home) < 1e-9 && Math.abs(ah0.push - m.draw) < 1e-9);
  assert.ok(Math.abs(ah0.homeFair - 1 / m.dnb.home) < 1e-9);
  assert.ok(Math.abs(ahm.homeWin - m.home) < 1e-9);
});

test("corners and cards follow a bookmaker line when one is given", () => {
  const r = E.analyse({ ...base, odds: { ...base.odds, corners: { "9.5": [1.9, 1.9] }, cards: { "4.5": [1.9, 1.9] } } });
  assert.ok(Math.abs(r.corners.over[9.5] - 0.5) < 0.01);
  assert.ok(Math.abs(r.cards.over[4.5] - 0.5) < 0.01);
  assert.match(r.corners.source, /bookmaker/);
});

test("bad weather lowers expected goals, by at most 15%", () => {
  const dry = E.analyse(base).xg, wet = E.analyse({ ...base, weather: { tempC: 5, precipMm: 6, windKmh: 45, code: 65 } }).xg;
  assert.ok(wet.home < dry.home && wet.home / dry.home >= 0.85);
});

test("a match with no odds still produces a full slip from model-only prices", () => {
  const r = E.analyse({ id: "n", home: { name: "A" }, away: { name: "B" }, odds: {}, players: { home: [], away: [] } });
  const markets = r.picks.slip.map((s) => s.market);
  for (const k of ["Result / handicap", "Total goals", "Both teams to score", "Corners", "Cards"]) assert.ok(markets.includes(k), k);
  assert.equal(r.picks.top, null);
});

test("scorer odds attach by name despite accents", () => {
  const r = E.analyse({ ...base, odds: { ...base.odds, scorers: { "Striker": 2.2 } }, players: { home: [{ name: "Strikér", pos: "FW", start: 1, goals: 6, shots: 30 }], away: [] } });
  assert.equal(r.players[0].scorerOdds, 2.2);
});
