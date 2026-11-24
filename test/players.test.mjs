import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { teamsFromList, findEspnTeam, parseRoster, parseStats, posOf, sideFromTeam } from "../scripts/players-lib.mjs";

const ctx = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../public/engine.js", import.meta.url), "utf8"), ctx);
const E = ctx.self.BetEngine;

// shaped like ESPN's stats API: splits.categories[].stats[]
const stats = (o) => ({ splits: { categories: [{ name: "general", stats: Object.entries(o).map(([name, value]) => ({ name, value })) }] } });
const line = (minutes, starts, apps, shots, sot, goals, assists, fouls, tackles, pk = 0) =>
  parseStats(stats({ minutes, starts, appearances: apps, subIns: apps - starts, totalShots: shots, shotsOnTarget: sot, totalGoals: goals, goalAssists: assists, foulsCommitted: fouls, totalTackles: tackles, penaltyKickShots: pk }));

const team = { players: [
  { name: "Erling Haaland", pos: "FW", status: null, stats: line(980, 11, 11, 42, 19, 9, 0, 7, 1, 2) },
  { name: "Rodri", pos: "MF", status: null, stats: line(900, 10, 11, 10, 3, 1, 2, 12, 25) },
  { name: "Phil Foden", pos: "MF", status: "Out", stats: line(500, 6, 8, 15, 6, 2, 3, 4, 5) },
  { name: "Bench Kid", pos: "DF", status: null, stats: line(90, 0, 3, 0, 0, 0, 0, 1, 2) },
  { name: "Not Played", pos: "DF", status: null, stats: line(0, 0, 0, 0, 0, 0, 0, 0, 0) }
] };

test("roster and season lines parse", () => {
  const r = parseRoster({ athletes: [{ id: 1, displayName: "A B", position: { abbreviation: "F" }, status: { type: "active" }, injuries: [] },
    { id: 2, displayName: "C D", position: { abbreviation: "D" }, injuries: [{ status: "Out" }] }] });
  assert.deepEqual(r, [{ id: "1", name: "A B", pos: "FW", status: null }, { id: "2", name: "C D", pos: "DF", status: "Out" }]);
  assert.equal(team.players[0].stats.shots, 42); assert.equal(team.players[0].stats.tackles, 1);
  assert.deepEqual(["G", "D", "M", "F", "AM"].map((a) => posOf({ abbreviation: a })), ["GK", "DF", "MF", "FW", "AM"]);
});

test("a side's list: per-90 rates, starts from the season, injured players out", () => {
  const s = sideFromTeam(team, null);
  const h = s.players.find((p) => p.name === "Erling Haaland");
  assert.equal(h.shots90, Math.round(42 / 980 * 90 * 100) / 100); assert.equal(h.pens, true);
  assert.ok(h.start > 0.85 && h.start <= 0.9);
  assert.ok(!s.players.some((p) => p.name === "Phil Foden" || p.name === "Not Played"));
  assert.deepEqual(s.totals, { shots: 67, goals: 12, assists: 5 });
  assert.equal(s.players.find((p) => p.name === "Bench Kid"), undefined); // 0 starts, no goals: left out
});

test("a lineup sets who starts", () => {
  const xi = ["E. Haaland", "Bench Kid", ...Array.from({ length: 9 }, (_, i) => "X Y" + i)];
  const s = sideFromTeam(team, { xi, confirmed: true });
  assert.equal(s.players.find((p) => p.name === "Erling Haaland").start, 1);
  assert.equal(s.players.find((p) => p.name === "Bench Kid").start, 1);
  assert.equal(s.players.find((p) => p.name === "Rodri").start, 0.12); // benched, kept for his goals and assists
});

test("site teams find ESPN teams", () => {
  const list = teamsFromList({ sports: [{ leagues: [{ teams: [{ team: { id: 382, displayName: "Manchester City", shortDisplayName: "Man City", name: "City", location: "Manchester" } },
    { team: { id: 364, displayName: "Liverpool", shortDisplayName: "Liverpool", name: "Liverpool", location: "Liverpool" } }] }] }] }, "eng.1")
    .concat(teamsFromList({ sports: [{ leagues: [{ teams: [{ team: { id: 9, displayName: "Liverpool Montevideo", shortDisplayName: "Liverpool" } }] }] }] }, "uru.1"));
  assert.equal(findEspnTeam({ name: "Manchester City", short: "Man City" }, list, null).id, "382");
  assert.equal(findEspnTeam({ name: "Liverpool FC", short: "Liverpool" }, list, "eng.1").id, "364");
  assert.equal(findEspnTeam({ name: "Liverpool Montevideo", short: "Liverpool" }, list, "uru.1").id, "9");
  assert.equal(findEspnTeam({ name: "Slovan Bratislava" }, list, null), null);
});

test("the engine turns the list into scorers and expected shots, on target and tackles", () => {
  const s = sideFromTeam(team, null);
  const m = { id: "t", home: { name: "City" }, away: { name: "Away" }, odds: { h: 1.4, d: 5, a: 8, ou: { "2.5": [1.6, 2.4] } },
    players: { home: s.players, away: [] }, teamTotals: { home: s.totals }, lineups: { status: "pending", home: { xi: [] }, away: { xi: [] } }, news: [] };
  const r = E.analyse(m), h = r.players.find((p) => p.name === "Erling Haaland"), d = r.players.find((p) => p.name === "Rodri");
  assert.ok(h.scorer > d.scorer && h.scorer < 0.8);
  assert.ok(h.exp.shots > 2 && h.exp.sot > h.exp.shots * 0.3 && h.exp.sot < h.exp.shots);
  assert.ok(d.exp.tackles > h.exp.tackles && d.p1tackle > 0.5);
  assert.ok(h.p1sot > 0.5 && h.p1sot < 0.99 && h.perNinety);
});
