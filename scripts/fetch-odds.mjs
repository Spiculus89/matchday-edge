// Fetch odds from OddsPapi (free tier: ~200-250 requests a month) inside GitHub Actions.
// The key lives in the ODDSPAPI_KEY repository secret and never reaches the site.
// Usage: node scripts/fetch-odds.mjs discover|fetch
import fs from "node:fs";
import { normalize, findFixture, applyToGame, tournamentFor } from "./odds-lib.mjs";
const CACHE = "data/odds-cache";
const KEY = process.env.ODDSPAPI_KEY, BASE = "https://api.oddspapi.io/v4", DIR = "public/data/odds";
const CAP = 190; // stay under the smaller published free allowance (200)
if (!KEY) { console.error("ODDSPAPI_KEY secret missing"); process.exit(1); }
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
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
  fs.writeFileSync(CACHE + "/discover.json", JSON.stringify(out, null, 1));
  console.log("discover ok, requests used this month:", usage.used);
}
if (mode === "tournaments") {
  const all = {};
  for (const sid of [10, 11, 15]) {
    const t = await get("/tournaments", { sportId: sid });
    all[sid] = (Array.isArray(t) ? t : t.tournaments || []).map(x => [x.tournamentId, x.tournamentName, x.categoryName, (x.upcomingFixtures || 0) + (x.futureFixtures || 0)]);
  }
  fs.writeFileSync(CACHE + "/tournaments.json", JSON.stringify(all)); console.log("tournaments ok", usage.used);
}
if (mode === "setup") {
  const out = {};
  try { const m = await get("/markets"); const arr = Array.isArray(m) ? m : Object.values(m);
    out.marketsN = arr.length; out.marketsSample = arr.slice(0, 5);
    const keep = arr.filter(x => [10, 11, 15].includes(x.sportId) || x.sportId == null);
    const slim = {}; keep.filter(x => !x.playerProp).forEach(x => { slim[x.marketId] = [x.sportId, x.marketType, x.period, x.handicap, Object.fromEntries(x.outcomes.map(o => [o.outcomeId, o.outcomeName]))]; });
    fs.writeFileSync(CACHE + "/markets.json", JSON.stringify(slim));
  } catch (e) { out.markets = String(e.message); }
  const parts = fs.existsSync(CACHE + "/participants.json") ? JSON.parse(fs.readFileSync(CACHE + "/participants.json", "utf8")) : {};
  for (const sid of [11, 15, 10]) {
    try { const p = await get("/participants", { sportId: sid });
      const arr = Array.isArray(p) ? p : Object.entries(p).map(([k, v]) => (typeof v === "object" ? { participantId: +k, ...v } : { participantId: +k, participantName: v }));
      out["p" + sid] = { n: arr.length, sample: arr.slice(0, 3) };
      arr.forEach(x => { const id = x.participantId ?? x.id; parts[id] = x.participantName || x.name || x.shortName; });
    } catch (e) { out["p" + sid] = String(e.message); }
  }
  fs.writeFileSync(CACHE + "/participants.json", JSON.stringify(parts)); fs.writeFileSync(CACHE + "/setup.json", JSON.stringify(out, null, 1)); console.log("setup ok", usage.used);
}

