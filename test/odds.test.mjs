import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { normalize, findFixture, applyToGame } from "../scripts/odds-lib.mjs";
const MK = JSON.parse(fs.readFileSync("data/odds-cache/markets.json", "utf8"));
const pl = (price, main = true) => ({ players: { 0: { price, active: true, mainLine: main } } });
const fx = { sportId: 11, bookmakerOdds: { pinnacle: { markets: {
  111: { outcomes: { 111: pl(1.51), 112: pl(2.7) } },
  11276: { outcomes: { 11276: pl(1.84, false), 11277: pl(2.02, false) } },
  11278: { outcomes: { 11278: pl(1.925), 11279: pl(1.943) } } } } } };
test("odds: basketball moneyline and main total", () => {
  const o = normalize(fx, "pinnacle", MK, "basketball");
  assert.deepEqual(o.ml, [1.51, 2.7]);
  assert.deepEqual(o.total, { line: 236.5, o: 1.925, u: 1.943 });
});
test("odds: match and merge into a site game, dropping assumed prices", () => {
  const start = new Date(Date.now() + 5 * 3600e3).toISOString();
  const fixtures = [{ sport: "basketball", start, home: "LA Clippers", away: "Utah Jazz", odds: { pinnacle: { ml: [1.5, 2.6], spread: { line: -4.5, h: 1.9, a: 1.95 } }, "admiralbet.ba": { ml: [1.45, 2.65] } } }];
  const g = { id: "uta-lac", start, home: { name: "Los Angeles Clippers" }, away: { name: "Utah Jazz" }, odds: { book: "guess", spread: { line: -5.5, h: 1.909, a: 1.909 }, assumed: ["spread"] } };
  const f = findFixture(g, fixtures); assert.ok(f);
  assert.ok(applyToGame(g, f, "basketball", new Date().toISOString()));
  assert.equal(g.odds.spread.line, -4.5); assert.equal(g.odds.assumed, undefined); assert.deepEqual(g.odds.ml, [1.5, 2.6]);
  assert.equal(g.odds.local.ml[0], 1.45); assert.match(g.odds.book, /Pinnacle/);
});
