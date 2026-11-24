// Re-scores the anytime-scorer and assist model on this season's games (data/backtest/scorer-lines.json,
// built by scripts/backtest-fetch.mjs). Every prediction uses only games played before it: the player's
// and team's running season totals, and the team goal rate from ESPN's pre-match odds (or running form).
// Usage: node scripts/backtest-scorers.mjs [--grid]   (prints old v new model on the later half; --grid refits)
import fs from "node:fs"; import vm from "node:vm";
const ctx = { self: {} }; vm.runInNewContext(fs.readFileSync("public/engine.js", "utf8"), ctx); const E = ctx.self.BetEngine;
const D = JSON.parse(fs.readFileSync("data/backtest/scorer-lines.json", "utf8"));
const dec = (ml) => (ml == null || ml === "" || isNaN(+ml) ? null : +ml > 0 ? 1 + +ml / 100 : 1 + 100 / Math.abs(+ml));
const posOf = (a) => (/^G/.test(a) ? "GK" : /^(D|CB|CD|LB|RB|WB|LWB|RWB)/.test(a) ? "DF" : /^(AM|LM|RM)/.test(a) ? "AM" : /^(F|CF|ST|LW|RW|S$)/.test(a) ? "FW" : "MF");
const POSDEF = { FW: 0.06, AM: 0.045, MF: 0.03, DF: 0.015, GK: 0.015 };

// one row per listed player per game: the inputs both models need and what happened
const rows = [], team = {}, pl = {};
const games = D.games.filter((g) => g.hg != null).sort((a, b) => (a.d < b.d ? -1 : 1));
for (const g of games) {
  const T = [g.h, g.a].map((id) => (team[g.lg + id] = team[g.lg + id] || { n: 0, gf: 0, ga: 0, shots: 0, goals: 0, assists: 0 }));
  if (T[0].n >= 4 && T[1].n >= 4) {
    const m = { id: g.id, home: { name: "H" }, away: { name: "A" }, lineups: { status: "pending", home: { xi: [] }, away: { xi: [] } }, news: [] };
    const o = g.o || {}, h = dec(o.ml && o.ml[0]), d = dec(o.ml && o.ml[1]), a = dec(o.ml && o.ml[2]);
    let src = "form";
    if (h && d && a && 1 / h + 1 / d + 1 / a > 1 && 1 / h + 1 / d + 1 / a < 1.15) {
      m.odds = { h, d, a }; src = "odds";
      const ov = dec(o.over), un = dec(o.under);
      if (o.ou && ov && un) m.odds.ou = { [String(o.ou)]: [ov, un] };
    } else m.form20 = { home: { gf: T[0].gf / T[0].n, ga: T[0].ga / T[0].n }, away: { gf: T[1].gf / T[1].n, ga: T[1].ga / T[1].n } };
    const xg = E.analyse(m).xg;
    [0, 1].forEach((sd) => {
      const key = g.lg + (sd ? g.a : g.h), t = T[sd], played = new Map(g.p.filter((p) => p[1] === sd).map((p) => [p[0], p]));
      // the list the site would show: everyone with an appearance for this team so far
      const list = Object.entries(pl).filter(([k, v]) => v.team === key && v.apps > 0).map(([k, v]) => {
        const id = k.split("|")[1], now = played.get(id);
        const pos = Object.entries(v.pos).sort((x, y) => y[1] - x[1])[0];
        return { id, pos: pos ? posOf(pos[0]) : "MF", shots: v.shots, goals: v.goals, assists: v.assists, starts: v.starts, apps: v.apps,
          started: now ? now[2] === 1 : false, sub: now ? now[2] === 2 : false, scored: now ? (now[6] || 0) > 0 : false, assisted: now ? (now[7] || 0) > 0 : false };
      });
      if (list.length >= 11) rows.push({ d: g.d, lam: sd ? xg.away : xg.home, src, S: t.shots, G: t.goals, A: t.assists, n: t.n, list });
    });
  }
  // then add this game to the running totals
  [0, 1].forEach((sd) => {
    const key = g.lg + (sd ? g.a : g.h), t = team[key];
    t.n++; t.gf += sd ? g.ag : g.hg; t.ga += sd ? g.hg : g.ag;
    for (const p of g.p.filter((x) => x[1] === sd)) {
      const v = (pl[key + "|" + p[0]] = pl[key + "|" + p[0]] || { team: key, shots: 0, goals: 0, assists: 0, starts: 0, apps: 0, pos: {} });
      v.apps++; if (p[2] === 1) { v.starts++; if (p[3] && p[3] !== "SUB") v.pos[p[3]] = (v.pos[p[3]] || 0) + 1; }
      v.shots += p[4] || 0; v.goals += p[6] || 0; v.assists += p[7] || 0; t.shots += p[4] || 0; t.goals += p[6] || 0; t.assists += p[7] || 0;
    }
  });
}

