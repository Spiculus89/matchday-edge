// GET /api/odds?fixture=ID
// Pre-match odds for one fixture: result, goal lines, BTTS, double chance, draw no bet,
// Asian handicap, corners, cards and anytime scorer when the bookmaker offers them.
import { af } from "../lib/apifootball.js";
import { odds } from "../lib/parse.js";
import { ttl } from "../lib/ttl.js";
import { sendJson, fail, query, need } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["fixture"]);
    const params = { fixture: parseInt(q.fixture, 10) };
    if (process.env.ODDS_BOOKMAKER_ID) params.bookmaker = process.env.ODDS_BOOKMAKER_ID;
    const r = await af("odds", params);
    sendJson(res, 200, { fixture: params.fixture, odds: odds(r.response), quota: r.quota, generated: new Date().toISOString() }, ttl("odds"));
  } catch (e) { fail(res, e); }
}
