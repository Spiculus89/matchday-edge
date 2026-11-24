// Grades finished site games from ESPN's public JSON and appends the legs to results.json.
// Usage: node scripts/grade-espn.mjs [YYYY-MM-DD ...] [--dry]
// Without dates it looks at the last 7 day files and today's (games that kicked off 2.5+ hours ago): games with no result yet, and games named in
// gradingTodo. Each game is priced the way the page showed it at kick-off: engine.js, the day
// file and results.json (the calibration) as they were in the last commit before kick-off.
import fs from "node:fs"; import vm from "node:vm"; import { execFileSync } from "node:child_process";
import { leagueSlug, matchEvent, parseSummary, shownPicks, settleShown } from "./grade-lib.mjs";

const args = process.argv.slice(2), dry = args.includes("--dry");
const now = Date.now(), DIR = "public/data";
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer/";
const warsawDate = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
const idx = JSON.parse(fs.readFileSync(DIR + "/index.json", "utf8"));
const dates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
if (!dates.length) for (const d of idx.days.map((x) => x.date)) if (d <= warsawDate(now) && Date.parse(d) > now - 8 * 864e5) dates.push(d);

async function getJSON(url) {
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "matchday-edge grader" }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch (e) { if (i) console.log("  fetch failed", url, e.message); }
    await new Promise((s) => setTimeout(s, 2000));
  }
  return null;
}
const boards = {};
async function events(slug, ymd) {
  const k = slug + ymd;
  if (!(k in boards)) { const js = await getJSON(`${BASE}${slug}/scoreboard?dates=${ymd}`); boards[k] = (js && js.events) || []; }
  return boards[k];
}

// The page as it was at kick-off: last commit before kick-off
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
const atCommit = {};
function snapshot(kickoff) {
  let c = ""; try { c = git("rev-list", "-1", "--before=" + kickoff, "HEAD").trim(); } catch (e) { /* shallow clone */ }
  if (!c) c = "HEAD";
  if (!atCommit[c]) {
    const show = (p) => { try { return git("show", `${c}:${p}`); } catch (e) { return fs.readFileSync(p, "utf8"); } };
    const ctx = { self: {} }; vm.runInNewContext(show("public/engine.js"), ctx);
    const E = ctx.self.BetEngine, legs = JSON.parse(show(DIR + "/results.json")).legs;
    atCommit[c] = { c, E, cal: E.trackStats(legs), day: (d) => { try { return JSON.parse(show(`${DIR}/${d}.json`)); } catch (e) { return null; } } };
  }
  return atCommit[c];
}

const results = JSON.parse(fs.readFileSync(DIR + "/results.json", "utf8"));
const have = new Set(results.legs.map((l) => `${l.date}|${l.match}|${l.pick}`));
let added = 0, changedDays = 0;
for (const date of dates) {
  const file = `${DIR}/${date}.json`;
  if (!fs.existsSync(file)) continue;
  const day = JSON.parse(fs.readFileSync(file, "utf8"));
  const todo = day.gradingTodo || [];
  const todoIds = new Set(todo.map((t) => t.split(":")[0].trim()));
  let changed = false;
  const newTodo = todo.filter(() => true);
  const dropTodo = (id) => { for (let i = newTodo.length - 1; i >= 0; i--) if (newTodo[i].split(":")[0].trim() === id) newTodo.splice(i, 1); };
  // games ESPN can't settle stay on the list for the morning run
  const skip = (m, why) => {
    console.log(`${date} ${m.id}: ${why}`);
    if (!m.result && !todoIds.has(m.id)) { newTodo.push(`${m.id}: result and picks (${why} on the ${warsawDate(now)} ESPN grading run)`); todoIds.add(m.id); changed = true; }
  };
  for (const m of day.matches) {
    if (Date.parse(m.kickoff) > now - 2.5 * 3600e3) continue;
    if (m.result && !todoIds.has(m.id)) continue;
    const slug = leagueSlug(m.competition);
    if (!slug) { skip(m, `no ESPN league for "${m.competition}"`); continue; }
    const ko = Date.parse(m.kickoff), ymd = (t) => new Date(t).toISOString().slice(0, 10).replace(/-/g, "");
    let ev = null;
    for (const d of [...new Set([ymd(ko - 6 * 3600e3), ymd(ko)])]) { ev = matchEvent(m, await events(slug, d)); if (ev) break; }
    if (!ev) { skip(m, `not found on ESPN ${slug}`); continue; }
    const F = parseSummary(await getJSON(`${BASE}${slug}/summary?event=${ev.id}`));
    if (!F || !F.finished || F.home == null) { skip(m, `ESPN ${ev.id} not finished (${F && F.status})`); continue; }
    if (F.extra) { skip(m, "extra time: the 90-minute score needs a hand check"); continue; }
    // price the game as the page did at kick-off
    const S = snapshot(m.kickoff), was = (S.day(date) || day).matches.find((x) => x.id === m.id) || m;
    S.E.setCalibration(S.cal);
    const r = S.E.analyse(was);
    const names = { home: was.home.short || was.home.name, away: was.away.short || was.away.name };
    const legs = [], open = [];
    for (const x of shownPicks(r)) {
      if (have.has(`${date}|${m.id}|${x.pick}`)) continue;
      const s = settleShown(x, names, F);
      if (!s) { open.push(x.pick); continue; }
      const leg = { date, match: m.id, group: x.group, pick: x.pick, p: x.p, odds: x.odds, won: s.won };
      if (s.void) leg.void = true;
      legs.push(leg); have.add(`${date}|${m.id}|${x.pick}`);
    }
    const t = F.teams;
    console.log(`${date} ${m.id}: ${F.home}-${F.away} (ESPN ${ev.id}${t.home ? `, corners ${t.home.corners}-${t.away && t.away.corners}, cards ${t.home.yellow}+${t.home.red}/${t.away && t.away.yellow}+${t.away && t.away.red}` : ""}) at ${S.c.slice(0, 7)}: ` +
      (legs.map((l) => `${l.won ? "W" : l.void ? "V" : "L"} ${l.pick}`).join("; ") || "no new legs") + (open.length ? ` | open: ${open.join("; ")}` : ""));
    results.legs.push(...legs); added += legs.length;
    if (!m.result) m.result = { home: F.home, away: F.away };
    dropTodo(m.id);
    if (open.length) newTodo.push(`${m.id}: not settled from ESPN (missing stats or player lines): ${open.join("; ")}`);
    changed = true;
  }
  if (changed) {
    if (newTodo.length) day.gradingTodo = newTodo; else delete day.gradingTodo;
    if (!dry) fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n");
    changedDays++;
  }
}
if (added && !dry) { results.updated = new Date().toISOString(); fs.writeFileSync(DIR + "/results.json", JSON.stringify(results, null, 2) + "\n"); }
console.log(`${dry ? "dry run: " : ""}${added} legs added, ${changedDays} day files updated (${dates.join(", ") || "no dates"})`);
