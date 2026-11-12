// GET /api/teams?league=5&season=2026&ids=10,11
// For each team: this season's goals and cards averages in the competition, plus the starting
// XI from its most recent match (the base for the predicted lineup). Cached for a day.
import { af, timezone, mergeQuota } from "../lib/apifootball.js";
import { teamStats, lineupForTeam } from "../lib/parse.js";
import { ttl } from "../lib/ttl.js";
import { sendJson, fail, query, need, intList } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["league", "season", "ids"]);
    const ids = intList(q.ids, 4);
    let quota = null;
    const per = await Promise.all(ids.map(async (team) => {
      const [st, last] = await Promise.all([
        af("teams/statistics", { league: q.league, season: q.season, team }).catch((e) => ({ response: null, error: e.message })),
        af("fixtures", { team, last: 1, timezone: timezone() }).catch((e) => ({ response: [], error: e.message }))
      ]);
      quota = mergeQuota(quota, mergeQuota(st.quota, last.quota));
      return { team, stats: teamStats(st.response), lastFixtureId: last.response[0] && last.response[0].fixture && last.response[0].fixture.id, statsError: st.error || null };
    }));
    const lastIds = per.map((p) => p.lastFixtureId).filter(Boolean);
    let lastFixtures = [];
    if (lastIds.length) {
      const r = await af("fixtures", { ids: [...new Set(lastIds)].join("-"), timezone: timezone() }).catch(() => ({ response: [] }));
      quota = mergeQuota(quota, r.quota);
      lastFixtures = r.response;
    }
    const teams = per.map((p) => {
      const f = lastFixtures.find((x) => x.fixture && x.fixture.id === p.lastFixtureId);
      return { id: p.team, stats: p.stats, statsError: p.statsError, lastLineup: f ? lineupForTeam(f, p.team) : null };
    });
    sendJson(res, 200, { league: q.league, season: q.season, teams, quota, generated: new Date().toISOString() }, ttl("teams"));
  } catch (e) { fail(res, e); }
}
