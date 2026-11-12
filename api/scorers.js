// GET /api/scorers?league=39&season=2026
// The competition's top 20 scorers and top 20 assisters with goals, assists, shots and penalties.
import { af, mergeQuota } from "../lib/apifootball.js";
import { scorers } from "../lib/parse.js";
import { ttl } from "../lib/ttl.js";
import { sendJson, fail, query, need } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["league", "season"]);
    const [g, a] = await Promise.all([
      af("players/topscorers", { league: q.league, season: q.season }).catch((e) => ({ response: [], error: e.message })),
      af("players/topassists", { league: q.league, season: q.season }).catch((e) => ({ response: [], error: e.message }))
    ]);
    const byId = new Map();
    for (const p of [...scorers(g.response), ...scorers(a.response)]) if (p.id && !byId.has(p.id)) byId.set(p.id, p);
    sendJson(res, 200, { league: q.league, season: q.season, players: [...byId.values()], quota: mergeQuota(g.quota, a.quota), generated: new Date().toISOString() }, ttl("scorers"));
  } catch (e) { fail(res, e); }
}
