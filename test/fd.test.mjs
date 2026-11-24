import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, toGames, buildTeams, buildReferees, findTeam, attach, divFor, seasonCode } from "../scripts/fd-lib.mjs";

// main-league layout, a few columns of the real header
const head = "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,Referee,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR";
const rows = [];
const teams = ["Man City", "Arsenal", "Wolves", "QPR", "Inter", "Milan"];
let day = 1;
for (let round = 0; round < 5; round++) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
  if (i === j || (i + j + round) % 3) continue;
  const d = String((day++ % 27) + 1).padStart(2, "0"), mo = String(8 + (round % 4)).padStart(2, "0");
  rows.push(`E0,${d}/${mo}/2026,15:00,${teams[i]},${teams[j]},${i % 3},${j % 2},X,${round % 2 ? "M Oliver" : "A Taylor"},12,9,5,3,10,12,${6 + (i % 3)},${3 + (j % 2)},2,1,0,${round === 1 ? 1 : 0}`);
}
const csv = "﻿" + head + "\n" + rows.join("\n") + "\n";
const games = toGames(parseCsv(csv), "E0");

test("CSV rows become games and team rates", () => {
  assert.ok(games.length > 30);
  assert.deepEqual(Object.keys(games[0]).slice(0, 4), ["div", "date", "home", "away"]);
  const T = buildTeams(games, "2026-12-31", "2026-07-01");
  assert.ok(T["Man City"].n >= 8 && T["Man City"].n <= 20);
  assert.ok(T["Man City"].corners.cf > 0 && T["Man City"].fouls != null);
  assert.equal(T.Arsenal.cur.n, T.Arsenal.n);
  const R = buildReferees(games);
  assert.ok(R["M Oliver"].games > 0 && R["M Oliver"].yellowsPg === 3);
});

test("the extra-league layout parses too", () => {
  const g = toGames(parseCsv("Country,League,Season,Date,Time,Home,Away,HG,AG,Res\nBrazil,Serie A,2026,22/11/2026,21:00,Botafogo RJ,Sao Paulo,1,1,D\n"), "BRA");
  assert.deepEqual([g[0].home, g[0].hg, g[0].date, g[0].div], ["Botafogo RJ", 1, "2026-11-22", "BRA"]);
});

test("site names find football-data's short names", () => {
  const T = { "Man City": { div: "E0" }, "Man United": { div: "E0" }, Wolves: { div: "E1" }, QPR: { div: "E1" }, Inter: { div: "I1" }, Milan: { div: "I1" },
    "Bristol City": { div: "E1" }, "Bristol Rvs": { div: "E3" }, "Botafogo RJ": { div: "BRA" }, "Atletico-MG": { div: "BRA" }, "Ath Madrid": { div: "SP1" }, Betis: { div: "SP1" }, "Real Madrid": { div: "SP1" } };
  const f = (name, short, div) => findTeam({ name, short }, T, div);
  assert.equal(f("Manchester City", "Man City", "E0"), "Man City");
  assert.equal(f("Manchester United", "Man Utd", "E0"), "Man United");
  assert.equal(f("Wolverhampton Wanderers", "Wolves", "E1"), "Wolves");
  assert.equal(f("Queens Park Rangers", "QPR", "E1"), "QPR");
  assert.equal(f("Inter Milan", "Inter", "I1"), "Inter");
  assert.equal(f("AC Milan", "Milan", "I1"), "Milan");
  assert.equal(f("Bristol City", "Bristol City", "E1"), "Bristol City");
  assert.equal(f("Botafogo FR RJ", "Botafogo FR", "BRA"), "Botafogo RJ");
  assert.equal(f("Atletico Mineiro MG", "Atletico MG", "BRA"), "Atletico-MG");
  assert.equal(f("Real Betis", "Betis", null), "Betis");
  assert.equal(f("Real Madrid", "Real Madrid", null), "Real Madrid");
  assert.equal(f("Slovan Bratislava", "Slovan", null), null);
});

test("attach fills only what's missing and never overwrites research data", () => {
  const T = buildTeams(games, "2026-12-31", "2026-07-01"), refs = buildReferees(games);
  const m = { competition: "Premier League (England)", home: { name: "Manchester City", short: "Man City" }, away: { name: "Arsenal FC", short: "Arsenal" },
    context: "Priced from Pinnacle's odds only (automatic fallback: the research run hasn't added form, team news or lineups yet).", referee: { name: "Michael Oliver" } };
  const added = attach(m, { teams: T, refs });
  assert.ok(added.includes("form") && added.includes("corners") && added.includes("cards") && added.includes("referee"));
  assert.equal(m.form20.home.gf, T["Man City"].gf);
  assert.ok(m.season.home.corners > 0 && m.season.home.gf != null && m.teamStats.away.yellowsPg != null);
  assert.ok(m.referee.games > 0 && /football-data/.test(m.referee.note));
  assert.ok(/football-data/.test(m.context) && m.sources.length === 1);
  const kept = { competition: "UEFA Champions League", home: { name: "Manchester City" }, away: { name: "Arsenal" }, form20: { home: { gf: 9, ga: 9 }, away: { gf: 9, ga: 9 } }, season: { home: { corners: 1 }, away: { corners: 1 } } };
  attach(kept, { teams: T, refs });
  assert.equal(kept.form20.home.gf, 9); assert.equal(kept.season.home.corners, 1); assert.equal(kept.season.home.gf, undefined);
  assert.deepEqual(attach(kept, { teams: T, refs }), ["cards"].filter(() => false));
});

test("competition and season codes", () => {
  assert.equal(divFor("Championship (England)"), "E1");
  assert.equal(divFor("Brasileiro Serie A (Brazil)"), "BRA");
  assert.equal(divFor("Serie A (Italy)"), "I1");
  assert.equal(divFor("UEFA Champions League, league phase matchday 5"), null);
  assert.equal(divFor("Copa del Rey, first round"), null);
  assert.equal(seasonCode(new Date("2026-11-24")), "2627");
  assert.equal(seasonCode(new Date("2027-03-01"), 1), "2526");
});