// scorer model: P = 1 - exp(-lam * w * k). cfg.norm rescales a full list so its players carry `tau` of the team's goals.
function score(r, cfg, lineupKnown) {
  const out = [];
  const S = Math.max(r.S, 1), G = Math.max(r.G, 1), A = Math.max(r.A, 0.7 * G, 1);
  const games = Math.max(1, r.n);
  const items = r.list.map((p) => {
    const sShare = p.shots / (S + cfg.a), gShare = p.goals / (G + cfg.b), pd = POSDEF[p.pos];
    const w0 = (p.shots || p.goals) ? cfg.blend * (cfg.ws * sShare + (1 - cfg.ws) * gShare) + (1 - cfg.blend) * pd : pd;
    const aw = 0.6 * (p.assists / A) + 0.4 * w0;
    const start = lineupKnown ? (p.started ? 1 : 0.12) : Math.min(0.9, p.starts / games + 0.05);
    const mins = start * 0.86 + (1 - start) * 0.15, k = mins / 0.86;
    return { p, w0, aw, k };
  });
  let c = 1, ca = 1;
  if (cfg.norm) {
    const sw = items.reduce((s, x) => s + x.w0 * x.k, 0), sa = items.reduce((s, x) => s + x.aw * x.k, 0);
    c = cfg.tau / sw; ca = cfg.tauA / (0.72 * sa);
  }
  for (const x of items) {
    const w = Math.min(0.6, Math.max(0.005, x.w0 * c));
    out.push({ y: x.p.scored, ya: x.p.assisted, pg: 1 - Math.exp(-r.lam * w * x.k), pa: 1 - Math.exp(-r.lam * 0.72 * x.aw * ca * x.k), started: x.p.started, played: x.p.started || x.p.sub });
  }
  return out;
}
function evaluate(cfg, filter, lineupKnown) {
  let ll = 0, br = 0, n = 0, sp = 0, sy = 0, lla = 0, spa = 0, sya = 0;
  const bins = Array.from({ length: 8 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of rows.filter(filter)) for (const o of score(r, cfg, lineupKnown)) {
    if (lineupKnown && !o.started) continue; // judge starters once the lineup is known
    const p = Math.min(0.97, Math.max(0.003, o.pg)), q = Math.min(0.97, Math.max(0.003, o.pa));
    ll -= o.y ? Math.log(p) : Math.log(1 - p); br += (p - (o.y ? 1 : 0)) ** 2; n++; sp += p; sy += o.y ? 1 : 0;
    lla -= o.ya ? Math.log(q) : Math.log(1 - q); spa += q; sya += o.ya ? 1 : 0;
    const b = bins[Math.min(7, Math.floor(p / 0.075))]; b.n++; b.p += p; b.y += o.y ? 1 : 0;
  }
  return { n, ll: ll / n, br: br / n, pred: sp, actual: sy, lla: lla / n, predA: spa, actualA: sya, bins: bins.filter((b) => b.n >= 30).map((b) => `${(100 * b.p / b.n).toFixed(0)}%->${(100 * b.y / b.n).toFixed(0)}% (${b.n})`) };
}
const OLD = { a: 40, b: 6, ws: 0.5, blend: 0.8, norm: false };
const NEW = { a: 0, b: 6, ws: 0.7, blend: 0.7, norm: true, tau: 1, tauA: 0.7 }; // in public/engine.js since 24 Nov
const split = rows.length ? rows[Math.floor(rows.length * 0.5)].d : "";
const fit = (r) => r.d < split, test = (r) => r.d >= split;
console.log(`${games.length} games, ${rows.length} team-games scored (${rows.filter((r) => r.src === "odds").length} with ESPN odds); fit before ${split.slice(0, 10)}, test after`);
const line = (name, e) => console.log(`${name}: n ${e.n} logloss ${e.ll.toFixed(4)} brier ${e.br.toFixed(4)} scorers predicted ${e.pred.toFixed(0)} vs ${e.actual} | assists logloss ${e.lla.toFixed(4)} predicted ${e.predA.toFixed(0)} vs ${e.actualA}\n   calibration ${e.bins.join(" ")}`);
const show = (name, cfg) => { for (const lk of [true, false]) line(`${name} ${lk ? "lineup known, starters" : "before lineups, all listed"}`, evaluate(cfg, test, lk)); };
show("old", OLD);
show("new", NEW);
// the engine itself, lineup known: checks public/engine.js matches the NEW formula
{
  let ll = 0, n = 0, sp = 0, sy = 0;
  for (const r of rows.filter(test)) {
    const mk = (p) => ({ name: p.id, pos: p.pos, start: p.started ? 1 : 0.12, shots: p.shots, goals: p.goals, assists: p.assists });
    const m = { id: "b", home: { name: "H" }, away: { name: "A" }, players: { home: r.list.map(mk), away: [] }, teamTotals: { home: { shots: r.S, goals: r.G, assists: r.A } },
      odds: { h: 2, d: 3.4, a: 3.9 }, lineups: { status: "pending", home: { xi: [] }, away: { xi: [] } }, news: [] };
    const out = E.analyse(m);
    const scale = r.lam / out.xg.home; // put the backtest's goal rate on the engine's own
    for (const pl of out.players) {
      const p = r.list.find((x) => x.id === pl.name); if (!p.started) continue;
      const pg = Math.min(0.97, Math.max(0.003, 1 - Math.pow(1 - pl.scorer, scale)));
      ll -= p.scored ? Math.log(pg) : Math.log(1 - pg); n++; sp += pg; sy += p.scored ? 1 : 0;
    }
  }
  console.log(`engine (public/engine.js) lineup known, starters: n ${n} logloss ${(ll / n).toFixed(4)} scorers predicted ${sp.toFixed(0)} vs ${sy}`);
}
if (process.argv.includes("--grid")) {
  let best = null;
  for (const a of [0, 10, 40]) for (const b of [0, 3, 6, 10]) for (const ws of [0.5, 0.7, 0.9]) for (const blend of [0.5, 0.7, 0.8, 1]) for (const tau of [0.85, 0.9, 0.95, 1]) {
    const cfg = { a, b, ws, blend, norm: true, tau, tauA: 0.7 }, e = evaluate(cfg, fit, true);
    if (!best || e.ll < best.e.ll) best = { cfg, e };
  }
  console.log("best on the fit half:", JSON.stringify(best.cfg)); show("grid best", best.cfg);
}
