import test from "node:test";
import assert from "node:assert/strict";
import { scoreFixture, pickTop } from "../lib/select.js";

const f = (id, league, home, away, round) => ({ fixture: { id, date: "2026-11-12T19:45:00Z", status: { short: "NS" } }, league: { id: league.id, name: league.name, country: league.country, round }, teams: { home: { name: home }, away: { name: away } } });
const EPL = { id: 39, name: "Premier League", country: "England" };
const NL = { id: 5, name: "UEFA Nations League", country: "World" };

test("big clubs in big leagues come first", () => {
  const list = [f(1, EPL, "Brentford", "Fulham"), f(2, EPL, "Arsenal", "Liverpool"), f(3, { id: 999, name: "Liga X" }, "A", "B")];
  const top = pickTop(list, 2);
  assert.equal(top[0].fixture.id, 2);
  assert.equal(top.length, 2);
  assert.equal(scoreFixture(list[2]), 0);
});

test("Nations League A beats League C, youth and women's games are dropped", () => {
  assert.ok(scoreFixture(f(1, NL, "England", "Croatia", "League A - 5")) > scoreFixture(f(2, NL, "Armenia", "Cyprus", "League C - 5")));
  assert.equal(scoreFixture(f(3, { id: 38, name: "UEFA U19 Championship" }, "England U19", "Spain U19")), 0);
  assert.equal(scoreFixture(f(4, { id: 44, name: "FA WSL Women" }, "Arsenal W", "Chelsea W")), 0);
});
