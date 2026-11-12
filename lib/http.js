// Response helpers. Every API route is cached on Vercel's CDN with s-maxage, so many
// visitors share one upstream call. That is what keeps the app inside free API quotas.

export function sendJson(res, status, body, ttlSeconds) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (status === 200 && ttlSeconds > 0) {
    const swr = Math.max(60, Math.round(ttlSeconds / 2));
    // Browser keeps it briefly; the CDN keeps it for ttl and serves stale while refreshing.
    res.setHeader("Cache-Control", `public, max-age=60, s-maxage=${ttlSeconds}, stale-while-revalidate=${swr}, stale-if-error=86400`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}

export function fail(res, err) {
  const status = err && err.status ? err.status : 500;
  sendJson(res, status, { error: err && err.message ? err.message : String(err), code: err && err.code ? err.code : "error" }, 0);
}

export function query(req) {
  const url = new URL(req.url, "http://local");
  return Object.fromEntries(url.searchParams.entries());
}

export function need(q, keys) {
  for (const k of keys) {
    if (q[k] == null || q[k] === "") {
      const e = new Error(`Missing query parameter: ${k}`);
      e.status = 400; e.code = "bad_request";
      throw e;
    }
  }
}

export function intList(s, max) {
  return String(s || "").split(/[,-]/).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0).slice(0, max || 20);
}
