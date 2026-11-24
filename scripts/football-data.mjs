// football-data.co.uk team and referee stats.
//   node scripts/football-data.mjs fetch    download this and last season's CSVs, write data/football-data/{teams,referees}.json
//   node scripts/football-data.mjs attach   fill form, corners, fouls, cards and referee rates on upcoming site games
//                                           (only fields that are missing; research data is never overwritten)
import fs from "node:fs";
import { MAIN, EXTRA, BASE, seasonCode, parseCsv, toGames, buildTeams, buildReferees, attach } from "./fd-lib.mjs";

const OUT = "data/football-data", mode = process.argv[2] || "attach";
const now = new Date(), today = now.toISOString().slice(0, 10);

if (mode === "fetch") {
  const games = [], got = [];
  const get = async (path) => {
    try {
      const r = await fetch(BASE + path, { headers: { "user-agent": "matchday-edge (daily stats pull)" }, signal: AbortSignal.timeout(30000) });
      return r.ok ? await r.text() : null;
    } catch (e) { return null; }
  };
  const cur = seasonCode(now), prev = seasonCode(now, 1);
  for (const div of MAIN) for (const s of [cur, prev]) {
    const t = await get(`mmz4281/${s}/${div}.csv`); if (!t) continue;
    const g = toGames(parseCsv(t), div); games.push(...g); got.push(`${div}/${s}:${g.length}`);
  }
  const since = new Date(now.getTime() - 450 * 864e5).toISOString().slice(0, 10);
  for (const c of EXTRA) {
    const t = await get(`new/${c}.csv`); if (!t) continue;
    const g = toGames(parseCsv(t), c).filter((x) => x.date >= since); games.push(...g); got.push(`${c}:${g.length}`);
  }
  if (games.length < 1000) { console.log(`only ${games.length} games downloaded (${got.join(" ")}); keeping the old files`); process.exit(0); }
  const y = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  const teams = buildTeams(games, today, `${y}-07-01`), refs = buildReferees(games);
  fs.mkdirSync(OUT, { recursive: true });
  const meta = { updated: now.toISOString(), source: BASE, files: got };
  fs.writeFileSync(`${OUT}/teams.json`, JSON.stringify({ ...meta, teams }) + "\n");
  fs.writeFileSync(`${OUT}/referees.json`, JSON.stringify({ ...meta, referees: refs }, null, 1) + "\n");
  console.log(`football-data: ${games.length} games, ${Object.keys(teams).length} teams, ${Object.keys(refs).length} referees (${got.join(" ")})`);
} else {
  if (!fs.existsSync(`${OUT}/teams.json`)) { console.log("no football-data team file yet"); process.exit(0); }
  const db = { teams: JSON.parse(fs.readFileSync(`${OUT}/teams.json`, "utf8")).teams,
    refs: fs.existsSync(`${OUT}/referees.json`) ? JSON.parse(fs.readFileSync(`${OUT}/referees.json`, "utf8")).referees : {} };
  const idx = JSON.parse(fs.readFileSync("public/data/index.json", "utf8"));
  const warsaw = now.toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
  const files = idx.days.map((d) => d.date).filter((d) => d >= warsaw);
  for (const f of fs.readdirSync("public/data")) { const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (m && m[1] >= warsaw && !files.includes(m[1])) files.push(m[1]); }
  let n = 0;
  for (const d of files) {
    const p = `public/data/${d}.json`; if (!fs.existsSync(p)) continue;
    const day = JSON.parse(fs.readFileSync(p, "utf8")); let changed = false;
    for (const m of day.matches || []) {
      if (m.result || Date.parse(m.kickoff) <= now.getTime()) continue;
      const added = attach(m, db);
      if (added.length) { changed = true; n++; console.log(`${d} ${m.id}: ${added.join(", ")}`); }
    }
    if (changed) fs.writeFileSync(p, JSON.stringify(day, null, 2) + "\n");
  }
  console.log(`football-data attach: ${n} games updated`);
}
