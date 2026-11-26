// Grades basketball and hockey day files from ESPN's public scoreboard (NBA and NHL) and appends the
// picks the engine showed to that sport's results.json. The pages are paused (21 Nov), but the odds
// job keeps writing Pinnacle-priced files, so grading them keeps the calibration learning (26 Nov).
// Usage: node scripts/grade-sports.mjs [YYYY-MM-DD ...] [--dry]   (no dates: the last 8 days)
import fs from "node:fs"; import vm from "node:vm"; import { execFileSync } from "node:child_process";

const args = process.argv.slice(2), dry = args.includes("--dry"), now = Date.now();
const SPORTS = { basketball: { engine: "engine-basketball.js", name: "HoopsEngine", espn: { NBA: "basketball/nba" } },
  hockey: { engine: "engine-hockey.js", name: "HockeyEngine", espn: { NHL: "hockey/nhl" } } };
const BASE = "https://site.api.espn.com/apis/site/v2/sports/";
const warsawDate = (t) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
const argDates = args.filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));

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

// ---------- ESPN event -> final score ----------
const last = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).pop();
export function findEvent(g, evs) {
  const h = last(g.home.name), a = last(g.away.name);
  return evs.find((e) => {
    const c = ((e.competitions || [])[0] || {}).competitors || [], ch = c.find((x) => x.homeAway === "home"), ca = c.find((x) => x.homeAway === "away");
    return ch && ca && last(ch.team && ch.team.displayName) === h && last(ca.team && ca.team.displayName) === a;
  }) || null;
}
// {finished, status, home, away, reg:{home,away}, p1, h1, so} — home/away are the settlement scores
// (NHL: incl. OT, and +1 to the shootout winner; NBA: incl. OT)
export function parseEvent(e, sport) {
  const comp = (e.competitions || [])[0] || {}, st = (comp.status || e.status || {}).type || {};
  const c = comp.competitors || [], H = c.find((x) => x.homeAway === "home"), A = c.find((x) => x.homeAway === "away");
  const out = { finished: !!st.completed, status: st.detail || st.shortDetail || st.name || "" };
  if (!H || !A || !out.finished) return out;
  const per = (x) => (x.linescores || []).map((l) => +(l.value != null ? l.value : l.displayValue));
  const ph = per(H), pa = per(A), sh = +H.score, sa = +A.score, sum = (a) => a.reduce((s, v) => s + v, 0);
  if (!(sh >= 0 && sa >= 0)) return out;
  if (sport === "hockey") {
    out.so = /\bSO\b/i.test(out.status);
    if (ph.length >= 3 && pa.length >= 3) {
      out.reg = { home: sum(ph.slice(0, 3)), away: sum(pa.slice(0, 3)) }; out.p1 = ph[0] + pa[0];
      if (out.so) {
        if (out.reg.home !== out.reg.away) return out;
        const ot = [ph[3] || 0, pa[3] || 0];
        out.home = out.reg.home + ot[0] + (H.winner ? 1 : 0); out.away = out.reg.away + ot[1] + (A.winner ? 1 : 0);
        out.goals = { home: out.reg.home + ot[0], away: out.reg.away + ot[1] };
        return out;
      }
      if (sum(ph) !== sh || sum(pa) !== sa) { delete out.reg; delete out.p1; }
    }
    out.home = sh; out.away = sa; out.goals = { home: sh, away: sa };
    return out;
  }
  out.home = sh; out.away = sa;
  if (ph.length >= 4 && pa.length >= 4 && sum(ph) === sh && sum(pa) === sa) out.h1 = { home: ph[0] + ph[1], away: pa[0] + pa[1] };
  return out;
}

