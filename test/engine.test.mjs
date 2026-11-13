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

test("a short-priced market is never the best bet", () => {
  const m = { ...base, odds: { h: 1.5, d: 4.2, a: 6.5, ou: { "2.5": [1.5, 2.5] }, btts: [1.6, 2.2] } };
  const r = E.analyse(m);
  if (r.picks.top) assert.ok(r.picks.top.ev >= -0.02);
  else assert.match(r.picks.noBet, /No bet/);
});

test("props the price can't justify are marked Skip", () => {
  const m = { ...base, players: { home: [{ name: "Winger", pos: "FW", start: 1, shots: 10 }], away: [] }, teamTotals: { home: { shots: 120 } },
    season: { home: { shots: 13 } }, props: [{ player: "Winger", market: "1+ shots on target", odds: 1.3 }, { player: "Winger", market: "1+ shots", odds: 1.6 }] };
  const r = E.analyse(m);
  const sot = r.props.find(p => /target/.test(p.market));
  assert.equal(sot.grade, "Skip");
  assert.ok(sot.p < 0.77);
});

test("live: kick-off matches pre-match, full time is settled", () => {
  const pre = E.analyse(base).markets;
  const k = E.live(base, { minute: 0, home: 0, away: 0 }).markets;
  assert.ok(Math.abs(k.home - pre.home) < 0.06);
  const ft = E.live(base, { minute: 95, home: 2, away: 1, finished: true }).markets;
  assert.ok(ft.home > 0.999);
  const late = E.live(base, { minute: 80, home: 0, away: 1, redAway: 1 });
  assert.ok(late.remainingXg.home > late.remainingXg.away);
  late.picks.forEach(p => assert.ok(p.p >= 0.6 && p.p <= 0.9 && p.takeAt > 1));
});

test("track record nudges a market that keeps missing", () => {
  const before = E.analyse(base).picks.all.filter(x => x.group === "Goals").map(x => Math.abs(x.p - 0.5));
  const legs = Array.from({ length: 40 }, (_, i) => ({ group: "Goals", p: 0.65, won: i % 2 === 0 }));
  E.setCalibration(E.trackStats(legs));
  const after = E.analyse(base).picks.all.filter(x => x.group === "Goals").map(x => Math.abs(x.p - 0.5));
  E.setCalibration({});
  after.forEach((a, i) => assert.ok(a < before[i])); // both sides pulled toward 50/50
});

test("calibInfo reports what the track record is doing to each market", () => {
  const miss = Array.from({ length: 40 }, (_, i) => ({ group: "Goals", p: 0.65, won: i % 2 === 0 }));
  const few = [{ group: "Corners", p: 0.6, won: false }, { group: "Result", p: 0.55, won: true }];
  E.setCalibration(E.trackStats(miss.concat(few)));
  const g = E.calibInfo("Goals"), c = E.calibInfo("Corners"), r = E.calibInfo("Result");
  E.setCalibration({});
  assert.equal(g.state, "trimmed"); assert.ok(g.k < 1 && g.k > 0.4);
  assert.equal(c.state, "collecting"); assert.equal(c.n, 1); assert.equal(c.need, 8);
  assert.equal(r.state, "anchored");
});

test("lessons.json entries have what the site needs", () => {
  const ls = JSON.parse(fs.readFileSync(new URL("../public/data/lessons.json", import.meta.url), "utf8")).lessons;
  assert.ok(ls.length > 0);
  ls.forEach((l) => { assert.match(l.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(l.area && l.saw && l.change); assert.ok(["model", "data"].includes(l.kind)); });
});