// Tue-Fri European cups, Sat-Mon domestic leagues (Warsaw day)
function watchIds(cfg) { const d = new Date(Date.now() + 3600e3).getUTCDay(); return ((cfg.watch || {})[d >= 2 && d <= 5 ? "weekday" : "weekend"] || []).map(String); }
if (mode === "watch") {
  const cfg = JSON.parse(fs.readFileSync("data/odds-config.json", "utf8"));
  const MK = JSON.parse(fs.readFileSync(CACHE + "/markets.json", "utf8")), PT = JSON.parse(fs.readFileSync(CACHE + "/participants.json", "utf8"));
  const ids = (process.argv[3] || watchIds(cfg).join(",")), now = Date.now();
  const prev = fs.existsSync(DIR + "/latest.json") ? JSON.parse(fs.readFileSync(DIR + "/latest.json", "utf8")) : { fixtures: [] };
  const byId = Object.fromEntries(prev.fixtures.filter(f => Date.parse(f.start) > now - 3 * 3600e3).map(f => [f.id, f]));
  for (const slug of (process.argv[4] || cfg.books.main).split(",")) {
    const list = await get("/odds-by-tournaments", { bookmaker: slug, tournamentIds: ids });
    for (const fx of Array.isArray(list) ? list : []) {
      if (fx.sportId !== 11 || Date.parse(fx.startTime) < now) continue;
      const F = byId[fx.fixtureId] ||= { id: fx.fixtureId, sport: "basketball", tournamentId: fx.tournamentId, start: fx.startTime, home: PT[fx.participant1Id] || String(fx.participant1Id), away: PT[fx.participant2Id] || String(fx.participant2Id), odds: {} };
      F.tournamentId = fx.tournamentId; const o = normalize(fx, slug, MK, "basketball"); if (o) F.odds[slug] = o;
    }
  }
  const all = Object.values(byId).sort((a, b) => a.start.localeCompare(b.start));
  save("latest.json", { ...prev, updatedAt: new Date().toISOString(), fixtures: all });
  console.log("watch ok:", all.filter(f => f.sport === "basketball").length, "basketball fixtures; requests", usage.used);
}
if (mode === "fetch" || mode === "fetch-late") {
  const cfg = JSON.parse(fs.readFileSync("data/odds-config.json", "utf8"));
  const MK = JSON.parse(fs.readFileSync(CACHE + "/markets.json", "utf8")), PT = JSON.parse(fs.readFileSync(CACHE + "/participants.json", "utf8"));
  const SP = { 10: "football", 11: "basketball", 15: "hockey" }, now = Date.now(), at = new Date().toISOString();
  // site files with games still to start: only those sports are fetched, so no request is wasted
  const site = [];
  for (const [sport, dir] of [["football", "public/data/"], ["basketball", "public/data/basketball/"], ["hockey", "public/data/hockey/"]]) {
    if (mode === "fetch-late" && sport === "football") continue;
    const idx = JSON.parse(fs.readFileSync(dir + "index.json", "utf8"));
    const dates = (idx.days || idx.dates || []).map(d => typeof d === "string" ? d : d.date).filter(Boolean).sort().slice(-3);
    for (const d of dates) {
      const f = dir + d + ".json"; if (!fs.existsSync(f)) continue;
      const data = JSON.parse(fs.readFileSync(f, "utf8")), games = data.matches || data.games || [];
      if (games.some(g => !g.result && Date.parse(g.start || g.kickoff || 0) > now)) site.push({ sport, file: f, data, games });
    }
  }
  if (!site.length) { console.log("no upcoming games on the site, nothing fetched"); process.exit(0); }
  const T = fs.existsSync(CACHE + "/tournaments.json") ? JSON.parse(fs.readFileSync(CACHE + "/tournaments.json", "utf8")) : {};
  const SID = { football: 10, basketball: 11, hockey: 15 }, count = {}, noId = [];
  for (const s of site) for (const g of s.games) {
    if (g.result || Date.parse(g.start || g.kickoff || 0) <= now) continue;
    const id = tournamentFor(g.competition || g.league, SID[s.sport], cfg, T);
    if (id) count[id] = (count[id] || 0) + (s.sport === "football" ? 1 : 100); else noId.push(g.id);
  }
  // NBA/NHL first, then the football competitions with the most games; 5 IDs a request
  // the morning run also fetches the basketball watch list (European leagues) so the daily build can pick games
  const morning = mode === "fetch" && new Date().getUTCHours() < 12 && usage.used < 160;
  const watch = morning ? watchIds(cfg) : [];
  const ids = Object.keys(count).filter(id => !watch.includes(id)).sort((a, b) => count[b] - count[a]), chunks = [];
  for (let i = 0; i < ids.length; i += 5) chunks.push(ids.slice(i, i + 5).join(","));
  const plan = [], lean = usage.used >= 160; // near the monthly cap: main book, first chunk only
  if (watch.length) plan.push([cfg.books.main, watch.join(",")]);
  if (chunks[0]) plan.push([cfg.books.main, chunks[0]]);
  if (mode !== "fetch-late" && !lean && chunks[0]) plan.push([cfg.books.local, chunks[0]]);
  if (lean) plan.splice(2);
  if (mode !== "fetch-late" && !lean && chunks[1]) plan.push([cfg.books.main, chunks[1]]);
  console.log("tournaments", ids.join(","), "no ID for", noId.join(" ") || "none");
  const fixtures = {};
  for (const [slug, tids] of plan) {
    let list; try { list = await get("/odds-by-tournaments", { bookmaker: slug, tournamentIds: tids }); } catch (e) { console.error(slug, e.message); continue; }
    for (const fx of Array.isArray(list) ? list : []) {
      const sport = SP[fx.sportId]; if (!sport || Date.parse(fx.startTime) < now - 3 * 3600e3) continue;
      const F = fixtures[fx.fixtureId] ||= { id: fx.fixtureId, sport, tournamentId: fx.tournamentId, start: fx.startTime, home: PT[fx.participant1Id] || String(fx.participant1Id), away: PT[fx.participant2Id] || String(fx.participant2Id), odds: {} };
      const o = normalize(fx, slug, MK, sport); if (o) F.odds[slug] = o;
    }
  }
  const all = Object.values(fixtures).sort((a, b) => a.start.localeCompare(b.start));
  // keep the previous local prices when this run only fetched the main book
  const prev = fs.existsSync(DIR + "/latest.json") ? JSON.parse(fs.readFileSync(DIR + "/latest.json", "utf8")) : null;
  if (prev) for (const p of prev.fixtures) if (!fixtures[p.id] && p.sport === "basketball" && Date.parse(p.start) > now) all.push(p);
  all.sort((a, b) => a.start.localeCompare(b.start));
  if (mode === "fetch-late" && prev) for (const f of all) { const p = prev.fixtures.find(x => x.id === f.id); if (p && p.odds[cfg.books.local] && !f.odds[cfg.books.local]) f.odds[cfg.books.local] = p.odds[cfg.books.local]; }
  save("latest.json", { updatedAt: at, books: cfg.books, note: "Pinnacle is the sharp reference the model fits to; AdmiralBet BA is the closest local (Bosnian) book on OddsPapi.", fixtures: all });
  let n = 0, miss = [];
  for (const s of site) {
    let changed = false;
    for (const g of s.games) {
      if (g.result || Date.parse(g.start || g.kickoff || 0) <= now) continue;
      const fx = findFixture(g, all.filter(f => f.sport === s.sport));
      if (!fx) { miss.push(s.sport + ":" + g.id); continue; }
      if (fx.swapped) continue; // home/away disagree: leave it for a human look
      if (applyToGame(g, fx, s.sport, at)) { changed = true; n++; }
    }
    if (changed) fs.writeFileSync(s.file, JSON.stringify(s.data, null, 2) + "\n");
  }
  console.log(`fetch ok: ${all.length} fixtures, ${n} site games updated, unmatched: ${miss.join(" ") || "none"}; requests this month ${usage.used}`);
  save("usage.json", { ...usage, lastFetch: { at, fixtures: all.length, updated: n, unmatched: miss, noTournament: noId } });
}
