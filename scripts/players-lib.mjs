// Player season stats from ESPN's public JSON (24 Nov 2026): each squad from the team roster
// (positions, injuries) and each player's league season line from ESPN's stats API
// (minutes, starts, shots, shots on target, goals, assists, fouls committed, tackles).
// Turned into the `players` list and `teamTotals` the engine prices scorers, assists and props from.
import { normName } from "./grade-lib.mjs";

const STOP = new Set(["fc", "cf", "ac", "sc", "afc", "club", "ssc", "rc", "fk", "sk", "the", "de", "cd", "ud", "sv", "as", "us", "ca", "se", "ec", "cp"]);
const toks = (s) => normName(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
const teq = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// 0 unless one name's words are all in the other; then 1 + the share of words in common
export function teamScore(site, names) {
  const t = toks(site); let full = false, jac = 0;
  for (const nm of names.filter(Boolean)) {
    const u = toks(nm); if (!t.length || !u.length) continue;
    const hit = t.filter((w) => u.some((v) => teq(w, v))).length;
    if (hit >= Math.min(t.length, u.length)) full = true;
    jac = Math.max(jac, hit / Math.max(t.length, u.length));
  }
  return full ? 1 + jac : 0;
}
// ESPN team for a site team among [{slug, id, names}]: best full match, the game's own league first; ties are skipped
export function findEspnTeam(site, teams, slug) {
  let best = null, bs = 0, tie = false;
  for (const t of teams) {
    const s = Math.max(teamScore(site.name, t.names), site.short ? teamScore(site.short, t.names) : 0) + (slug && t.slug === slug ? 0.5 : 0);
    if (s < 1) continue;
    if (s > bs + 1e-9) { bs = s; best = t; tie = false; } else if (Math.abs(s - bs) < 1e-9 && best && best.id !== t.id) tie = true;
  }
  return best && !tie ? best : null;
}
export function teamsFromList(js, slug) {
  const L = js && js.sports && js.sports[0] && js.sports[0].leagues && js.sports[0].leagues[0];
  return ((L && L.teams) || []).map((x) => x.team).filter(Boolean)
    .map((t) => ({ slug, id: String(t.id), names: [t.displayName, t.shortDisplayName, t.name, t.location].filter(Boolean) }));
}

export function posOf(p) {
  const a = String((p && (p.abbreviation || p.name)) || "").toUpperCase();
  if (/^G|GOAL/.test(a)) return "GK";
  if (/^(D|CB|CD|LB|RB|WB|LWB|RWB|DEF)/.test(a)) return "DF";
  if (/^(AM|CAM|LM|RM|W$)/.test(a)) return "AM";
  if (/^(F|CF|ST|LW|RW|FW|ATT)/.test(a)) return "FW";
  return "MF";
}
export function parseRoster(js) {
  return ((js && js.athletes) || []).map((a) => {
    const inj = (a.injuries || [])[0], st = a.status || {};
    const out = inj ? (inj.status || inj.type && (inj.type.description || inj.type.name) || "injured") : st.type && st.type !== "active" ? st.name || st.type : null;
    return { id: String(a.id), name: a.displayName || a.fullName, pos: posOf(a.position), status: out ? String(out) : null };
  });
}
const STAT = { minutes: "minutes", starts: "starts", appearances: "apps", subIns: "subs", totalShots: "shots", shotsOnTarget: "sot", totalGoals: "goals",
  goalAssists: "assists", foulsCommitted: "fouls", totalTackles: "tackles", penaltyKickShots: "pkShots", yellowCards: "yc" };
export function parseStats(js) {
  const out = {};
  for (const c of (js && js.splits && js.splits.categories) || []) for (const s of c.stats || []) if (STAT[s.name] && out[STAT[s.name]] == null) out[STAT[s.name]] = Number(s.value) || 0;
  return Object.keys(out).length ? out : null;
}

// Lineup names ("N. Tornqvist", "Jay Robinson") against ESPN names
function sameName(a, b) {
  const x = normName(a).split(" "), y = normName(b).split(" ");
  const lx = x[x.length - 1], ly = y[y.length - 1];
  if (normName(a) === normName(b)) return true;
  if (lx !== ly) return x.length === 1 ? y.includes(x[0]) : y.length === 1 ? x.includes(y[0]) : false;
  return x[0][0] === y[0][0] || x.length === 1 || y.length === 1;
}

const r2 = (v) => Math.round(v * 100) / 100;
export const AUTO = "ESPN season stats";
// The engine's players list for one side, plus that side's season totals (same span)
export function sideFromTeam(team, lineup) {
  const ps = team.players.filter((p) => p.stats && p.stats.apps > 0);
  if (!ps.length) return null;
  const games = Math.max(1, ...ps.map((p) => p.stats.starts || 0));
  const xi = lineup && lineup.xi && lineup.xi.length === 11 ? lineup.xi : null, confirmed = lineup && lineup.confirmed;
  const list = ps.map((p) => {
    const s = p.stats, inXi = xi && xi.some((n) => sameName(n, p.name));
    let start = xi ? (inXi ? (confirmed ? 1 : 0.85) : confirmed ? 0.12 : 0.15) : Math.min(0.9, (s.starts || 0) / games + 0.05);
    let note = null;
    if (p.status && !inXi) { start = /day|doubt|question/i.test(p.status) ? start * 0.5 : 0; note = p.status; }
    const per90 = (k) => (s.minutes >= 180 && s[k] != null ? r2((s[k] / s.minutes) * 90) : undefined);
    return { name: p.name, pos: p.pos, start: r2(start), shots: s.shots || 0, goals: s.goals || 0, assists: s.assists || 0, pens: s.pkShots > 0 || undefined,
      shots90: per90("shots"), sot90: per90("sot"), fouls90: per90("fouls"), tackles90: per90("tackles"), mins: s.minutes, note: note || undefined };
  });
  const totals = { shots: list.reduce((a, p) => a + p.shots, 0), goals: list.reduce((a, p) => a + p.goals, 0), assists: list.reduce((a, p) => a + p.assists, 0) };
  const keep = list.filter((p) => p.start > 0 && (p.start >= 0.25 || p.goals > 0 || p.assists > 0)).sort((a, b) => b.start - a.start).slice(0, 18);
  return { players: keep, totals };
}
