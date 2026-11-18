// Fetch odds from OddsPapi (free tier: ~200-250 requests a month) inside GitHub Actions.
// The key lives in the ODDSPAPI_KEY repository secret and never reaches the site.
// Usage: node scripts/fetch-odds.mjs discover|fetch
import fs from "node:fs";
const KEY = process.env.ODDSPAPI_KEY, BASE = "https://api.oddspapi.io/v4", DIR = "public/data/odds";
const CAP = 190; // stay under the smaller published free allowance (200)
if (!KEY) { console.error("ODDSPAPI_KEY secret missing"); process.exit(1); }
fs.mkdirSync(DIR, { recursive: true });
const month = new Date().toISOString().slice(0, 7);
const usageFile = DIR + "/usage.json";
let usage = fs.existsSync(usageFile) ? JSON.parse(fs.readFileSync(usageFile, "utf8")) : {};
if (usage.month !== month) usage = { month, used: 0, log: [] };
function save(name, data) { fs.writeFileSync(DIR + "/" + name, JSON.stringify(data, null, 1) + "\n"); }
async function get(path, params = {}) {
  if (usage.used >= CAP) throw new Error("monthly cap reached (" + usage.used + ")");
  const u = new URL(BASE + path); Object.entries({ ...params, apiKey: KEY }).forEach(([k, v]) => u.searchParams.set(k, v));
  await new Promise(res => setTimeout(res, 1300)); // OddsPapi allows about one call a second per endpoint
  let r = await fetch(u); usage.used++;
  if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise(res => setTimeout(res, ((j.error && j.error.retryMs) || 1500) + 300)); r = await fetch(u); usage.used++; }
  const hdr = {}; r.headers.forEach((v, k) => { if (/limit|remain|quota|credit/i.test(k)) hdr[k] = v; });
  usage.log.push({ t: new Date().toISOString(), path, status: r.status, hdr });
  usage.log = usage.log.slice(-60); save("usage.json", usage);
  const text = await r.text();
  if (!r.ok) throw new Error(path + " " + r.status + " " + text.slice(0, 300));
  return JSON.parse(text);
}
const mode = process.argv[2] || "fetch";
if (mode === "discover") {
  const out = { at: new Date().toISOString() };
  const sports = await get("/sports"); out.sports = sports;
  const books = await get("/bookmakers");
  const list = Array.isArray(books) ? books : books.bookmakers || Object.values(books);
  out.bookmakerCount = list.length;
  out.bookmakers = list.filter(b => /meridian|pinnacle|mozzart|admiral|bet365/i.test(JSON.stringify(b)));
  out.bookmakerSample = list.slice(0, 3);
  const sl = Array.isArray(sports) ? sports : sports.sports || [];
  const want = { soccer: /^(soccer|football)$/i, basketball: /^basketball$/i, hockey: /^ice ?hockey$/i };
  out.tournaments = {};
  for (const [k, re] of Object.entries(want)) {
    const s = sl.find(x => re.test(x.sportName || x.name || x.slug || ""));
    if (!s) continue;
    const t = await get("/tournaments", { sportId: s.sportId ?? s.id });
    const tl = Array.isArray(t) ? t : t.tournaments || [];
    out.tournaments[k] = { sportId: s.sportId ?? s.id, count: tl.length, sample: tl.slice(0, 2),
      picked: tl.filter(x => /NBA|NHL|Euroleague|Premier League|LaLiga|Serie A|Bundesliga|Ligue 1|Champions League|Europa League|World Cup|Nations League|Friendl/i.test(JSON.stringify(x))).slice(0, 60) };
  }
  save("discover.json", out);
  console.log("discover ok, requests used this month:", usage.used);
}
if (mode === "probe") {
  const out = {};
  for (const b of ["pinnacle", "admiralbet.ba"]) {
    try { const r = await get("/odds-by-tournaments", { bookmaker: b, tournamentIds: "132,234" });
      const arr = Array.isArray(r) ? r : Object.values(r);
      out[b] = { type: Array.isArray(r) ? "array" : typeof r, n: arr.length, first: JSON.stringify(arr[0]).slice(0, 6000), keys: Object.keys(arr[0] || {}) };
    } catch (e) { out[b] = { error: String(e.message) }; }
  }
  save("probe.json", out); console.log("probe ok", usage.used);
}
if (mode === "setup") {
  const out = {};
  try { const m = await get("/markets"); const arr = Array.isArray(m) ? m : Object.values(m);
    out.marketsN = arr.length; out.marketsSample = arr.slice(0, 5);
    const keep = arr.filter(x => [10, 11, 15].includes(x.sportId) || x.sportId == null);
    save("markets.json", keep);
  } catch (e) { out.markets = String(e.message); }
  const parts = fs.existsSync(DIR + "/participants.json") ? JSON.parse(fs.readFileSync(DIR + "/participants.json", "utf8")) : {};
  for (const sid of [11, 15, 10]) {
    try { const p = await get("/participants", { sportId: sid });
      const arr = Array.isArray(p) ? p : Object.entries(p).map(([k, v]) => (typeof v === "object" ? { participantId: +k, ...v } : { participantId: +k, participantName: v }));
      out["p" + sid] = { n: arr.length, sample: arr.slice(0, 3) };
      arr.forEach(x => { const id = x.participantId ?? x.id; parts[id] = x.participantName || x.name || x.shortName; });
    } catch (e) { out["p" + sid] = String(e.message); }
  }
  save("participants.json", parts); save("setup.json", out); console.log("setup ok", usage.used);
}
