// GET /api/debug?token=…&path=odds&fixture=123
// Shows a raw API-Football response so a field mapping can be checked. Disabled unless
// DEBUG_TOKEN is set in Vercel, and each call costs one request from the daily quota.
import { af } from "../lib/apifootball.js";
import { sendJson, fail, query } from "../lib/http.js";

const ALLOWED = /^(fixtures|odds|injuries|teams\/statistics|players\/topscorers|players\/topassists|fixtures\/lineups|odds\/bets|odds\/bookmakers|status)$/;

export default async function handler(req, res) {
  try {
    const q = query(req);
    const tok = process.env.DEBUG_TOKEN;
    if (!tok || q.token !== tok) return sendJson(res, 404, { error: "Not found" }, 0);
    const path = q.path || "status";
    if (!ALLOWED.test(path)) return sendJson(res, 400, { error: "Path not allowed" }, 0);
    const params = { ...q }; delete params.token; delete params.path;
    const r = await af(path, params);
    sendJson(res, 200, r, 0);
  } catch (e) { fail(res, e); }
}
