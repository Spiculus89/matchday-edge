import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { leagueSlug, matchEvent, parseSummary, settle, settleProp, shownPicks, settleShown, nameScore } from "../scripts/grade-lib.mjs";

const ctx = { self: {} };
vm.runInNewContext(fs.readFileSync(new URL("../public/engine.js", import.meta.url), "utf8"), ctx);
const E = ctx.self.BetEngine;

// Shaped like ESPN's soccer summary JSON
const st = (o) => Object.entries(o).map(([name, v]) => ({ name, displayValue: String(v) }));
const pl = (name, starter, s) => ({ athlete: { displayName: name }, starter, subbedIn: false, stats: st({ appearances: starter ? 1 : 0, ...s }) });
const summary = {
  header: { competitions: [{ status: { type: { name: "STATUS_FULL_TIME", completed: true, state: "post", detail: "FT" } },
    competitors: [{ homeAway: "home", score: "2", team: { id: "1" } }, { homeAway: "away", score: "1", team: { id: "2" } }] }] },
  boxscore: { teams: [
    { team: { id: "1" }, statistics: st({ wonCorners: 7, foulsCommitted: 3, yellowCards: 2, redCards: 0, totalShots: 5, shotsOnTarget: 3 }) },
    { team: { id: "2" }, statistics: st({ wonCorners: 3, foulsCommitted: 2, yellowCards: 1, redCards: 0, totalShots: 2, shotsOnTarget: 1 }) }] },
  rosters: [
    { team: { id: "1" }, roster: [pl("Erling Haaland", true, { totalShots: 4, shotsOnTarget: 2, foulsCommitted: 1, totalGoals: 2 }),
      pl("Rodri", true, { totalShots: 1, shotsOnTarget: 1, foulsCommitted: 2, totalGoals: 0 }), pl("Bench Guy", false, {})] },
    { team: { id: "2" }, roster: [pl("Bukayo Saka", true, { totalShots: 2, shotsOnTarget: 1, foulsCommitted: 2, totalGoals: 1 })] }]
};

test("parses score, team stats and player lines that add up", () => {
  const F = parseSummary(summary);
  assert.equal(F.finished, true); assert.equal(F.extra, false);
  assert.deepEqual([F.home, F.away], [2, 1]);
  assert.equal(F.teams.home.corners, 7); assert.equal(F.teams.away.yellow, 1);
  assert.equal(F.ok.home.shots, true); assert.equal(F.ok.away.fouls, true); assert.equal(F.ok.home.goals, true);
  assert.equal(F.players.home.find((p) => p.name === "Bench Guy").played, false);
});

test("settles the page's markets", () => {
  const F = parseSummary(summary), n = { home: "City", away: "Arsenal" };
  assert.equal(settle("City to win", n, F), true);
  assert.equal(settle("Arsenal or draw", n, F), false);
  assert.equal(settle("Over 2.5 goals", n, F), true);
  assert.equal(settle("Under 3.5 goals", n, F), true);
  assert.equal(settle("Both teams to score", n, F), true);
  assert.equal(settle("Both teams to score: No", n, F), false);
  assert.equal(settle("Over 9.5 corners", n, F), true);
  assert.equal(settle("Most corners: City", n, F), true);
  assert.equal(settle("Under 4.5 cards", n, F), true);
  assert.equal(settle("City -1 (Asian handicap)", n, F), "void");
  assert.equal(settle("Arsenal +1.5 (Asian handicap)", n, F), true);
  assert.equal(settle("City -0.75 (Asian handicap)", n, F), null);
  assert.equal(settle("Over 3 goals", n, F), "void");
  assert.equal(settle("Erling Haaland to score", n, F), true);
  assert.equal(settle("Someone Else to win", n, F), null);
});

test("draw no bet voids on a draw, cards near the line with a red stay open", () => {
  const s = JSON.parse(JSON.stringify(summary));
  s.header.competitions[0].competitors[1].score = "2";
  s.boxscore.teams[1].statistics = st({ wonCorners: 3, foulsCommitted: 2, yellowCards: 3, redCards: 1, totalShots: 2, shotsOnTarget: 1 });
  const F = parseSummary(s), n = { home: "City", away: "Arsenal" };
  assert.equal(settle("City draw no bet", n, F), "void");
  assert.equal(settle("Over 5.5 cards", n, F), null);
  assert.deepEqual(settleShown({ sel: ["City draw no bet"] }, n, F), { won: false, void: true });
});

