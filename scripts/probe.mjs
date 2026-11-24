// Temporary: prints the shape of free player-data endpoints (run from GitHub Actions).
const get = async (u) => { try { const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 matchday-edge probe" }, signal: AbortSignal.timeout(30000) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { status: r.status, t, j }; } catch (e) { return { status: "ERR " + e.message }; } };
const S = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
(async () => {
  for (const [lg, team, who] of [["eng.1", "382", /Haaland/], ["eng.2", null, /./], ["bra.1", null, /./]]) {
    let tid = team;
    if (!tid) { const r = await get(S + lg + "/teams"); tid = r.j.sports[0].leagues[0].teams[0].team.id; }
    const r = await get(`${S}${lg}/teams/${tid}/roster`);
    const A = (r.j && r.j.athletes) || [];
    console.log("roster", lg, tid, r.status, A.length, "season", JSON.stringify(r.j && r.j.season));
    const a = A.find((x) => who.test(x.displayName)) || A[0];
    if (!a) continue;
    console.log(" athlete", a.id, a.displayName, "pos", JSON.stringify(a.position).slice(0, 150), "status", JSON.stringify(a.status));
    console.log(" statistics", JSON.stringify(a.statistics).slice(0, 2500));
    const inj = A.filter((x) => x.injuries && x.injuries.length);
    console.log(" injured", inj.length, inj[0] && JSON.stringify({ n: inj[0].displayName, i: inj[0].injuries, s: inj[0].status }).slice(0, 700));
    const st = await get(`https://sports.core.api.espn.com/v2/sports/soccer/leagues/${lg}/seasons/2026/types/1/athletes/${a.id}/statistics`);
    const cats = st.j && st.j.splits && st.j.splits.categories;
    const pick = {}; (cats || []).forEach((c) => c.stats.forEach((s) => { if (/^(minutes|starts|appearances|subIns|totalShots|shotsOnTarget|totalGoals|goalAssists|foulsCommitted|totalTackles|effectiveTackles|penaltyKickShots|yellowCards)$/.test(s.name)) pick[s.name] = s.value; }));
    console.log(" core stats", st.status, JSON.stringify(pick));
  }
})();
