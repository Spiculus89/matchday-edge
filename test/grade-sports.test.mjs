import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import vm from "node:vm";
import { findEvent, parseEvent, settle, shownPicks } from "../scripts/grade-sports.mjs";

const team = (name, side, score, lines, winner) => ({ homeAway: side, score: String(score), winner, team: { displayName: name }, linescores: lines.map((value) => ({ value })) });
const ev = (detail, h, a) => ({ id: "1", status: { type: { completed: true, detail } }, competitions: [{ competitors: [h, a] }] });
const engine = (file, name) => { const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/" + file, "utf8"), ctx); return ctx.self[name]; };

test("NHL shootout: winner gets one goal, regulation stays level", () => {
  const e = ev("Final/SO", team("Edmonton Oilers", "home", 4, [1, 1, 1, 0, 2], true), team("Vegas Golden Knights", "away", 3, [2, 0, 1, 0, 1], false));
  const g = { home: { name: "Edmonton Oilers" }, away: { name: "Vegas Golden Knights" } };
  assert.equal(findEvent(g, [e]), e);
  const F = parseEvent(e, "hockey"), n = { home: "Oilers", away: "Knights" };
  assert.deepEqual([F.home, F.away, F.so, F.reg.home, F.reg.away, F.p1], [4, 3, true, 3, 3, 3]);
  assert.equal(settle("Oilers to win (incl. OT)", "hockey", n, F), true);
  assert.equal(settle("Draw after 60 min", "hockey", n, F), true);
  assert.equal(settle("Knights +1.5", "hockey", n, F), true);
  assert.equal(settle("Over 6.5 goals", "hockey", n, F), true);
  assert.equal(settle("Under 6 goals in 60 min", "hockey", n, F), "void");
  assert.equal(settle("1st period under 1.5", "hockey", n, F), false);
  assert.equal(settle("Oilers over 3.5", "hockey", n, F), true);
});

test("NBA: overtime counts, first half from the quarters", () => {
  const e = ev("Final/OT", team("Los Angeles Lakers", "home", 120, [30, 28, 25, 22, 15], true), team("Sacramento Kings", "away", 112, [25, 25, 30, 25, 7], false));
  const F = parseEvent(e, "basketball"), n = { home: "Lakers", away: "Kings" };
  assert.deepEqual([F.home, F.away, F.h1.home, F.h1.away], [120, 112, 58, 50]);
  assert.equal(settle("Lakers to win", "basketball", n, F), true);
  assert.equal(settle("Kings +7.5", "basketball", n, F), false);
  assert.equal(settle("Lakers -8", "basketball", n, F), "void");
  assert.equal(settle("Over 230.5 points", "basketball", n, F), true);
  assert.equal(settle("1H Lakers -4.5", "basketball", n, F), true);
  assert.equal(settle("1H under 110.5", "basketball", n, F), true);
  assert.equal(settle("Kings over 110.5", "basketball", n, F), true);
});

test("every pick the engines show on a priced file can be settled", () => {
  for (const [sport, file, name, day] of [["hockey", "engine-hockey.js", "HockeyEngine", "2026-11-24"], ["basketball", "engine-basketball.js", "HoopsEngine", "2026-11-21"]]) {
    const E = engine(file, name), g = JSON.parse(fs.readFileSync(`public/data/${sport}/${day}.json`, "utf8")).games.find((x) => x.league === (sport === "hockey" ? "NHL" : "NBA"));
    const n = { home: g.home.short || g.home.name, away: g.away.short || g.away.name };
    const F = sport === "hockey" ? { home: 3, away: 2, goals: { home: 3, away: 2 }, reg: { home: 2, away: 2 }, p1: 1 } : { home: 110, away: 104, h1: { home: 55, away: 50 } };
    const picks = shownPicks(E.analyse(g));
    assert.ok(picks.length > 0, sport + ": no picks");
    for (const x of picks) for (const s of x.sel) assert.notEqual(settle(s, sport, n, F), null, `${sport}: can't settle "${s}"`);
  }
});