test("props need a full stat line and a player who played", () => {
  const F = parseSummary(summary);
  assert.equal(settleProp("Erling Haaland", "2+ shots on target", F), true);
  assert.equal(settleProp("E. Haaland", "5+ shots", F), false);
  assert.equal(settleProp("Bukayo Saka", "1+ tackles", F), null);
  assert.equal(settleProp("Bench Guy", "1+ shots", F), null);
  const bad = JSON.parse(JSON.stringify(summary)); bad.boxscore.teams[0].statistics[4].displayValue = "9";
  assert.equal(settleProp("Erling Haaland", "2+ shots", parseSummary(bad)), null);
});

test("extra time and unfinished games are flagged", () => {
  const s = JSON.parse(JSON.stringify(summary));
  s.header.competitions[0].status.type = { name: "STATUS_FINAL_AET", completed: true, state: "post", detail: "AET" };
  assert.equal(parseSummary(s).extra, true);
  s.header.competitions[0].status.type = { name: "STATUS_SCHEDULED", completed: false, state: "pre" };
  assert.equal(parseSummary(s).finished, false);
});

test("finds the ESPN event by kick-off and team names", () => {
  const ev = (id, date, h, a) => ({ id, date, competitions: [{ competitors: [
    { homeAway: "home", team: { displayName: h, shortDisplayName: h } }, { homeAway: "away", team: { displayName: a, shortDisplayName: a } }] }] });
  const evs = [ev("1", "2026-11-24T17:45Z", "Bodo/Glimt", "LASK Linz"), ev("2", "2026-11-24T20:00Z", "Manchester City", "Napoli"), ev("3", "2026-11-24T20:00Z", "Arsenal", "Borussia Dortmund")];
  const m = (h, hs, a, as) => ({ kickoff: "2026-11-24T20:00:00.000Z", home: { name: h, short: hs }, away: { name: a, short: as } });
  assert.equal(matchEvent(m("Manchester City", "Man City", "SSC Napoli", "Napoli"), evs).id, "2");
  assert.equal(matchEvent(m("Arsenal FC", "Arsenal", "Borussia Dortmund", "Dortmund"), evs).id, "3");
  assert.equal(matchEvent({ ...m("Bodoe/Glimt", "Bodø/Glimt", "LASK", "LASK"), kickoff: "2026-11-24T17:45:00.000Z" }, evs).id, "1");
  assert.equal(matchEvent(m("Real Madrid", "Real Madrid", "PSV Eindhoven", "PSV"), evs), null);
  assert.ok(nameScore("Wolverhampton Wanderers", ["Wolves", "Wolverhampton Wanderers"]) === 1);
});

test("league slugs for the site's competitions", () => {
  assert.equal(leagueSlug("UEFA Champions League, league phase matchday 5"), "uefa.champions");
  assert.equal(leagueSlug("Championship (England)"), "eng.2");
  assert.equal(leagueSlug("Premier League (England)"), "eng.1");
  assert.equal(leagueSlug("Brasileiro Serie A (Brazil)"), "bra.1");
  assert.equal(leagueSlug("Serie A (Italy)"), "ita.1");
  assert.equal(leagueSlug("Super Lig (Turkiye)"), "tur.1");
  assert.equal(leagueSlug("Uruguayan Primera División (Uruguay)"), "uru.1");
  assert.equal(leagueSlug("LaLiga (Spain)"), "esp.1");
});

test("the picks the page showed come out in the track-record format", () => {
  const match = { id: "t", home: { name: "Home FC", short: "Home" }, away: { name: "Away FC", short: "Away" },
    odds: { h: 1.5, d: 4.4, a: 6.5, ou: { "2.5": [1.7, 2.15] }, btts: [1.9, 1.9] },
    form20: { home: { gf: 2.2, ga: 0.8 }, away: { gf: 0.9, ga: 1.8 } }, lineups: { status: "pending", home: { xi: [] }, away: { xi: [] } }, news: [] };
  const r = E.analyse(match), picks = shownPicks(r);
  assert.ok(picks.length > 0);
  const groups = ["Result", "Handicap", "Goals", "BTTS", "Scorer", "Corners", "Most corners", "Cards", "Bet builder", "Player prop"];
  picks.forEach((x) => { assert.ok(groups.includes(x.group), x.group); assert.ok(x.p > 0 && x.p < 1); });
  const F = parseSummary(summary), n = { home: "Home", away: "Away" };
  picks.forEach((x) => { const s = settleShown(x, n, F); if (s) assert.equal(typeof s.won, "boolean"); });
  if (r.picks.builder) assert.equal(picks.find((x) => x.group === "Bet builder").pick, r.picks.builder.legs.join(" + "));
});
