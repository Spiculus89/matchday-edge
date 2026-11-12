// GET /api/live?ids=1-2-3
// Status, score, referee, confirmed lineups and injury list for the selected fixtures.
// Two API-Football calls (both batch up to 20 fixtures). Refreshes every 15 minutes from
// 90 minutes before kick-off, otherwise every 2 hours (free plan).
import { af, timezone, mergeQuota } from "../lib/apifootball.js";
import { fixtureSummary, lineups, injuries } from "../lib/parse.js";
import { liveTtl } from "../lib/ttl.js";
import { sendJson, fail, query, need, intList } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["ids"]);
    const ids = intList(q.ids, 20);
    const ihash = ids.join("-");
    const [fx, inj] = await Promise.all([
      af("fixtures", { ids: ihash, timezone: timezone() }),
      af("injuries", { ids: ihash, timezone: timezone() }).catch((e) => ({ response: [], error: e.message }))
    ]);
    const fixtures = fx.response.map((f) => ({
      ...fixtureSummary(f),
      lineups: lineups(f),
      events: (f.events || []).filter((e) => e.type === "Goal" || e.type === "Card").map((e) => ({
        minute: e.time && e.time.elapsed, type: e.type, detail: e.detail, teamId: e.team && e.team.id, player: e.player && e.player.name
      }))
    }));
    sendJson(res, 200, {
      generated: new Date().toISOString(),
      fixtures,
      injuries: injuries(inj.response),
      injuriesError: inj.error || null,
      quota: mergeQuota(fx.quota, inj.quota)
    }, liveTtl(fixtures.map((f) => f.kickoff)));
  } catch (e) { fail(res, e); }
}
