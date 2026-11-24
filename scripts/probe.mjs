// Temporary: prints the shape of free player-data endpoints (run from GitHub Actions).
const get = async (u, text) => { try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 matchday-edge probe" }, signal: AbortSignal.timeout(30000) }); const t = await r.text(); return { status: r.status, t, j: text ? null : (() => { try { return JSON.parse(t); } catch (e) { return null; } })() }; } catch (e) { return { status: "ERR " + e.message }; } };
const keys = (o) => (o && typeof o === "object" ? Object.keys(o).join(",") : String(o));
const S = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
(async () => {
  let r, evs = [];
  for (const q of ["dates=20261101-20261124", "dates=20261101-20261124&limit=100", "dates=202611", "dates=20261122"]) {
    r = await get(S + "eng.1/scoreboard?" + q);
    const e = (r.j && r.j.events) || [];
    console.log("1 scoreboard", q, r.status, "events", e.length, e[0] && e[0].date, e[e.length - 1] && e[e.length - 1].date, r.status !== 200 ? (r.t || "").slice(0, 200) : "");
    if (e.length > evs.length) evs = e;
  }
  const fin = evs.filter((e) => e.status && e.status.type && e.status.type.completed);
  const ev = fin[fin.length - 1];
  if (ev) {
    r = await get(S + "eng.1/summary?event=" + ev.id);
    const ros = r.j && r.j.rosters && r.j.rosters[0];
    console.log("2 summary keys", keys(r.j));
    if (ros) { const p = ros.roster[0], s = ros.roster.find((x) => x.subbedIn) || ros.roster[13];
      console.log("2 roster entry keys", keys(p)); console.log("2 starter", JSON.stringify({ ...p, stats: undefined, athlete: p.athlete && { id: p.athlete.id, displayName: p.athlete.displayName } }).slice(0, 600));
      console.log("2 stats names", (p.stats || []).map((x) => x.name + "=" + x.value).join(" "));
      console.log("2 sub", JSON.stringify({ ...s, stats: undefined, athlete: s && s.athlete && s.athlete.displayName }).slice(0, 600)); }
    const ke = (r.j && r.j.keyEvents) || [];
    const sub = ke.find((k) => /sub/i.test((k.type && k.type.text) || ""));
    console.log("2 keyEvents", ke.length, [...new Set(ke.map((k) => k.type && k.type.text))].join("|"));
    console.log("2 sub event", JSON.stringify(sub).slice(0, 700));
    const bt = r.j && r.j.boxscore && r.j.boxscore.teams && r.j.boxscore.teams[0];
    console.log("2 team stats", bt && bt.statistics.map((x) => x.name).join(","));
    const tid = ros && ros.team && ros.team.id, aid = ros && ros.roster[0].athlete.id;
    r = await get(S + `eng.1/teams/${tid}/roster`);
    const a = r.j && r.j.athletes && r.j.athletes[0];
    console.log("3 team roster", r.status, keys(r.j), "athlete keys", keys(a));
    if (a) console.log("3 athlete sample", JSON.stringify(a).slice(0, 900));
    for (const u of [`https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/seasons/2026/types/1/athletes/${aid}/statistics`,
      `https://site.web.api.espn.com/apis/common/v3/sports/soccer/eng.1/athletes/${aid}/stats`,
      `https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/${aid}/stats?season=2026`]) {
      r = await get(u);
      const cats = r.j && r.j.splits && r.j.splits.categories;
      console.log("4", u.slice(8, 70), r.status, keys(r.j), cats ? cats.map((c) => c.name + ":" + (c.stats || []).map((s) => s.name).join("/")).join(" ").slice(0, 1500) : (r.t || "").slice(0, 400));
    }
  }
  r = await get(S + "eng.1/teams");
  const tm = r.j && r.j.sports && r.j.sports[0].leagues[0].teams;
  console.log("7 teams", r.status, tm && tm.length, tm && JSON.stringify(tm[0].team).slice(0, 300));
  return;
  r = await get("https://fantasy.premierleague.com/api/bootstrap-static/");
  const el = r.j && r.j.elements;
  console.log("5 fpl", r.status, el && el.length, el && keys(el[0]));
  if (el) { const h = el.find((x) => /Haaland/.test(x.web_name)) || el[0]; console.log("5 sample", JSON.stringify(h).slice(0, 1500)); }
  for (const u of ["https://understat.com/league/EPL/2026", "https://understat.com/getLeagueData/EPL/2026"]) {
    r = await get(u, true);
    console.log("6", u, r.status, (r.t || "").length, /playersData/.test(r.t || ""), (r.t || "").slice(0, 300).replace(/\s+/g, " "));
  }
})();