// ---------- settle one selection: true, false, "void" or null (can't tell) ----------
export function settle(sel, sport, names, F) {
  sel = sel.replace(/ \((best bet|most likely|Bet|Lean|price assumed)\)$/g, "").replace(/ \(price assumed\)$/, "");
  const side = (n) => (n === names.home ? "home" : n === names.away ? "away" : null);
  const ou = (dir, L, n) => (n == null ? null : n === L ? "void" : /over/i.test(dir) ? n > L : n < L);
  const hcp = (s, line, sc) => { if (!s || !sc) return null; const d = (s === "home" ? sc.home - sc.away : sc.away - sc.home) + line; return d > 0 ? true : d < 0 ? false : "void"; };
  let m;
  if (sport === "hockey") {
    if ((m = /^(.*) to win \(incl\. OT\)$/.exec(sel))) { const s = side(m[1]); return s ? F[s] > F[s === "home" ? "away" : "home"] : null; }
    if ((m = /^(.*) in regulation$/.exec(sel))) { const s = side(m[1]); return s && F.reg ? hcp(s, 0, F.reg) === true : null; }
    if (sel === "Draw after 60 min") return F.reg ? F.reg.home === F.reg.away : null;
    if ((m = /^(Over|Under) (\d+(?:\.\d+)?) goals in 60 min$/.exec(sel))) return F.reg ? ou(m[1], +m[2], F.reg.home + F.reg.away) : null;
    if ((m = /^(.*) ([+-]\d+(?:\.\d+)?) \(60 min\)$/.exec(sel))) return F.reg ? hcp(side(m[1]), +m[2], F.reg) : null;
    if ((m = /^(Over|Under) (\d+(?:\.\d+)?) goals$/.exec(sel))) return ou(m[1], +m[2], F.home + F.away);
    if ((m = /^1st period (over|under) (\d+(?:\.\d+)?)$/.exec(sel))) return F.p1 != null ? ou(m[1], +m[2], F.p1) : null;
    if (sel === "Both teams to score" || sel === "Both teams to score: No") {
      if (F.so && (F.goals.home === 0 || F.goals.away === 0)) return null; // shootout goal: settlement varies by book
      const y = F.goals.home > 0 && F.goals.away > 0; return sel === "Both teams to score" ? y : !y;
    }
    if ((m = /^(.*) (over|under) (\d+(?:\.\d+)?)$/.exec(sel))) { const s = side(m[1]); return s ? ou(m[2], +m[3], F[s]) : null; }
    if ((m = /^(.*) ([+-]\d+(?:\.\d+)?)$/.exec(sel))) return hcp(side(m[1]), +m[2], F);
    return null;
  }
  if ((m = /^1H (over|under) (\d+(?:\.\d+)?)$/.exec(sel))) return F.h1 ? ou(m[1], +m[2], F.h1.home + F.h1.away) : null;
  if ((m = /^1H (.*) ([+-]\d+(?:\.\d+)?)$/.exec(sel))) return F.h1 ? hcp(side(m[1]), +m[2], F.h1) : null;
  if ((m = /^(.*) to win$/.exec(sel))) { const s = side(m[1]); return s ? F[s] > F[s === "home" ? "away" : "home"] : null; }
  if ((m = /^(Over|Under) (\d+(?:\.\d+)?) points$/.exec(sel))) return ou(m[1], +m[2], F.home + F.away);
  if ((m = /^(.*) (over|under) (\d+(?:\.\d+)?)$/.exec(sel))) { const s = side(m[1]); return s ? ou(m[2], +m[3], F[s]) : null; }
  if ((m = /^(.*) ([+-]\d+(?:\.\d+)?)$/.exec(sel))) return hcp(side(m[1]), +m[2], F);
  return null;
}

// What the page shows: best bet, most likely, builder and the Bet/Lean slip rows (player props stay open)
export function shownPicks(r) {
  const P = r.picks, out = [], r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  if (P.top) out.push({ group: P.top.group, pick: P.top.label + " (best bet)", p: r3(P.top.p), odds: P.top.odds || null, sel: [P.top.label] });
  if (P.likely) out.push({ group: P.likely.group, pick: P.likely.label + " (most likely)", p: r3(P.likely.p), odds: P.likely.odds || null, sel: [P.likely.label] });
  if (P.builder) out.push({ group: "Bet builder", pick: P.builder.legs.join(" + "), p: r3(P.builder.p), odds: null, sel: P.builder.legs });
  for (const row of P.slip || []) {
    if ((row.grade !== "Bet" && row.grade !== "Lean") || row.market === "Player prop") continue;
    out.push({ group: row.market, pick: row.pick + " (" + row.grade + ")", p: r3(row.p), odds: row.odds || null, sel: [row.pick] });
  }
  return out;
}
function settleShown(x, sport, names, F) {
  const v = x.sel.map((s) => settle(s, sport, names, F));
  if (v.some((s) => s == null)) return null;
  if (v.includes(false)) return { won: false };
  if (v.includes("void")) return x.sel.length > 1 ? null : { won: false, void: true };
  return { won: true };
}

