import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import vm from "node:vm";
function load(file, name) { const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync(file, "utf8"), ctx); return ctx.self[name]; }
const B = load("public/engine-basketball.js", "HoopsEngine"), K = load("public/engine-hockey.js", "HockeyEngine");

const nba = { league: "NBA", home: { name: "Boston Celtics", short: "Celtics" }, away: { name: "New York Knicks", short: "Knicks" },
  odds: { ml: [1.5, 2.65], spread: { line: -5.5, h: 1.91, a: 1.91 }, total: { line: 225.5, o: 1.91, u: 1.91 } },
  form: { home: { pf: 116, pa: 109 }, away: { pf: 113, pa: 111 } },
  players: { home: [{ name: "Jayson Tatum", pts: 27, reb: 8, ast: 5, threes: 3.1 }], away: [{ name: "Jalen Brunson", pts: 26, reb: 3.5, ast: 7, threes: 2.6, status: "questionable" }] },
  props: [{ player: "Jayson Tatum", market: "Over 26.5 points", odds: 1.87 }, { player: "Jalen Brunson", market: "Over 25.5 points", odds: 1.87 }] };

test("basketball: market-anchored margin and total", () => {
  const r = B.analyse(nba);
  assert.ok(r.margin > 3.5 && r.margin < 7.5, "margin " + r.margin);
  assert.ok(Math.abs(r.total - 225.5) < 4, "total " + r.total);
  assert.ok(r.markets.home > 0.6 && r.markets.home < 0.72);
  const sp = r.picks.all.filter(x => x.group === "Spread"); assert.equal(sp.length, 2);
  assert.ok(Math.abs(sp[0].p + sp[1].p - 1) < 0.01);
  const br = r.props.find(p => p.player === "Jalen Brunson"); assert.ok(br.p < r.props.find(p => p.player === "Jayson Tatum").p + 0.2);
  r.picks.slip.forEach(s => assert.ok(["Bet", "Lean", "Skip"].includes(s.grade)));
});
test("basketball live: settled at the buzzer, sensible mid-game", () => {
  const fin = B.live(nba, { period: 4, clock: 0, home: 110, away: 104, finished: true });
  assert.equal(fin.markets.home, 1);
  const q3 = B.live(nba, { period: 3, clock: "6:00", home: 70, away: 80 });
  assert.ok(q3.markets.away > 0.6, "away " + q3.markets.away);
  assert.ok(q3.markets.projTotal > 190 && q3.markets.projTotal < 240);
  q3.picks.forEach(p => assert.ok(p.p >= 0.6 && p.p <= 0.9));
});

const nhl = { league: "NHL", home: { name: "Toronto Maple Leafs", short: "Leafs" }, away: { name: "Ottawa Senators", short: "Senators" },
  odds: { ml: [1.65, 2.3], puck: { line: -1.5, h: 2.6, a: 1.5 }, total: { line: 6.5, o: 2.05, u: 1.78 } },
  form: { home: { gf: 3.4, ga: 2.9, sog: 31, games: 15 }, away: { gf: 3.0, ga: 3.2, sog: 28, games: 15 } },
  players: { home: [{ name: "Auston Matthews", pos: "C", gp: 15, g: 9, a: 7, sog: 60 }, { name: "Joseph Woll", pos: "G" }], away: [{ name: "Brady Tkachuk", pos: "LW", gp: 15, g: 7, a: 6, sog: 55 }] },
  props: [{ player: "Auston Matthews", market: "Over 3.5 shots on goal", odds: 1.8 }, { player: "Auston Matthews", market: "Anytime goalscorer", odds: 2.1 }, { player: "Joseph Woll", market: "Over 26.5 saves", odds: 1.85 }] };

test("hockey: fitted to the moneyline and total, OT handled", () => {
  const r = K.analyse(nhl), m = r.markets;
  const pml = K.devig([1.65, 2.3])[0];
  assert.ok(Math.abs(m.home - pml) < 0.05, "ml " + m.home + " vs " + pml);
  assert.ok(Math.abs(m.regHome + m.regDraw + m.regAway - 1) < 1e-6);
  assert.ok(m.ot > 0.15 && m.ot < 0.28, "ot " + m.ot);
  assert.ok(m.puckHome < m.home);
  assert.ok(r.props.length === 3 && r.props.every(p => p.p > 0 && p.p < 1));
});
test("hockey live: empty-net late, settled in OT", () => {
  const late = K.live(nhl, { period: 3, minute: 18, home: 3, away: 2 });
  assert.ok(late.markets.home > 0.8);
  const ot = K.live(nhl, { period: 4, minute: 2, home: 3, away: 3 });
  assert.ok(ot.markets.home > 0.4 && ot.markets.home < 0.6);
});

test("hockey: pulled goalie thins one-goal games and lifts overtime", () => {
  const g = { home: { name: "A" }, away: { name: "B" }, odds: { ml: [1.8, 2.05], total: { line: 6.5, o: 1.95, u: 1.87 } } };
  const r = K.analyse(g), mk = r.markets;
  assert.ok(mk.ot > 0.18 && mk.ot < 0.26, "OT " + mk.ot);
  // the puck line for the favourite stays a minority outcome but well above the plain-Poisson 1-goal-heavy split
  assert.ok(mk.puckHome > 0.3 && mk.puckHome < 0.45, "puckHome " + mk.puckHome);
});

test("basketball: assumed prices never make the best bet", () => {
  const g = JSON.parse(JSON.stringify(nba));
  g.odds = { ml: [1.5, 2.65], spread: { line: -5.5, h: 2.3, a: 1.6 }, total: { line: 225.5, o: 1.91, u: 1.91 }, assumed: ["spread", "total"] };
  const r = B.analyse(g);
  assert.ok(!r.picks.top || r.picks.top.group === "Moneyline");
  r.picks.slip.filter(s => s.assumed).forEach(s => assert.notEqual(s.grade, "Bet"));
  assert.ok(r.picks.all.some(x => x.assumed && x.confidence === "Price unconfirmed"));
});

test("hockey: European game priced on 60-minute markets", () => {
  const g = { league: "KHL", home: { name: "CSKA" }, away: { name: "SKA" }, odds: { book: "Pinnacle via OddsPapi", reg: [2.35, 4.1, 2.75], totalReg: { line: 4.5, o: 1.95, u: 1.87 }, hcpReg: { line: 1.5, h: 1.42, a: 2.9 } } };
  const r = K.analyse(g), mk = r.markets;
  assert.ok(mk.regDraw > 0.2 && mk.regDraw < 0.3, "draw " + mk.regDraw);
  const t = r.picks.all.filter(x => x.group === "Total (60 min)");
  assert.equal(t.length, 2);
  // anchored to the price: the fitted over stays close to the devigged 49%
  assert.ok(Math.abs(t[0].p - 0.49) < 0.04, "over " + t[0].p);
  assert.ok(r.picks.slip.some(s => s.market === "Total (60 min)"));
});
