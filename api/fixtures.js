// GET /api/fixtures?date=YYYY-MM-DD
// The day's most popular matches. One API-Football call, cached for hours.
import { af, timezone } from "../lib/apifootball.js";
import { pickTop } from "../lib/select.js";
import { fixtureSummary } from "../lib/parse.js";
import { ttl, maxMatches } from "../lib/ttl.js";
import { sendJson, fail, query } from "../lib/http.js";

export function todayIn(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function handler(req, res) {
  try {
    const q = query(req);
    const tz = timezone();
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || "") ? q.date : todayIn(tz);
    const { response, quota } = await af("fixtures", { date, timezone: tz });
    const top = pickTop(response, maxMatches());
    sendJson(res, 200, {
      date, timezone: tz, generated: new Date().toISOString(),
      totalFixtures: response.length,
      matches: top.map(fixtureSummary),
      quota
    }, ttl("fixturesOfDay"));
  } catch (e) { fail(res, e); }
}
