/* Matchday Edge: basketball and ice hockey pages. Same layout and rules as football:
 * best-bet tiles, one card per game with a bet slip (Bet / Lean / Skip), the model's numbers,
 * players and props, team news, live mode and a per-sport track record. */
(function () {
  "use strict";
  var CFG = window.SPORT;
  var E = CFG.engine;
  var app = document.getElementById("app"), daysEl = document.getElementById("days"), metaEl = document.getElementById("meta"), announce = document.getElementById("announce");
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var HOOPS = CFG.key === "basketball";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(p, d) { return p == null || isNaN(p) ? "–" : (p * 100).toFixed(d == null ? 0 : d) + "%"; }
  function odd(o) { return o == null || !isFinite(o) ? "–" : (+o).toFixed(2); }
  function sgn(x) { return (x > 0 ? "+" : "") + x; }
  function time(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function dateLong(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }); }
  function stamp(iso) { return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function plural(n, a, b) { return n + " " + (n === 1 ? a : (b || a + "s")); }
  function status(g) {
    var now = Date.now(), ko = new Date(g.start).getTime();
    if (g.result) return { label: "Final " + g.result.home + "-" + g.result.away + (g.result.ot ? " (" + g.result.ot + ")" : ""), cls: "plain" };
    if (now >= ko + CFG.length * 60000) return { label: "Finished", cls: "plain" };
    if (now >= ko) return { label: "Live", cls: "bad" };
    if (now >= ko - 60 * 60000) return { label: HOOPS ? "Starters due" : "Goalies due", cls: "warn" };
    return { label: time(g.start), cls: "plain" };
  }
  function confChip(c) { var cls = { Strong: "good", Lean: "good", "Fair price": "warn", Thin: "plain" }[c] || "plain"; return '<span class="chip ' + cls + '">' + esc(c) + "</span>"; }
  function gradeChip(g, title) { var cls = { Bet: "good", Lean: "warn", Skip: "plain" }[g] || "plain"; return '<span class="chip ' + cls + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + esc(g) + "</span>"; }
  function edgeTxt(ev) { return ev == null ? "model only" : "edge " + (ev >= 0 ? "+" : "") + (ev * 100).toFixed(1) + "%"; }
  function f1(x) { return x == null ? "–" : x.toFixed(1); }
  function nm(g, s) { return g[s].short || g[s].name; }

  function tile(g, r) {
    var t = r.picks.top, st = status(g);
    var head = '<div class="ko"><span>' + esc(g.league) + '</span><span class="chip ' + st.cls + '">' + esc(st.label) + "</span></div><div class=\"teams\">" + esc(g.away.name) + " @ " + esc(g.home.name) + "</div>";
    if (!t) return '<a class="tile" href="#' + esc(g.id) + '" style="border-top-color:var(--warn)">' + head + '<div class="pick nobet">No bet</div><div class="row"><span>Every price is at or shorter than fair. Try Live mode once it starts.</span></div></a>';
    return '<a class="tile" href="#' + esc(g.id) + '">' + head + '<div class="pick">' + esc(t.label) + "</div>" +
      '<div class="row"><span>Model ' + pct(t.p) + '</span><span class="price num">' + odd(t.odds) + "</span></div>" +
      '<div class="row"><span>' + edgeTxt(t.ev).replace(/^e/, "E") + "</span>" + confChip(t.confidence) + "</div></a>";
  }
  function topBet(r) {
    var t = r.picks.top;
    if (!t) return '<div class="topbet" style="background:var(--warn-bg);border-color:var(--warn)"><div><div class="lab" style="color:var(--warn)">Best bet</div><div class="what">No bet</div></div><div class="nums" style="max-width:46ch">' + esc(r.picks.noBet) + "</div></div>";
    return '<div class="topbet"><div><div class="lab">Best bet</div><div class="what">' + esc(t.label) + '</div></div><div class="nums num">@ ' + odd(t.odds) + " · chance " + pct(t.p) + " · fair " + odd(t.fair) + " · " + confChip(t.confidence) + "</div></div>";
  }
  function slipTable(r) {
    var rows = r.picks.slip.map(function (s) {
      return '<tr><td><span class="market">' + esc(s.market) + '</span><br><span class="pickname">' + esc(s.pick) + '</span></td><td class="r num">' + pct(s.p) + '</td><td class="r num">' + odd(s.odds) + '</td><td class="r num">' + odd(s.fair) + '</td><td class="r">' + gradeChip(s.grade, edgeTxt(s.ev)) + "</td></tr>";
    }).join("");
    return '<div class="tablewrap"><table><thead><tr><th>Pick</th><th class="r">Chance</th><th class="r">Odds</th><th class="r">Fair</th><th class="r">Verdict</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function probBar(g, r) {
    var mk = r.markets;
    if (HOOPS) return '<div class="probbar"><div class="bar num" role="img" aria-label="Model: ' + esc(g.home.name) + " " + pct(mk.home) + ", " + esc(g.away.name) + " " + pct(mk.away) + '"><div class="h" style="width:' + (mk.home * 100).toFixed(1) + '%">' + pct(mk.home) + '</div><div class="a" style="width:' + (mk.away * 100).toFixed(1) + '%">' + pct(mk.away) + '</div></div><div class="barlegend num"><span>Model: home · away</span></div></div>';
    return '<div class="probbar"><div class="bar num" role="img" aria-label="Model after 60 minutes: ' + esc(g.home.name) + " " + pct(mk.regHome) + ", tied " + pct(mk.regDraw) + ", " + esc(g.away.name) + " " + pct(mk.regAway) + '"><div class="h" style="width:' + (mk.regHome * 100).toFixed(1) + '%">' + pct(mk.regHome) + '</div><div class="d" style="width:' + (mk.regDraw * 100).toFixed(1) + '%">' + pct(mk.regDraw) + '</div><div class="a" style="width:' + (mk.regAway * 100).toFixed(1) + '%">' + pct(mk.regAway) + '</div></div><div class="barlegend num"><span>After 60 minutes: home · tied (overtime) · away</span><span>Incl. OT: ' + pct(mk.home) + " · " + pct(mk.away) + "</span></div></div>";
  }
  function modelPanel(g, r) {
    var H = nm(g, "home"), A = nm(g, "away");
    if (HOOPS) {
      var L = r.league, rows = [], fm = Math.round(r.margin * 2) / 2, ft = Math.round(r.total * 2) / 2;
      var favHome = r.margin >= 0, fav = favHome ? H : A, und = favHome ? A : H, mu = Math.abs(r.margin);
      [1, 4, 6, 8, 11].forEach(function (n) {
        var p = 1 - E._Phi((n - 0.5 - mu) / L.sigM);
        rows.push("<tr><td>" + esc(fav) + " win by " + n + '+</td><td class="r num">' + pct(p) + '</td><td class="r num">' + odd(1 / p) + "</td></tr>");
      });
      var pDog = E._Phi(-mu / L.sigM); rows.push("<tr><td>" + esc(und) + ' win</td><td class="r num">' + pct(pDog) + '</td><td class="r num">' + odd(1 / pDog) + "</td></tr>");
      var trows = [-10, -5, 0, 5, 10].map(function (d) { var l = Math.floor(ft + d) + 0.5, p = 1 - E._Phi((l - r.total) / L.sigT); return "<tr><td>Over " + l + '</td><td class="r num">' + pct(p) + '</td><td class="r num">' + odd(1 / p) + '</td><td class="r num">' + odd(1 / (1 - p)) + "</td></tr>"; }).join("");
      return '<div class="panel"><h3>Model <small>projected score ' + Math.round(r.xs.home) + "–" + Math.round(r.xs.away) + "</small></h3>" +
        '<p class="refnote" style="margin-top:0">Fair line ' + esc(H) + " " + sgn(-fm) + " · fair total " + ft + " · 1st half " + esc(H) + " " + sgn(-Math.round(r.h1.muM * 2) / 2) + ", total " + Math.round(r.h1.muT * 2) / 2 + ". Built from " + esc(r.basis.join(", ") || "form only") + ".</p>" +
        '<div class="tablewrap"><table><thead><tr><th>Winning margin</th><th class="r">Chance</th><th class="r">Fair</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>" +
        '<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Total points</th><th class="r">Over</th><th class="r">Over fair</th><th class="r">Under fair</th></tr></thead><tbody>' + trows + "</tbody></table></div></div>";
    }
    var mk = r.markets;
    var cs = mk.correctScores.map(function (c) { return '<div class="cs"><div class="s num">' + esc(c.score) + '</div><div class="p num">' + pct(c.p, 1) + " · " + odd(1 / c.p) + "</div></div>"; }).join("");
    var tl = Object.keys(mk.over).map(function (L) { var p = mk.over[L]; return "<tr><td>Over " + L + '</td><td class="r num">' + pct(p) + '</td><td class="r num">' + odd(1 / p) + '</td><td class="r num">' + odd(1 / (1 - p)) + "</td></tr>"; }).join("");
    return '<div class="panel"><h3>Model <small>expected goals ' + r.xg.home.toFixed(2) + " – " + r.xg.away.toFixed(2) + "</small></h3>" +
      '<p class="refnote" style="margin-top:0">Overtime ' + pct(mk.ot) + " · both teams score " + pct(mk.btts) + " · " + esc(H) + " −1.5 " + pct(mk.puckHome) + " · " + esc(A) + " −1.5 " + pct(mk.puckAway) + ". Totals and puck lines include OT and the shootout.</p>" +
      '<div class="csgrid">' + cs + "</div>" +
      '<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Total goals</th><th class="r">Over</th><th class="r">Over fair</th><th class="r">Under fair</th></tr></thead><tbody>' + tl + "</tbody></table></div></div>";
  }
  function playersPanel(g, r) {
    var H = nm(g, "home"), A = nm(g, "away");
    var list = r.players.slice(0, 12), rows;
    if (HOOPS) rows = list.map(function (p) { return "<tr><td><span class=\"pickname\">" + esc(p.name) + '</span><br><span class="market">' + esc(p.side === "home" ? H : A) + (p.status ? " · " + esc(p.status) : "") + (p.av > 0 && p.av < 1 ? " · " + pct(p.av) + " to play" : "") + '</span></td><td class="r num">' + f1(p.pts) + '</td><td class="r num">' + f1(p.reb) + '</td><td class="r num">' + f1(p.ast) + '</td><td class="r num">' + f1(p.threes) + "</td></tr>"; }).join("");
    else rows = list.map(function (p) { return "<tr><td><span class=\"pickname\">" + esc(p.name) + '</span><br><span class="market">' + esc(p.side === "home" ? H : A) + (p.status ? " · " + esc(p.status) : "") + '</span></td><td class="r num">' + pct(p.scorer) + '</td><td class="r num">' + pct(p.point) + '</td><td class="r num">' + p.sog.toFixed(1) + "</td></tr>"; }).join("");
    var head = HOOPS ? "<th>Player <small>if he plays</small></th><th class=\"r\">Pts</th><th class=\"r\">Reb</th><th class=\"r\">Ast</th><th class=\"r\">3PM</th>" : "<th>Player</th><th class=\"r\">Goal</th><th class=\"r\">Point</th><th class=\"r\">Shots</th>";
    var props = r.props.map(function (p) {
      return "<tr><td><span class=\"pickname\">" + esc(p.player) + '</span><br><span class="market" style="text-transform:none">' + esc(p.market) + (p.hitRate ? " · last games: " + esc(p.hitRate) : "") + '</span></td><td class="r num">' + odd(p.odds) + '</td><td class="r num">' + pct(p.need) + '</td><td class="r num">' + pct(p.p) + '</td><td class="r">' + gradeChip(p.grade, (p.basis || "") + (p.ev != null ? ", " + edgeTxt(p.ev) : "")) + "</td></tr>";
    }).join("");
    return '<div class="panel"><h3>Players <small>' + (HOOPS ? "projected for this game" : "chance in the game · shots on goal") + "</small></h3>" +
      '<div class="tablewrap"><table><thead><tr>' + head + "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
      (props ? '<h3 style="margin-top:16px">Player props <small>price needs vs. model chance</small></h3><div class="tablewrap"><table><thead><tr><th>Prop</th><th class="r">Odds</th><th class="r">Needs</th><th class="r">Model</th><th class="r">Verdict</th></tr></thead><tbody>' + props + "</tbody></table></div>" : "") + "</div>";
  }
  function newsPanel(g) {
    var H = nm(g, "home"), A = nm(g, "away"), lu = g.lineups || {};
    var lineup = function (side) {
      var x = lu[side]; if (!x || !x.length) return '<p class="refnote">' + (HOOPS ? "Starters" : "Goalie") + " not announced yet.</p>";
      return '<p style="margin:4px 0 0">' + x.map(esc).join(", ") + "</p>";
    };
    var news = (g.news || []).map(function (n) { return "<li><b>" + esc(n.team === "home" ? H : n.team === "away" ? A : "") + "</b> " + esc(n.text) + (n.src ? ' <span class="market">' + esc(n.src) + "</span>" : "") + "</li>"; }).join("");
    var conf = lu.status === "confirmed";
    return '<div class="panel full"><h3>' + (HOOPS ? "Starting five" : "Starting goalies") + ' <small><span class="chip ' + (conf ? "good" : "plain") + '">' + (conf ? "Confirmed" : "Expected") + "</span></small></h3>" +
      '<div class="lout" style="margin-top:6px"><div><h4>' + esc(g.home.name) + "</h4>" + lineup("home") + "</div><div><h4>" + esc(g.away.name) + "</h4>" + lineup("away") + "</div></div>" +
      (news ? '<h3 style="margin-top:14px">Team news</h3><ul class="news">' + news + "</ul>" : "") + "</div>";
  }
  function card(g, r) {
    var st = status(g), b = r.picks.builder;
    var proj = HOOPS ? ["Projected", Math.round(r.xs.home), Math.round(r.xs.away)] : ["Expected goals", r.xg.home.toFixed(2), r.xg.away.toFixed(2)];
    return '<section class="match" id="' + esc(g.id) + '" aria-labelledby="t-' + esc(g.id) + '">' +
      '<div class="mhead"><span>' + esc(g.league) + (g.venue ? " · " + esc(g.venue) : "") + '</span><span class="chips"><span class="chip ' + st.cls + '"><span class="dot"></span>' + esc(st.label) + "</span></span></div>" +
      '<div class="scoreline"><div class="team"><span class="name" id="t-' + esc(g.id) + '">' + esc(g.home.name) + '</span><span class="xg">' + proj[0] + ' <b class="num">' + proj[1] + '</b></span></div><span class="vs">' + time(g.start) + '</span><div class="team away"><span class="name">' + esc(g.away.name) + '</span><span class="xg">' + proj[0] + ' <b class="num">' + proj[2] + "</b></span></div></div>" +
      probBar(g, r) + '<p class="context">' + esc(g.context || "") + "</p>" +
      '<div class="mbody">' + livePanel(g) +
        '<div class="panel"><h3>Bet slip <small>one pick per market</small></h3>' + topBet(r) + slipTable(r) +
          (r.picks.value && r.picks.value.ev > 0 ? '<div class="builder"><b>Value shot:</b> ' + esc(r.picks.value.label) + ' <span class="num">@ ' + odd(r.picks.value.odds) + " · chance " + pct(r.picks.value.p) + " · edge +" + (r.picks.value.ev * 100).toFixed(1) + "%</span></div>" : "") +
          (b ? '<div class="builder"><b>Bet builder:</b> ' + b.legs.map(esc).join(" + ") + ' <span class="num">· chance ' + pct(b.p) + " · fair odds " + odd(b.fair) + "</span></div>" : "") + "</div>" +
        modelPanel(g, r) + newsPanel(g) + playersPanel(g, r) +
      "</div>" +
      '<div class="sources"><b>Sources</b>' + (g.sources || []).map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>"; }).join("") + (g.odds && g.odds.book ? "<span>Odds: " + esc(g.odds.book) + "</span>" : "") + "</div></section>";
  }

  // ---------- live ----------
  var FIELDS = HOOPS
    ? [["period", "Quarter (5 = OT)", 1], ["clock", "Time left (m:ss)", 1, "text"], ["home", "Points", 2], ["liveSpread", "Live line (home)", 1, "text"], ["liveTotal", "Live total", 1, "text"]]
    : [["period", "Period (4 = OT)", 1], ["minute", "Minute of period", 1], ["home", "Goals", 2], ["sogHome", "Shots on goal", 2]];
  function livePanel(g) {
    var st = status(g), isLive = st.label === "Live";
    var inputs = FIELDS.map(function (f) {
      var k = f[0], k2 = k === "home" ? "away" : k.replace("Home", "Away"), type = f[3] || "number";
      var lab = f[1] + (f[2] === 2 ? " <span>" + esc(g.home.code || "H") + " · " + esc(g.away.code || "A") + "</span>" : "");
      var inp = function (key, aria) { return '<input type="' + type + '"' + (type === "number" ? ' min="0" inputmode="numeric"' : ' inputmode="decimal"') + ' autocomplete="off" name="' + esc(g.id + "-" + key) + '" data-k="' + key + '" aria-label="' + esc(aria) + '">'; };
      return "<label>" + lab + '<span class="pair">' + inp(k, f[1] + (f[2] === 2 ? " " + g.home.name : "")) + (f[2] === 2 ? inp(k2, f[1] + " " + g.away.name) : "") + "</span></label>";
    }).join("");
    return '<details class="panel live" data-live="' + esc(g.id) + '"' + (isLive ? " open" : "") + '><summary>Live mode <small>picks re-priced from the score and the clock</small><span class="chip ' + (isLive ? "bad" : "plain") + '" data-feed><span class="dot"></span>' + (isLive ? "Connecting…" : "Not started") + "</span></summary>" +
      '<div class="lform">' + inputs + "</div>" +
      '<div class="lbar"><button type="button" class="btn" data-act="calc">Update Picks</button><button type="button" class="btn ghost" data-act="feed">Pull Live Score</button><span data-msg aria-live="polite">' + (HOOPS ? "Quarter, time left and score are enough. Add the bookmaker's live line or total to price them directly." : "Period, minute and score are enough. Shots on goal sharpen it.") + "</span></div>" +
      '<div class="lout" data-out></div></details>';
  }
  function readState(box) { var st = {}; box.querySelectorAll("input[data-k]").forEach(function (i) { if (i.value !== "") st[i.dataset.k] = i.type === "number" ? +i.value : i.value; }); return st; }
  function writeState(box, st) { box.querySelectorAll("input[data-k]").forEach(function (i) { var v = st[i.dataset.k]; if (v != null && document.activeElement !== i) i.value = v; }); }
  function renderLive(box, g, st) {
    var out = box.querySelector("[data-out]");
    if (st.period == null && st.home == null) { out.innerHTML = ""; return; }
    var L = E.live(g, st), mk = L.markets, H = nm(g, "home"), A = nm(g, "away");
    var picks = L.picks.length ? L.picks.map(function (p) { return '<div class="livepick"><div><b>' + esc(p.label) + '</b><br><span class="market">' + esc(p.group) + " · chance " + pct(p.p) + '</span></div><div class="take num">take at<b>' + odd(p.takeAt) + "</b>or better</div></div>"; }).join("") : '<p class="nobet">Nothing between 60% and 90% right now. Wait for the next swing.</p>';
    var checks = (L.checks || []).map(function (c) { return "<tr><td>" + esc(c.label) + '</td><td class="r num">' + pct(c.p) + '</td><td class="r num" colspan="2">fair ' + odd(c.fair) + "</td></tr>"; }).join("");
    var overs = Object.keys(mk.over).map(function (k) { var p = mk.over[k]; return "<tr><td>Over " + k + '</td><td class="r num">' + pct(p) + '</td><td class="r num">' + odd(1 / p) + '</td><td class="r num">' + odd(1 / (1 - p)) + "</td></tr>"; }).join("");
    var now = HOOPS
      ? '<tr><td>Projected final</td><td class="r num" colspan="3">' + Math.round(mk.projScore[0]) + "–" + Math.round(mk.projScore[1]) + " · " + Math.round(L.minutesLeft * 10) / 10 + " min left</td></tr>"
      : '<tr><td>After 60 min: ' + esc(H) + " · tied · " + esc(A) + '</td><td class="r num" colspan="3">' + pct(mk.regHome) + " · " + pct(mk.regDraw) + " · " + pct(mk.regAway) + "</td></tr>" +
        '<tr><td>Next goal ' + esc(H) + " · none · " + esc(A) + '</td><td class="r num" colspan="3">' + pct(mk.nextGoal.home) + " · " + pct(mk.nextGoal.none) + " · " + pct(mk.nextGoal.away) + "</td></tr>";
    out.innerHTML = "<div><h4>Live picks · " + L.score.join("-") + "</h4>" + picks + '<p class="refnote">Only take a pick at the "take at" price or better (fair odds plus 5%). Re-check after every run or goal.</p></div>' +
      '<div><h4>Now</h4><div class="tablewrap"><table><tbody><tr><td>' + esc(H) + " win · " + esc(A) + ' win</td><td class="r num" colspan="3">' + pct(mk.home) + " · " + pct(mk.away) + "</td></tr>" + now + checks +
      '<tr><th>Final total</th><th class="r">Over</th><th class="r">Over fair</th><th class="r">Under fair</th></tr>' + overs + "</tbody></table></div></div>";
  }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, ""); }
  function sameTeam(a, b) { a = norm(a); b = norm(b); return a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0; }
  function feedSlug(g) { if (g.espn) return g.espn; var l = String(g.league || ""); return /^NBA/i.test(l) ? "basketball/nba" : /WNBA/i.test(l) ? "basketball/wnba" : /^NHL/i.test(l) ? "hockey/nhl" : null; }
  function fetchFeed(g) {
    var slug = feedSlug(g); if (!slug) return Promise.reject(new Error("no free feed for " + g.league));
    var d = new Date(new Date(g.start).getTime() - 6 * 3600000), ymd = d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, "0") + String(d.getUTCDate()).padStart(2, "0"); // US date
    return fetch("https://site.api.espn.com/apis/site/v2/sports/" + slug + "/scoreboard?dates=" + ymd, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error("feed " + r.status); return r.json(); }).then(function (j) {
      var ev = (j.events || []).filter(function (e) { var t = ((e.competitions || [])[0] || {}).competitors || []; var h = t.filter(function (x) { return x.homeAway === "home"; })[0], a = t.filter(function (x) { return x.homeAway === "away"; })[0]; return h && a && sameTeam(h.team.displayName, g.home.name) && sameTeam(a.team.displayName, g.away.name); })[0];
      if (!ev) throw new Error("game not in feed");
      var c = ev.competitions[0], h = c.competitors.filter(function (x) { return x.homeAway === "home"; })[0], a = c.competitors.filter(function (x) { return x.homeAway === "away"; })[0];
      var s = ev.status || {}, type = s.type || {}, st = { home: +h.score || 0, away: +a.score || 0, period: s.period || 1, finished: type.state === "post", state: type.state, detail: type.shortDetail || "" };
      var clk = String(s.displayClock || "0:00"), parts = clk.split(":"), left = +parts[0] + (+parts[1] || 0) / 60;
      if (HOOPS) st.clock = clk; else st.minute = Math.max(0, Math.round((20 - left) * 10) / 10);
      if (!HOOPS) { var sh = (h.statistics || []).filter(function (x) { return x.name === "shotsTotal" || x.name === "shots"; })[0], sa = (a.statistics || []).filter(function (x) { return x.name === "shotsTotal" || x.name === "shots"; })[0]; if (sh && sa) { st.sogHome = +sh.displayValue; st.sogAway = +sa.displayValue; } }
      return st;
    });
  }
  function wireLive(byId) {
    document.querySelectorAll("[data-live]").forEach(function (box) {
      var g = byId[box.dataset.live], chip = box.querySelector("[data-feed]"), msg = box.querySelector("[data-msg]"), timer = null;
      function setChip(t, cls) { chip.className = "chip " + cls; chip.innerHTML = '<span class="dot"></span>' + esc(t); }
      function calc() { renderLive(box, g, readState(box)); }
      function pull(quiet) {
        return fetchFeed(g).then(function (st) {
          var manual = readState(box); ["liveSpread", "liveTotal"].forEach(function (k) { if (manual[k] != null) st[k] = manual[k]; });
          writeState(box, st); renderLive(box, g, st);
          setChip(st.finished ? "Final" : st.state === "pre" ? "Not started" : "Live feed · " + st.detail, st.state === "in" ? "bad" : "plain");
          msg.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + (st.state === "in" ? ". Refreshes every minute while open." : ".");
        }).catch(function (e) { setChip("Feed unavailable", "warn"); if (!quiet) msg.textContent = "Couldn't reach the free live feed (" + e.message + "). Type the clock and score and press Update Picks."; });
      }
      function loop() { clearInterval(timer); timer = setInterval(function () { if (box.open && !document.hidden) pull(true); }, 45000); }
      box.querySelector('[data-act="calc"]').addEventListener("click", calc);
      box.querySelector('[data-act="feed"]').addEventListener("click", function () { pull(false).then(loop); });
      box.querySelectorAll("input").forEach(function (i) { i.addEventListener("change", calc); });
      box.addEventListener("toggle", function () { if (box.open && status(g).label === "Live") pull(true).then(loop); });
      if (box.open) pull(true).then(loop);
    });
  }

  // ---------- track record ----------
  function trackRecord(rec) {
    if (!rec || !rec.legs || !rec.legs.length) return '<div class="section-title" id="track"><h2>Track record</h2><p>Picks are graded each morning. This fills up after the first ' + CFG.key + " day is settled; each market reacts once it has 8 graded picks.</p></div>";
    var g = E.trackStats(rec.legs), keys = Object.keys(g).sort(function (a, b) { return g[b].n - g[a].n; });
    var all = rec.legs.filter(function (l) { return l.won != null; }), wins = all.filter(function (l) { return l.won; }).length;
    var rows = keys.map(function (k) { var s = g[k]; return "<tr><td>" + esc(k) + '</td><td class="r num">' + s.wins + "/" + s.n + '</td><td class="r num">' + pct(s.meanP) + '</td><td class="r num"><b style="color:var(' + (s.hit >= s.meanP ? "--good" : "--bad") + ')">' + pct(s.hit) + '</b></td><td class="r num">' + (s.roi == null ? "–" : (s.roi >= 0 ? "+" : "") + (s.roi * 100).toFixed(0) + "%") + "</td></tr>"; }).join("");
    return '<div class="section-title" id="track"><h2>Track record</h2><p>' + wins + " of " + all.length + " graded picks landed.</p></div>" +
      '<div class="match track"><div class="panel full"><div class="tablewrap"><table><thead><tr><th>Market</th><th class="r">Won</th><th class="r">Model said</th><th class="r">Landed</th><th class="r">Return at 1 unit</th></tr></thead><tbody>' + rows + "</tbody></table></div></div></div>";
  }

  var RECORD = null;
  function render(day) {
    var list = (day.games || []).map(function (g) { return { g: g, r: E.analyse(g) }; }).sort(function (a, b) { return new Date(a.g.start) - new Date(b.g.start); });
    metaEl.innerHTML = esc(dateLong(day.date)) + " · updated " + esc(stamp(day.updated)) + '<br><span class="num">Times shown in ' + esc(tz) + "</span>";
    app.innerHTML = (list.length
      ? '<div class="section-title"><h2>Best bets</h2><p>' + esc(day.updateNote || "") + '</p></div><div class="slipgrid">' + list.map(function (x) { return tile(x.g, x.r); }).join("") + "</div>" +
        '<div class="section-title"><h2>Games</h2><p>' + plural(list.length, "game") + "</p></div>" + list.map(function (x) { return card(x.g, x.r); }).join("")
      : '<p class="err" style="background:var(--warn-bg);color:var(--warn)">No ' + CFG.key + " games on this day yet. The morning update adds them.</p>") + trackRecord(RECORD);
    announce.textContent = "Showing " + plural(list.length, "game") + " for " + dateLong(day.date) + ".";
    var byId = {}; list.forEach(function (x) { byId[x.g.id] = x.g; }); wireLive(byId);
    if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); }
  }
  function loadDay(entry, buttons, push) {
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.date === entry.date ? "true" : "false"); });
    if (push) { try { history.replaceState(null, "", "?day=" + entry.date); } catch (e) { /* sandboxed */ } }
    return fetch(CFG.data + entry.file, { cache: "no-store" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(render)
      .catch(function () { app.innerHTML = '<div class="err">Could not load the games for ' + esc(entry.date) + ". Reload, or pick another day above.</div>"; });
  }
  fetch(CFG.data + "results.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    .then(function (rec) { RECORD = rec; if (rec) E.setCalibration(E.trackStats(rec.legs)); return fetch(CFG.data + "index.json", { cache: "no-store" }); })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (idx) {
      var all = idx.days.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }), days = all.slice(0, 7);
      var buttons = days.map(function (d) { var b = document.createElement("button"); b.type = "button"; b.dataset.date = d.date; b.textContent = new Date(d.date + "T12:00:00Z").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }); b.addEventListener("click", function () { loadDay(d, buttons, true); }); daysEl.appendChild(b); return b; });
      var want = null; try { want = new URLSearchParams(location.search).get("day"); } catch (e) { /* old browser */ }
      return loadDay(all.filter(function (d) { return d.date === want; })[0] || days[0], buttons, false);
    })
    .catch(function () { app.innerHTML = '<p class="err" style="background:var(--warn-bg);color:var(--warn)">No ' + CFG.key + " games published yet. The morning update adds them.</p>"; });
})();