// The page as it was at the start: last commit before it
const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 << 20 });
const atCommit = {};
function snapshot(sport, start) {
  let c = ""; try { c = git("rev-list", "-1", "--before=" + start, "HEAD").trim(); } catch (e) { /* shallow clone */ }
  if (!c) c = "HEAD";
  const key = sport + c, dir = `public/data/${sport}/`;
  if (!atCommit[key]) {
    const show = (p) => { try { return git("show", `${c}:${p}`); } catch (e) { return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; } };
    const ctx = { self: {} }; vm.runInNewContext(show("public/" + SPORTS[sport].engine), ctx);
    const E = ctx.self[SPORTS[sport].name], res = show(dir + "results.json");
    atCommit[key] = { c, E, cal: E.trackStats(res ? JSON.parse(res).legs : []), day: (d) => { try { return JSON.parse(show(`${dir}${d}.json`)); } catch (e) { return null; } } };
  }
  return atCommit[key];
}

if (process.argv[1] && process.argv[1].endsWith("grade-sports.mjs")) {
  for (const sport of Object.keys(SPORTS)) {
    const dir = `public/data/${sport}/`; if (!fs.existsSync(dir + "results.json")) continue;
    const dates = argDates.length ? argDates : fs.readdirSync(dir).map((f) => (/^(\d{4}-\d{2}-\d{2})\.json$/.exec(f) || [])[1]).filter((d) => d && d <= warsawDate(now) && Date.parse(d) > now - 8 * 864e5).sort();
    const results = JSON.parse(fs.readFileSync(dir + "results.json", "utf8"));
    const have = new Set(results.legs.map((l) => `${l.date}|${l.match}|${l.pick}`));
    let added = 0, days = 0;
    for (const date of dates) {
      const file = `${dir}${date}.json`; if (!fs.existsSync(file)) continue;
      const day = JSON.parse(fs.readFileSync(file, "utf8")); let changed = false;
      for (const g of day.games || []) {
        if (g.result || Date.parse(g.start) > now - 3.5 * 3600e3) continue;
        const slug = SPORTS[sport].espn[g.league];
        if (!slug) { console.log(`${sport} ${date} ${g.id}: no ESPN source for ${g.league}`); continue; }
        const t = Date.parse(g.start), ymd = (x) => new Date(x).toISOString().slice(0, 10).replace(/-/g, "");
        let ev = null;
        for (const d of [...new Set([ymd(t - 6 * 3600e3), ymd(t)])]) { ev = findEvent(g, await events(slug, d)); if (ev) break; }
        if (!ev) { console.log(`${sport} ${date} ${g.id}: not found on ESPN ${slug}`); continue; }
        const F = parseEvent(ev, sport);
        if (!F.finished || F.home == null) { console.log(`${sport} ${date} ${g.id}: ESPN ${ev.id} not settled (${F.status})`); continue; }
        const S = snapshot(sport, g.start), was = ((S.day(date) || day).games || []).find((x) => x.id === g.id) || g;
        S.E.setCalibration(S.cal);
        const r = S.E.analyse(was), names = { home: was.home.short || was.home.name, away: was.away.short || was.away.name };
        const legs = [], open = [];
        for (const x of shownPicks(r)) {
          if (have.has(`${date}|${g.id}|${x.pick}`)) continue;
          const s = settleShown(x, sport, names, F);
          if (!s) { open.push(x.pick); continue; }
          const leg = { date, match: g.id, group: x.group, pick: x.pick, p: x.p, odds: x.odds, won: s.won, shadow: true };
          if (s.void) leg.void = true;
          legs.push(leg); have.add(`${date}|${g.id}|${x.pick}`);
        }
        console.log(`${sport} ${date} ${g.id}: ${F.home}-${F.away}${F.so ? " SO" : ""} (ESPN ${ev.id}, ${F.status}) at ${S.c.slice(0, 7)}: ` +
          (legs.map((l) => `${l.void ? "V" : l.won ? "W" : "L"} ${l.pick}`).join("; ") || "no new legs") + (open.length ? ` | open: ${open.join("; ")}` : ""));
        results.legs.push(...legs); added += legs.length;
        g.result = sport === "hockey" ? { home: F.home, away: F.away, ot: F.so ? "SO" : /OT/i.test(F.status) ? "OT" : undefined } : { home: F.home, away: F.away, ot: /OT/i.test(F.status) ? "OT" : undefined };
        if (!g.result.ot) delete g.result.ot;
        changed = true;
      }
      if (changed) { if (!dry) fs.writeFileSync(file, JSON.stringify(day, null, 2) + "\n"); days++; }
    }
    if (added && !dry) { results.updated = new Date().toISOString(); fs.writeFileSync(dir + "results.json", JSON.stringify(results, null, 2) + "\n"); }
    console.log(`${dry ? "dry run: " : ""}${sport}: ${added} legs added, ${days} day files updated (${dates.join(", ") || "no dates"})`);
  }
}
