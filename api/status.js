// GET /api/status
// API-Football plan and today's request count. API-Football does not count this call
// against the daily quota.
import { af, plan } from "../lib/apifootball.js";
import { sendJson, fail } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const r = await af("status");
    const s = Array.isArray(r.response) ? r.response[0] || {} : r.response || {};
    sendJson(res, 200, {
      configuredPlan: plan(),
      subscription: s.subscription || null,
      requests: s.requests || null,
      generated: new Date().toISOString()
    }, 300);
  } catch (e) { fail(res, e); }
}
