/* Ticket creator: legs from football, basketball and ice hockey, built to a target total odds. */
(function () {
  "use strict";
  var SPORTS = [
    { key: "football", label: "Football", engine: window.BetEngine, data: "data/", start: "kickoff", sep: " v ",
      groups: { "Result": 1, "Double chance": 1, "Goals": 1, "BTTS": 1, "Handicap": 1, "Corners": 1 } },
    { key: "basketball", paused: true, label: "Basketball", engine: window.HoopsEngine, data: "data/basketball/", start: "start", sep: " @ ",
      groups: { "Moneyline": 1, "Spread": 1, "Total": 1, "Team total": 1, "1st half": 1 } },
    { key: "hockey", paused: true, label: "Ice hockey", engine: window.HockeyEngine, data: "data/hockey/", start: "start", sep: " @ ",
      groups: { "Moneyline": 1, "60-min result": 1, "Puck line": 1, "Total": 1, "Total (60 min)": 1, "Handicap (60 min)": 1, "Team total": 1, "1st period": 1 } }
  ].filter(function (sp) { return !sp.paused; }); // basketball and hockey paused since 21 Nov (user request): football only
  var STYLES = {
    safe: { label: "Safe legs (1.20–1.60)", min: 1.2, max: 1.6 },
    balanced: { label: "Balanced legs (1.30–2.20)", min: 1.3, max: 2.2 },
    bold: { label: "Bold legs (1.50–3.50)", min: 1.5, max: 3.5 }
  };
  var LOCAL_MARGIN = 0.05; // a typical local bookmaker pays about 5% less per leg than Pinnacle
  var app = document.getElementById("app");
  var ALL = [], BYID = {}, GAMES = {};
  var PRE = [];
  var state = { target: 5, legs: "auto", style: "balanced", sports: { football: true, basketball: true, hockey: true }, ticket: [], pinned: {} };

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(p) { return p == null ? "–" : (p * 100 < 10 ? (p * 100).toFixed(1) : Math.round(p * 100)) + "%"; }
  function odd(x) { return x == null || !isFinite(x) ? "–" : x >= 100 ? Math.round(x) : x.toFixed(2); }
  // Asian +0.5 is "or draw" and -0.5 is "to win": name them the way a local bookmaker's slip does
  function nice(label) {
    var m = /^(.*) ([+-])0\.5 \(Asian handicap\)$/.exec(label || "");
    return m ? m[1] + (m[2] === "+" ? " or draw" : " to win") + " (Asian " + m[2] + "0.5)" : label;
  }
  function time(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch (e) { return ""; } }
  function getJson(u) { return fetch(u, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function save() { try { localStorage.setItem("me-ticket", JSON.stringify({ target: state.target, legs: state.legs, style: state.style, sports: state.sports, ticket: state.ticket.map(function (l) { return l.id; }), pinned: Object.keys(state.pinned) })); } catch (e) {} }
  function restore() { try { var s = JSON.parse(localStorage.getItem("me-ticket") || "null"); if (s) { state.target = s.target || 5; state.legs = s.legs || "auto"; state.style = STYLES[s.style] ? s.style : "balanced"; state.sports = s.sports || state.sports; return s; } } catch (e) {} return null; }

  // ---------- load every sport's games starting in the next 24 hours ----------
  function loadSport(sp) {
    if (!sp.engine) return Promise.resolve([]);
    return Promise.all([getJson(sp.data + "results.json"), getJson(sp.data + "index.json")]).then(function (x) {
      var rec = x[0], idx = x[1];
      if (rec && rec.legs) sp.engine.setCalibration(sp.engine.trackStats(rec.legs));
      var days = (idx && idx.days || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 2);
      return Promise.all(days.map(function (d) {
        var f = String(d.file || d.date + ".json"); if (f.indexOf("/") < 0) f = sp.data + f;
        return getJson(f);
      }));
    }).then(function (files) {
      var now = Date.now(), legs = [];
      (files || []).forEach(function (day) {
        ((day && (day.matches || day.games)) || []).forEach(function (g) {
          var t = new Date(g[sp.start] || g.start || g.kickoff).getTime();
          if (g.result || !(t > now + 5 * 60e3 && t < now + 24 * 3600e3)) return;
          var r; try { r = sp.engine.analyse(g); } catch (e) { return; }
          var gid = sp.key + ":" + g.id, name = (sp.key === "football" ? [g.home, g.away] : [g.away, g.home]).map(function (t2) { return t2.short || t2.name; }).join(sp.sep);
          GAMES[gid] = { id: gid, sport: sp, name: name, league: g.competition || g.league || "", start: g[sp.start] || g.start };
          ((r.picks && r.picks.all) || []).forEach(function (c) {
            if (!sp.groups[c.group] || !c.odds || !(c.p > 0.05 && c.p < 0.97) || c.push || c.assumed) return;
            // whole-number lines can push (stake back), which a ticket can't price as win/lose: half lines only
            if (/(?:over|under|[+-])\s?\d+(?![\d.])/i.test(c.label) && !/\d\.\d/.test(c.label)) return;
            legs.push({ id: gid + "|" + c.group + "|" + c.label, game: gid, sport: sp.key, group: c.group, label: c.label, p: c.p, odds: c.odds });
          });
        });
      });
      return legs;
    });
  }

  // ---------- building ----------
  function pool() { return ALL.filter(function (l) { return state.sports[l.sport] !== false; }); }
  function buildTicket() {
    var st = STYLES[state.style], fixed = state.legs === "auto" ? 0 : +state.legs;
    var res = window.TicketCore.build(pool(), { target: state.target, exactLegs: fixed || undefined, maxLegs: fixed || 6, minOdds: st.min, maxOdds: st.max, pinned: Object.keys(state.pinned) });
    // nothing fits: widen the tolerance once before giving up
    if (!res) res = window.TicketCore.build(pool(), { target: state.target, tolerance: 1.35, exactLegs: fixed || undefined, maxLegs: fixed || 8, minOdds: st.min, maxOdds: st.max, pinned: Object.keys(state.pinned) });
    state.ticket = res ? res.legs.slice().sort(function (a, b) { return new Date(GAMES[a.game].start) - new Date(GAMES[b.game].start); }) : [];
    state.failed = !res;
    save(); render();
  }
  function setLeg(l) {
    state.ticket = state.ticket.filter(function (x) { return x.game !== l.game; }).concat([l]);
    Object.keys(state.pinned).forEach(function (id) { if (BYID[id] && BYID[id].game === l.game) delete state.pinned[id]; });
    state.pinned[l.id] = true; save(); render();
  }
  function removeLeg(id) {
    state.ticket = state.ticket.filter(function (x) { return x.id !== id; }); delete state.pinned[id]; save(); render();
  }

  // ---------- rendering ----------
  function sportTag(k) { return '<span class="chip">' + esc(k === "hockey" ? "Hockey" : k === "basketball" ? "Basketball" : "Football") + "</span>"; }
  function controls() {
    var targets = [2, 3, 5, 10, 20, 50];
    return '<section class="tk-controls" aria-label="Build a ticket">' +
      '<div class="tk-field"><label for="tk-target">Total odds you want</label><div class="tk-row"><input id="tk-target" type="number" min="1.2" max="500" step="0.1" inputmode="decimal" value="' + esc(state.target) + '">' +
      '<div class="days tk-quick" role="group" aria-label="Quick odds">' + targets.map(function (t) { return '<button type="button" data-target="' + t + '" aria-pressed="' + (+state.target === t) + '">' + t + "</button>"; }).join("") + "</div></div></div>" +
      '<div class="tk-field"><label for="tk-legs">Number of legs</label><select id="tk-legs">' + ["auto", 2, 3, 4, 5, 6, 7, 8].map(function (n) { return '<option value="' + n + '"' + (String(state.legs) === String(n) ? " selected" : "") + ">" + (n === "auto" ? "Best chance (fewest legs)" : n + " legs") + "</option>"; }).join("") + "</select></div>" +
      '<div class="tk-field"><label for="tk-style">Leg odds</label><select id="tk-style">' + Object.keys(STYLES).map(function (k) { return '<option value="' + k + '"' + (state.style === k ? " selected" : "") + ">" + STYLES[k].label + "</option>"; }).join("") + "</select></div>" +
      (SPORTS.length < 2 ? "" : '<fieldset class="tk-field"><legend>Sports</legend><div class="tk-row">' + SPORTS.map(function (sp) { return '<label class="tk-check"><input type="checkbox" data-sport="' + sp.key + '"' + (state.sports[sp.key] ? " checked" : "") + "> " + sp.label + "</label>"; }).join("") + "</div></fieldset>") +
      '<div class="tk-field"><button type="button" class="tk-build" id="tk-build">Build ticket</button><button type="button" class="tk-clear" id="tk-clear">Clear</button></div>' +
      "</section>";
  }
  function ticketView() {
    if (!state.ticket.length) return '<div class="topbet" style="background:var(--warn-bg);border-color:var(--warn)"><div><div class="lab" style="color:var(--warn)">Ticket</div><div class="what">' + (state.failed ? "No ticket fits" : "Empty") + '</div></div><div class="nums" style="max-width:56ch">' +
      (state.failed ? "No combination of today's legs reaches those odds with these settings. Try other leg odds, more legs or another target." : "Pick the total odds you want and press Build ticket, or add legs yourself from the games below.") + "</div></div>";
    var s = window.TicketCore.stats(state.ticket), n = state.ticket.length, local = s.odds * Math.pow(1 - LOCAL_MARGIN, n);
    var rows = state.ticket.map(function (l) {
      var g = GAMES[l.game];
      return '<tr><td>' + sportTag(l.sport) + ' <span class="market">' + esc(g.league) + " · " + esc(time(g.start)) + '</span><br><b>' + esc(g.name) + '</b><br><span class="pickname">' + esc(nice(l.label)) + (state.pinned[l.id] ? ' <span class="chip">kept</span>' : "") + '</span></td>' +
        '<td class="r num">' + pct(l.p) + '</td><td class="r num">' + odd(l.odds) + '</td><td class="r num"><b>' + odd(1 / l.p) + '</b></td>' +
        '<td class="r"><button type="button" class="tk-x" data-remove="' + esc(l.id) + '" aria-label="Remove ' + esc(l.label) + '">✕</button></td></tr>';
    }).join("");
    var oneIn = s.chance > 0 ? Math.round(1 / s.chance) : null;
    return '<div class="topbet"><div><div class="lab">Your ticket · ' + n + (n === 1 ? " leg" : " legs") + '</div><div class="what num">@ ' + odd(s.odds) + '</div></div>' +
      '<div class="nums num">real chance <b>' + pct(s.chance) + "</b> (about 1 in " + oneIn + ") · fair odds " + odd(s.fair) + "</div></div>" +
      '<div class="tablewrap"><table><thead><tr><th>Leg</th><th class="r">Chance</th><th class="r">Pinnacle</th><th class="r">Fair</th><th class="r"><span class="sr">Remove</span></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="tk-summary">' +
      "<p>At Pinnacle's prices, 10 BAM returns <b>" + odd(10 * s.odds) + " BAM</b> when it lands, and about <b>" + odd(10 * s.value) + " BAM</b> on average over many tickets like this.</p>" +
      "<p>A local bookmaker paying about 5% less per leg would offer roughly <b>@ " + odd(local) + "</b>, and the average return falls to about <b>" + odd(10 * s.chance * local) + " BAM</b> per 10 BAM. Check each leg's price against its fair odds before you place it: below fair, that leg costs you money.</p>" +
      (n >= 5 ? '<p class="warn">' + n + " legs: every one has to win, and the bookmaker's margin is paid " + n + " times. Fewer legs at the same odds land more often.</p>" : "") +
      "</div>";
  }
  function gamesView() {
    var byGame = {};
    pool().forEach(function (l) { (byGame[l.game] = byGame[l.game] || []).push(l); });
    var ids = Object.keys(byGame).sort(function (a, b) { return new Date(GAMES[a].start) - new Date(GAMES[b].start); });
    if (!ids.length) return '<p class="meta" style="text-align:left">No games in the next 24 hours for the sports you picked.</p>';
    var inTicket = {}; state.ticket.forEach(function (l) { inTicket[l.id] = true; });
    return '<div class="section-title"><h2>Add legs yourself</h2><p>Legs you add stay on the ticket when you build again; the builder fills the rest. One leg per game.</p></div>' +
      ids.map(function (gid) {
        var g = GAMES[gid], legs = byGame[gid].slice().sort(function (a, b) { return b.p - a.p; });
        return '<details class="panel tk-game"><summary>' + sportTag(g.sport.key) + " <b>" + esc(g.name) + '</b> <span class="market">' + esc(g.league) + " · " + esc(time(g.start)) + "</span></summary>" +
          '<div class="tablewrap"><table><thead><tr><th>Pick</th><th class="r">Chance</th><th class="r">Pinnacle</th><th class="r">Fair</th><th class="r"><span class="sr">Add</span></th></tr></thead><tbody>' +
          legs.map(function (l) {
            return '<tr><td><span class="market">' + esc(l.group) + '</span><br><span class="pickname">' + esc(nice(l.label)) + '</span></td><td class="r num">' + pct(l.p) + '</td><td class="r num">' + odd(l.odds) + '</td><td class="r num">' + odd(1 / l.p) + '</td>' +
              '<td class="r">' + (inTicket[l.id] ? '<span class="chip">on ticket</span>' : '<button type="button" class="tk-add" data-add="' + esc(l.id) + '" aria-label="Add ' + esc(l.label) + '">+ Add</button>') + "</td></tr>";
          }).join("") + "</tbody></table></div></details>";
      }).join("");
  }
  function refreshPresets() { PRE = window.TicketCore.presets(pool()); }
  function presetsView() {
    if (!PRE.length || !PRE.some(function (x) { return x.ticket; })) return "";
    var shared = PRE.some(function (x) { return x.sharesGames; });
    return '<div class="section-title"><h2>Today’s tickets</h2><p>Five ready-made tickets from the games still to come, each built for the highest real chance at its odds. ' +
      (shared ? "There weren't enough games to keep them apart, so some share a game." : "The first four don't share a game, so one upset can't sink them all.") + "</p></div>" +
      '<div class="tk-cards">' + PRE.map(function (x) {
        var ps = x.preset, t = x.ticket;
        if (!t) return '<article class="tk-card"><div class="lab">' + esc(ps.title) + '</div><p class="meta" style="text-align:left">No ticket fits today’s games.</p></article>';
        var legs = t.legs.slice().sort(function (a, b) { return new Date(GAMES[a.game].start) - new Date(GAMES[b.game].start); });
        var local = t.odds * Math.pow(1 - LOCAL_MARGIN, legs.length);
        return '<article class="tk-card"><div class="tk-head"><div><div class="lab">' + esc(ps.title) + " · " + legs.length + ' legs</div><div class="what num">@ ' + odd(t.odds) + "</div></div>" +
          '<div class="tk-chance num"><b>' + pct(t.chance) + "</b>about 1 in " + Math.round(1 / t.chance) + "</div></div>" +
          '<p class="market">' + esc(ps.note) + "</p><ol class=\"tk-legs\">" + legs.map(function (l) {
            var g = GAMES[l.game];
            return '<li><span class="market">' + esc(time(g.start)) + " · " + esc(g.name) + '</span><span class="tk-leg"><b>' + esc(nice(l.label)) + '</b><span class="num">' + odd(l.odds) + " · " + pct(l.p) + "</span></span></li>";
          }).join("") + "</ol>" +
          '<p class="tk-foot num">Fair ' + odd(t.fair) + " · local book about @ " + odd(local) + '</p><button type="button" class="tk-add" data-load="' + ps.key + '">Edit in builder</button></article>';
      }).join("") + "</div>";
  }
  function loadPreset(key) {
    var x = PRE.filter(function (y) { return y.preset.key === key; })[0]; if (!x || !x.ticket) return;
    state.ticket = x.ticket.legs.slice(); state.pinned = {}; state.ticket.forEach(function (l) { state.pinned[l.id] = true; });
    state.target = Math.round(x.ticket.odds * 10) / 10; state.failed = false; save(); render();
    var c = app.querySelector(".tk-controls"); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: "smooth" });
  }
  function render() {
    app.innerHTML = presetsView() + '<div class="section-title"><h2>Build your own</h2></div>' + controls() + ticketView() + gamesView();
    Array.prototype.forEach.call(app.querySelectorAll("[data-load]"), function (b) { b.addEventListener("click", function () { loadPreset(b.dataset.load); }); });
    var t = document.getElementById("tk-target");
    t.addEventListener("change", function () { var v = parseFloat(t.value); if (v >= 1.2 && v <= 500) { state.target = v; buildTicket(); } });
    Array.prototype.forEach.call(app.querySelectorAll("[data-target]"), function (b) { b.addEventListener("click", function () { state.target = +b.dataset.target; buildTicket(); }); });
    document.getElementById("tk-legs").addEventListener("change", function (e) { state.legs = e.target.value; buildTicket(); });
    document.getElementById("tk-style").addEventListener("change", function (e) { state.style = e.target.value; buildTicket(); });
    Array.prototype.forEach.call(app.querySelectorAll("[data-sport]"), function (c) { c.addEventListener("change", function () {
      state.sports[c.dataset.sport] = c.checked;
      state.ticket = state.ticket.filter(function (l) { return state.sports[l.sport]; });
      Object.keys(state.pinned).forEach(function (id) { if (BYID[id] && !state.sports[BYID[id].sport]) delete state.pinned[id]; });
      refreshPresets(); buildTicket(); }); });
    document.getElementById("tk-build").addEventListener("click", buildTicket);
    document.getElementById("tk-clear").addEventListener("click", function () { state.ticket = []; state.pinned = {}; state.failed = false; save(); render(); });
    Array.prototype.forEach.call(app.querySelectorAll("[data-remove]"), function (b) { b.addEventListener("click", function () { removeLeg(b.dataset.remove); }); });
    Array.prototype.forEach.call(app.querySelectorAll("[data-add]"), function (b) { b.addEventListener("click", function () { var l = BYID[b.dataset.add]; if (l) setLeg(l); }); });
  }

  var saved = restore();
  Promise.all(SPORTS.map(loadSport)).then(function (lists) {
    ALL = [].concat.apply([], lists); ALL.forEach(function (l) { BYID[l.id] = l; });
    var meta = document.getElementById("meta");
    if (meta) meta.textContent = Object.keys(GAMES).length + " games in the next 24 hours · " + ALL.length + " priced legs";
    refreshPresets();
    if (saved && saved.ticket && saved.ticket.length) {
      state.ticket = saved.ticket.map(function (id) { return BYID[id]; }).filter(Boolean);
      (saved.pinned || []).forEach(function (id) { if (BYID[id]) state.pinned[id] = true; });
      render();
    } else buildTicket();
  });
})();
