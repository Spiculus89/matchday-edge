// Runs every API route against the offline mock of API-Football, Open-Meteo and Google News.
import test from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_PORT = "9933";
const up = "http://localhost:9933";
Object.assign(process.env, {
  API_FOOTBALL_KEY: "test", API_FOOTBALL_BASE: up, OPEN_METEO_BASE: up, OPEN_METEO_GEO_BASE: up, NEWS_RSS_BASE: up + "/rss/search", APP_TIMEZONE: "UTC"
});
const mock = (await import("../dev/mock-upstream.mjs")).default;

function call(handler, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = { statusCode: 200, setHeader: (k, v) => { headers[k.toLowerCase()] = v; }, end: (body) => resolve({ status: res.statusCode, headers, body: JSON.parse(body) }) };
    Promise.resolve(handler({ url }, res)).catch(reject);
  });
}
const route = async (name) => (await import(`../api/${name}.js`)).default;

test.after(() => mock.close());

test("fixtures: picks the big games, skips youth football, caches for hours", async () => {
  const r = await call(await route("fixtures"), "/api/fixtures");
  assert.equal(r.status, 200);
  const names = r.body.matches.map((m) => m.home.name + " v " + m.away.name);
  assert.ok(names.includes("England v Croatia"));
  assert.ok(!names.some((n) => /U19/.test(n)));
  assert.ok(r.body.matches.length <= 5);
  assert.match(r.headers["cache-control"], /s-maxage=21600/);
});

test("live: confirmed lineups and injuries", async () => {
  const r = await call(await route("live"), "/api/live?ids=9001-9002");
  const tur = r.body.fixtures.find((f) => f.fixtureId === 9001);
  assert.equal(tur.lineups.home.xi.length, 11);
  assert.equal(r.body.fixtures.find((f) => f.fixtureId === 9002).lineups, null);
  assert.ok(r.body.injuries.some((i) => i.player.name === "Kenan Yıldız" && i.type === "Missing Fixture"));
  assert.equal(r.body.quota.remaining, 57);
});

test("odds: maps every market the bookmaker offers", async () => {
  const r = await call(await route("odds"), "/api/odds?fixture=9003");
  const o = r.body.odds;
  assert.deepEqual([o.h, o.d, o.a], [1.22, 7, 11]);
  assert.deepEqual(o.ou["2.5"], [1.44, 2.7]);
  assert.deepEqual(o.btts, [1.83, 1.83]);
  assert.equal(o.dnb.home, 1.08);
  assert.ok(o.ah.find((x) => x.line === -1.5 && x.home === 1.95 && x.away === 1.85));
  assert.deepEqual(o.corners["9.5"], [1.95, 1.8]);
  assert.equal(o.scorers["Harry Kane"], 1.65);
});

test("teams: season averages and last starting XI", async () => {
  const r = await call(await route("teams"), "/api/teams?league=5&season=2026&ids=768,2");
  const ita = r.body.teams.find((t) => t.id === 768);
  assert.equal(ita.stats.gf, 2);
  assert.equal(ita.lastLineup.xi.length, 11);
  assert.ok(ita.stats.yellowsPg > 0);
});

test("weather: picks the kick-off hour", async () => {
  const r = await call(await route("weather"), "/api/weather?city=London&time=2026-11-12T19:45:00Z");
  assert.equal(r.body.found, true);
  assert.equal(r.body.precipMm, 4.5);
  assert.equal(r.body.desc, "Rain");
});

test("news: tags injury headlines and puts them first", async () => {
  const r = await call(await route("news"), "/api/news?team=France&national=1");
  assert.equal(r.body.items[0].tag, "out");
  assert.ok(r.body.items.some((i) => i.tag === "doubt"));
  assert.ok(r.body.items.every((i) => !/ - L'Équipe$/.test(i.title)), "source suffix removed");
  const be = await call(await route("news"), "/api/news?team=Belgium&national=1");
  assert.equal(be.body.items.find((i) => /back from suspension/.test(i.title)).tag, "back");
});

test("missing key gives a clear setup error, not a crash", async () => {
  const k = process.env.API_FOOTBALL_KEY; delete process.env.API_FOOTBALL_KEY;
  const r = await call(await route("fixtures"), "/api/fixtures");
  process.env.API_FOOTBALL_KEY = k;
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "no_key");
  assert.match(r.headers["cache-control"], /no-store/);
});
