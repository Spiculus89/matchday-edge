// Thin client for API-Football v3 (api-sports.io). The key never leaves the server.
// Free plan: 100 requests a day. Every call here costs one request, so the routes that use it
// are cached on the CDN (see lib/ttl.js) and the app checks the remaining quota.

const BASE = process.env.API_FOOTBALL_BASE || "https://v3.football.api-sports.io";

export function plan() {
  return (process.env.API_FOOTBALL_PLAN || "free").toLowerCase();
}

export function timezone() {
  return process.env.APP_TIMEZONE || "Europe/Warsaw";
}

export async function af(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    const e = new Error("API_FOOTBALL_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.");
    e.status = 503; e.code = "no_key"; throw e;
  }
  const url = new URL(path.replace(/^\//, ""), BASE.endsWith("/") ? BASE : BASE + "/");
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { "x-apisports-key": key, accept: "application/json" } });
  const quota = {
    remaining: num(r.headers.get("x-ratelimit-requests-remaining")),
    limit: num(r.headers.get("x-ratelimit-requests-limit"))
  };
  if (r.status === 429) { const e = new Error("API-Football rate limit reached. Data will refresh when the quota resets (00:00 UTC)."); e.status = 429; e.code = "quota"; throw e; }
  if (!r.ok) { const e = new Error(`API-Football HTTP ${r.status} on ${path}`); e.status = 502; e.code = "upstream"; throw e; }
  const body = await r.json();
  // API-Football reports plan and quota problems inside `errors` with HTTP 200
  const errs = body && body.errors;
  const hasErr = errs && (Array.isArray(errs) ? errs.length > 0 : Object.keys(errs).length > 0);
  if (hasErr) {
    const msg = Array.isArray(errs) ? errs.join("; ") : Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join("; ");
    const e = new Error(`API-Football: ${msg}`);
    e.status = /request|limit/i.test(msg) ? 429 : /plan|season|access/i.test(msg) ? 402 : 502;
    e.code = e.status === 429 ? "quota" : e.status === 402 ? "plan" : "upstream";
    throw e;
  }
  return { response: body.response || [], paging: body.paging || null, quota };
}

function num(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }

// Keep the lowest quota reading seen during one function run, to report it to the page.
export function mergeQuota(a, b) {
  if (!a) return b; if (!b) return a;
  return { remaining: minNull(a.remaining, b.remaining), limit: a.limit || b.limit };
}
function minNull(x, y) { if (x == null) return y; if (y == null) return x; return Math.min(x, y); }
