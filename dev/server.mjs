// Local dev server: serves public/ and runs api/*.js the way Vercel does.
//   npm run dev                      → real APIs (needs API_FOOTBALL_KEY in .env.local)
//   npm run dev:mock                 → offline, against dev/mock-upstream.mjs
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (process.env.MOCK === "1") {
  const up = "http://localhost:" + (process.env.MOCK_PORT || 9911);
  process.env.API_FOOTBALL_BASE = up;
  process.env.API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "mock-key";
  process.env.OPEN_METEO_BASE = up; process.env.OPEN_METEO_GEO_BASE = up;
  process.env.NEWS_RSS_BASE = up + "/rss/search";
}
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css" };
const port = parseInt(process.env.PORT || "3000", 10);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://local");
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z]/g, "");
    const file = path.join(root, "api", name + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("{}"); }
    try {
      const mod = await import(pathToFileURL(file).href);
      await mod.default(req, res);
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
    return;
  }
  let p = path.join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!p.startsWith(path.join(root, "public")) || !fs.existsSync(p)) { res.statusCode = 404; return res.end("Not found"); }
  res.setHeader("Content-Type", types[path.extname(p)] || "application/octet-stream");
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`Matchday Edge on http://localhost:${port}${process.env.MOCK === "1" ? " (mock data)" : ""}`));
