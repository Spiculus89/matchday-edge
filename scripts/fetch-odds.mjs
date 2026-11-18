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
  const r = await fetch(u); usage.used++;
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
