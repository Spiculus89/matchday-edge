/* Matchday Edge front end: fetches the day's data from this site's own /api routes
   (all cached on the CDN), turns it into engine inputs, runs the model and renders. */
(function () {
  "use strict";
  var E = window.BetEngine;
  var app = document.getElementById("app");
  var daysEl = document.getElementById("days");
  var metaEl = document.getElementById("meta");
  var bannerEl = document.getElementById("banner");
  var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  var NATIONAL_LEAGUES = [1, 4, 5, 9, 10, 32, 960];
  var REFRESH_MS = 5 * 60 * 1000;
  var current = null, timer = null, busy = false;

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pct(p, d) { return p == null ? "–" : (p * 100).toFixed(d == null ? 0 : d) + "%"; }
  function odd(o) { return o == null || !isFinite(o) ? "–" : (+o).toFixed(2); }
  function time(iso) { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function stamp(iso) { return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function ymd(d) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  function code(name) { var w = String(name || "").replace(/[^A-Za-zÀ-ž ]/g, "").trim().split(/\s+/); return (w.length > 1 && w[0].length <= 3 ? w[1] : w[0]).slice(0, 3).toUpperCase(); }
  function getJson(url) {
    return fetch(url).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) { var e = new Error(b.error || ("HTTP " + r.status)); e.code = b.code; e.status = r.status; throw e; } return b; });
    });
  }
  // A team's averages in this competition, pulled toward 1.35 goals a game by sample size:
  // four games of Nations League form should nudge the model, not overrule the market.
  function formFrom(h, a) {
    function shrink(v, n) { return (n * v + 8 * 1.35) / (n + 8); }
    if (!h || !a || h.gf == null || a.gf == null || h.ga == null || a.ga == null || h.played < 2 || a.played < 2) return null;
    return { home: { gf: shrink(h.gf, h.played), ga: shrink(h.ga, h.played) }, away: { gf: shrink(a.gf, a.played), ga: shrink(a.ga, a.played) } };
  }
  function soft(p) { return p.then(function (v) { return { ok: true, v: v }; }, function (e) { return { ok: false, e: e }; }); }
  function posCode(p) { return { G: "GK", D: "DF", M: "MF", F: "FW", Goalkeeper: "GK", Defender: "DF", Midfielder: "MF", Attacker: "FW" }[p] || "MF"; }
  function samePlayer(a, b) {
    function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim(); }
    var x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y) return true;
    var xs = x.split(" "), ys = y.split(" ");
    return xs[xs.length - 1] === ys[ys.length - 1] && xs[0][0] === ys[0][0];
  }

  // ---------- data assembly ----------
  function load(date) {
    if (busy) return Promise.resolve();
    busy = true;
    var btn = document.getElementById("refresh"); if (btn) btn.disabled = true;
    return getJson("/api/fixtures?date=" + date).then(function (fx) {
      if (!fx.matches.length) { current = { date: date, fx: fx, matches: [] }; render(); return; }
      var ids = fx.matches.map(function (m) { return m.fixtureId; }).join("-");
      var leagues = {};
      fx.matches.forEach(function (m) { leagues[m.league.id + ":" + m.league.season] = m.league; });
      var live = soft(getJson("/api/live?ids=" + ids));
      var scorers = {};
      Object.keys(leagues).forEach(function (k) { var L = leagues[k]; scorers[k] = soft(getJson("/api/scorers?league=" + L.id + "&season=" + L.season)); });
      var per = fx.matches.map(function (m) {
        var national = NATIONAL_LEAGUES.indexOf(m.league.id) >= 0 || m.league.country === "World";
        return Promise.all([
          soft(getJson("/api/odds?fixture=" + m.fixtureId)),
          soft(getJson("/api/teams?league=" + m.league.id + "&season=" + m.league.season + "&ids=" + m.home.id + "," + m.away.id)),
          m.venue && m.venue.city ? soft(getJson("/api/weather?city=" + encodeURIComponent(m.venue.city) + "&time=" + encodeURIComponent(m.kickoff))) : Promise.resolve({ ok: false }),
          soft(getJson("/api/news?team=" + encodeURIComponent(m.home.name) + (national ? "&national=1" : ""))),
          soft(getJson("/api/news?team=" + encodeURIComponent(m.away.name) + (national ? "&national=1" : "")))
        ]);
      });
      return Promise.all([live, Promise.all(per), Promise.all(Object.keys(scorers).map(function (k) { return scorers[k].then(function (r) { return [k, r]; }); }))])
        .then(function (all) {
          var liveR = all[0], perR = all[1], sc = {};
          all[2].forEach(function (kv) { sc[kv[0]] = kv[1]; });
          var matches = fx.matches.map(function (m, i) { return build(m, liveR, perR[i], sc[m.league.id + ":" + m.league.season]); });
          current = { date: date, fx: fx, live: liveR, matches: matches, loaded: new Date().toISOString() };
          render();
        });
    }).catch(function (e) {
      if (e.code === "no_key") { showSetup(); return; }
      if (current && current.date === date) { banner("bad", "Could not refresh: " + e.message + " Showing the last data loaded."); return; }
      app.innerHTML = '<div class="err">Could not load the matches: ' + esc(e.message) + "</div>";
    }).then(function () { busy = false; var b = document.getElementById("refresh"); if (b) b.disabled = false; });
  }

  function build(m, liveR, per, scorersR) {
    var errors = [];
    var lv = liveR.ok ? (liveR.v.fixtures || []).filter(function (f) { return f.fixtureId === m.fixtureId; })[0] : null;
    if (!liveR.ok) errors.push("Lineups and injuries: " + liveR.e.message);
    var fx = lv || m;
    var injuries = liveR.ok ? (liveR.v.injuries || []).filter(function (x) { return x.fixtureId === m.fixtureId; }) : [];
    var oddsR = per[0], teamsR = per[1], wxR = per[2], newsH = per[3], newsA = per[4];
    var odds = oddsR.ok && oddsR.v.odds ? oddsR.v.odds : null;
    if (!oddsR.ok) errors.push("Odds: " + oddsR.e.message); else if (!odds) errors.push("No bookmaker odds yet");
    var teams = teamsR.ok ? teamsR.v.teams : [];
    if (!teamsR.ok) errors.push("Team stats: " + teamsR.e.message);
    var tH = teams.filter(function (t) { return t.id === m.home.id; })[0] || {}, tA = teams.filter(function (t) { return t.id === m.away.id; })[0] || {};
    var allScorers = scorersR && scorersR.ok ? scorersR.v.players : [];

    // Lineups: confirmed from the team sheet, otherwise last XI minus injured/suspended players
    var out = {}, doubt = {};
    injuries.forEach(function (x) { var k = x.player.id || x.player.name; if (/question/i.test(x.type || "")) doubt[k] = x; else out[k] = x; });
    function isOut(p) { return injuries.some(function (x) { return !/question/i.test(x.type || "") && (x.player.id && x.player.id === p.id || samePlayer(x.player.name, p.name)); }); }
    function isDoubt(p) { return injuries.some(function (x) { return /question/i.test(x.type || "") && (x.player.id && x.player.id === p.id || samePlayer(x.player.name, p.name)); }); }
    var confirmed = fx.lineups && fx.lineups.home && fx.lineups.away;
    var L;
    if (confirmed) {
      L = { status: "confirmed", source: "Official team sheets via API-Football",
        home: { formation: fx.lineups.home.formation, xi: fx.lineups.home.xi.map(function (p) { return p.name; }), bench: fx.lineups.home.subs.map(function (p) { return p.name; }) },
        away: { formation: fx.lineups.away.formation, xi: fx.lineups.away.xi.map(function (p) { return p.name; }), bench: fx.lineups.away.subs.map(function (p) { return p.name; }) } };
    } else {
      function pred(t) {
        var ll = t.lastLineup; if (!ll) return { formation: "", xi: [], note: "No recent lineup" };
        return { formation: ll.formation, xi: ll.xi.map(function (p) { return isOut(p) ? "~" + p.name : isDoubt(p) ? p.name + " (doubt)" : p.name; }),
          note: "Last XI v " + (ll.opponent || "previous opponent") + (ll.date ? ", " + new Date(ll.date).toLocaleDateString([], { day: "numeric", month: "short" }) : "") };
      }
      var ph = pred(tH), pa = pred(tA);
      L = { status: "predicted", source: "Last starting XI minus injured and suspended players", home: ph, away: pa,
        alt: [m.home.name + ": " + ph.note, m.away.name + ": " + pa.note].join(" · ") + ". Crossed-out players are injured or suspended; their replacements are not known until the team sheet." };
    }

    // Players for the scorer model
    function teamPlayers(side, teamId, t) {
      var list = [], seen = {};
      function add(p) { var k = (p.name || "").toLowerCase(); if (!k || seen[k]) return; seen[k] = 1; list.push(p); }
      var conf = confirmed ? fx.lineups[side] : null;
      allScorers.filter(function (s) { return s.teamId === teamId; }).forEach(function (s) {
        var start, note = null;
        if (conf) {
          var inXI = conf.xi.some(function (p) { return p.id === s.id || samePlayer(p.name, s.name); });
          var onBench = conf.subs.some(function (p) { return p.id === s.id || samePlayer(p.name, s.name); });
          if (!inXI && !onBench) return; // not in the squad today
          start = inXI ? 1 : 0; if (!inXI) note = "On the bench";
        } else {
          if (isOut(s)) return;
          var inLast = t.lastLineup && t.lastLineup.xi.some(function (p) { return p.id === s.id || samePlayer(p.name, s.name); });
          start = isDoubt(s) ? 0.45 : inLast ? 0.85 : 0.4;
          note = isDoubt(s) ? "Fitness doubt" : inLast ? null : "Not in last XI";
        }
        add({ name: s.name, pos: posCode(s.pos), start: start, goals: s.goals, assists: s.assists, shots: s.shots, pens: s.pens > 0, note: note });
      });
      var xi = conf ? conf.xi : (t.lastLineup ? t.lastLineup.xi.filter(function (p) { return !isOut(p); }) : []);
      xi.forEach(function (p) { if (posCode(p.pos) !== "GK") add({ name: p.name, pos: posCode(p.pos), start: conf ? 1 : (isDoubt(p) ? 0.45 : 0.85) }); });
      return list;
    }
    var players = { home: teamPlayers("home", m.home.id, tH), away: teamPlayers("away", m.away.id, tA) };
    function totals(t) { var g = t.stats && t.stats.goalsTotal; return g ? { goals: g, shots: g * 9 } : {}; }

    var news = injuries.map(function (x) {
      var susp = /suspend|card/i.test(x.reason || "");
      return { team: x.teamId === m.home.id ? "home" : "away", tag: /question/i.test(x.type || "") ? "doubt" : "out",
        text: x.player.name + " · " + (x.reason || (susp ? "Suspended" : "Injured")) + (/question/i.test(x.type || "") ? " (doubtful)" : ""), src: "API-Football" };
    });
    [[newsH, "home"], [newsA, "away"]].forEach(function (pair) {
      var r = pair[0]; if (!r.ok) return;
      (r.v.items || []).slice(0, 4).forEach(function (it) { news.push({ team: pair[1], tag: it.tag === "lineup" ? "info" : it.tag, text: it.title, src: it.source || "Google News", url: it.link, when: it.published }); });
    });

    var formTxt = function (t) { return t.stats && t.stats.form ? t.stats.form.slice(-5).split("").join("") : null; };
    var ctx = [];
    if (formTxt(tH) || formTxt(tA)) ctx.push("Form in this competition: " + m.home.name + " " + (formTxt(tH) || "–") + ", " + m.away.name + " " + (formTxt(tA) || "–") + ".");
    if (tH.stats && tA.stats && tH.stats.gf != null && tA.stats.gf != null) ctx.push("Goals per game this season: " + m.home.name + " " + tH.stats.gf.toFixed(1) + " for / " + (tH.stats.ga != null ? tH.stats.ga.toFixed(1) : "–") + " against, " + m.away.name + " " + tA.stats.gf.toFixed(1) + " / " + (tA.stats.ga != null ? tA.stats.ga.toFixed(1) : "–") + ".");

    var refName = fx.referee ? String(fx.referee).split(",")[0] : null, refCountry = fx.referee && String(fx.referee).split(",")[1];
    var wx = wxR.ok && wxR.v.found ? wxR.v : null;
    var match = {
      id: "fx" + m.fixtureId, fixtureId: m.fixtureId,
      competition: m.league.name + (m.league.round ? " · " + m.league.round.replace(/Regular Season - /, "Matchday ") : ""),
      kickoff: fx.kickoff || m.kickoff, venue: [m.venue.name, m.venue.city].filter(Boolean).join(", "), neutral: false,
      home: { name: m.home.name, short: m.home.name, code: code(m.home.name), id: m.home.id },
      away: { name: m.away.name, short: m.away.name, code: code(m.away.name), id: m.away.id },
      status: fx.status, goals: fx.goals, events: (lv && lv.events) || [],
      context: ctx.join(" "),
      referee: { name: refName || "Not announced", country: refCountry ? refCountry.trim() : "", games: 0,
        note: refName ? "The free data feed has no referee card history, so cards use the bookmaker line or both teams' card averages." : "The referee is usually confirmed a day or two before kick-off." },
      odds: odds || {},
      form20: formFrom(tH.stats, tA.stats),
      teamStats: { home: tH.stats || null, away: tA.stats || null },
      teamTotals: { home: totals(tH), away: totals(tA) },
      lineups: L, news: news, players: players, weather: wx,
      errors: errors,
      sources: [{ title: "API-Football", url: "https://www.api-football.com" }].concat(wx ? [{ title: "Open-Meteo forecast", url: "https://open-meteo.com" }] : [])
    };
    return match;
  }

  // ---------- rendering ----------
  function status(m) {
    var s = m.status || {}, sh = s.short;
    if (["FT", "AET", "PEN"].indexOf(sh) >= 0) return { label: "Full time " + m.goals.home + "-" + m.goals.away, cls: "plain", score: true };
    if (["1H", "2H", "ET", "BT", "P", "LIVE", "INT"].indexOf(sh) >= 0) return { label: "Live " + (s.elapsed ? s.elapsed + "'" : ""), cls: "bad", score: true };
    if (sh === "HT") return { label: "Half time", cls: "bad", score: true };
    if (["PST", "CANC", "ABD", "SUSP"].indexOf(sh) >= 0) return { label: s.long || sh, cls: "warn" };
    var ko = new Date(m.kickoff).getTime();
    if (Date.now() >= ko - 75 * 60000 && Date.now() < ko) return { label: "Lineups due", cls: "warn" };
    return { label: "Kick-off " + time(m.kickoff), cls: "info" };
  }
  function confChip(c) { var map = { "Strong": "good", "Lean": "good", "Fair price": "warn", "Thin": "bad" }; return '<span class="chip ' + (map[c] || "plain") + '">' + esc(c) + "</span>"; }
  function evChip(row) {
    if (row.ev == null) return '<span class="chip plain">Model only</span>';
    var c = row.ev >= 0.04 && row.p >= 0.5 ? "Strong" : row.ev >= 0.015 ? "Lean" : row.ev >= -0.02 ? "Fair price" : "Thin";
    return confChip(c);
  }
  function pbar(p) { return '<span class="pbar" aria-hidden="true"><i style="width:' + Math.round(p * 100) + '%"></i></span>'; }

  function tile(m, r) {
    var t = r.picks.top || r.picks.slip[0];
    var st = status(m);
    if (!t) return "";
    return '<a class="tile" href="#' + esc(m.id) + '">' +
      '<div class="ko"><span>' + esc(m.competition) + '</span><span class="chip ' + st.cls + '">' + esc(st.label) + "</span></div>" +
      '<div class="teams">' + esc(m.home.name) + " v " + esc(m.away.name) + "</div>" +
      '<div class="pick">' + esc(t.label || t.pick) + "</div>" +
      '<div class="row"><span>Model ' + pct(t.p) + (t.odds && t.implied ? " · bookmaker " + pct(t.implied) : "") + '</span><span class="price num">' + odd(t.odds || t.fair) + "</span></div>" +
      '<div class="row"><span>' + (t.ev != null ? "Edge " + (t.ev >= 0 ? "+" : "") + (t.ev * 100).toFixed(1) + "%" : "Fair odds") + "</span>" + (t.confidence ? confChip(t.confidence) : "") + "</div></a>";
  }

  function slipTable(r) {
    var rows = r.picks.slip.map(function (s) {
      return '<tr><td class="market">' + esc(s.market) + '</td><td class="pickname">' + esc(s.pick) + (s.push ? ' <span class="market">push ' + pct(s.push) + "</span>" : "") +
        '</td><td class="r num">' + pbar(s.p) + pct(s.p) + '</td><td class="r num">' + odd(s.odds) + '</td><td class="r num">' + odd(s.fair) + '</td><td class="r">' + evChip(s) + "</td></tr>";
    }).join("");
    return '<div class="tablewrap"><table><thead><tr><th>Market</th><th>Pick</th><th class="r">Chance</th><th class="r">Odds</th><th class="r">Fair</th><th class="r">Edge</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function topBet(r) {
    var t = r.picks.top; if (!t) return '<p class="alt">No bookmaker odds yet, so there is no priced best bet. The slip below shows the model\'s fair odds.</p>';
    return '<div class="topbet"><div><div class="lab">Best bet</div><div class="what">' + esc(t.label) + '</div></div><div class="nums num"><div><b>' + odd(t.odds) + "</b>odds</div><div><b>" + pct(t.p) + "</b>model</div><div><b>" + pct(t.implied) + "</b>bookmaker</div><div><b>" + odd(1 / t.p) + "</b>fair</div></div>" + confChip(t.confidence) + "</div>";
  }
  function scoreGrid(r) {
    return '<div class="csgrid">' + r.markets.correctScores.slice(0, 8).map(function (c) { return '<div class="cs"><div class="s num">' + esc(c.score) + '</div><div class="p num">' + pct(c.p, 1) + " · " + odd(1 / c.p) + "</div></div>"; }).join("") + "</div>";
  }
  function goalLadder(m, r) {
    var o = (m.odds && m.odds.ou) || {};
    var rows = [0.5, 1.5, 2.5, 3.5, 4.5].map(function (L) {
      var p = r.markets.over[L], b = o[L];
      return "<tr><td>Over " + L + '</td><td class="r num">' + pct(p) + '</td><td class="r num">' + odd(1 / p) + '</td><td class="r num">' + (b ? odd(b[0]) : "–") + '</td><td class="r num">' + odd(1 / (1 - p)) + '</td><td class="r num">' + (b ? odd(b[1]) : "–") + "</td></tr>";
    }).join("");
    return '<div class="tablewrap ladder"><table><thead><tr><th>Goals</th><th class="r">Over</th><th class="r">Fair</th><th class="r">Book</th><th class="r">Under fair</th><th class="r">Book</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function ahLadder(m, r) {
    var fav = r.markets.home >= r.markets.away ? "home" : "away", name = m[fav].name, book = (m.odds && m.odds.ah) || [];
    var rows = r.markets.ah.map(function (a) {
      var L = fav === "home" ? a.line : -a.line;
      var b = book.filter(function (x) { return Math.abs(x.line - a.line) < 1e-9; })[0];
      return { L: L, p: fav === "home" ? a.homeWin : a.awayWin, push: a.push, f: fav === "home" ? a.homeFair : a.awayFair, bk: b ? (fav === "home" ? b.home : b.away) : null };
    }).filter(function (x) { return x.L <= 0 && x.L >= -2.5; }).sort(function (x, y) { return y.L - x.L; })
      .map(function (x) { return "<tr><td>" + esc(name) + " " + (x.L === 0 ? "0" : x.L) + '</td><td class="r num">' + pct(x.p) + '</td><td class="r num">' + (x.push > 0.001 ? pct(x.push) : "–") + '</td><td class="r num">' + odd(x.f) + '</td><td class="r num">' + odd(x.bk) + "</td></tr>"; }).join("");
    return '<div class="tablewrap ladder"><table><thead><tr><th>Asian handicap</th><th class="r">Win</th><th class="r">Push</th><th class="r">Fair</th><th class="r">Book</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function lineups(m) {
    var L = m.lineups || {}, confirmed = L.status === "confirmed";
    function side(t, key) {
      var x = L[key] || {};
      var li = (x.xi || []).map(function (n) { return n.charAt(0) === "~" ? '<li class="removed">' + esc(n.slice(1)) + "</li>" : "<li>" + esc(n) + "</li>"; }).join("");
      return '<div class="xi"><h4><span>' + esc(t.name) + '</span><span class="chip plain">' + esc(x.formation || "–") + "</span></h4>" + (li ? "<ol>" + li + "</ol>" : '<p class="alt">No lineup data yet.</p>') +
        (x.bench && x.bench.length ? '<div class="alt">Bench: ' + x.bench.map(esc).join(", ") + "</div>" : "") + "</div>";
    }
    var news = (m.news || []).map(function (n) {
      var tagCls = { out: "bad", doubt: "warn", back: "good", info: "info" }[n.tag] || "plain";
      var who = n.team === "home" ? m.home.code : n.team === "away" ? m.away.code : "";
      var text = n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.text) + "</a>" : esc(n.text);
      return '<li><span class="chip ' + tagCls + '">' + esc(n.tag) + "</span><span>" + (who ? "<b>" + esc(who) + "</b> · " : "") + text + ' <span class="src">' + esc(n.src || "") + (n.when ? " · " + esc(stamp(n.when)) : "") + "</span></span></li>";
    }).join("");
    return '<h3>Lineups and team news <small><span class="chip ' + (confirmed ? "good" : "warn") + '"><span class="dot"></span>' + (confirmed ? "Confirmed" : "Predicted") + "</span> " + esc(L.source || "") + "</small></h3>" +
      '<div class="lineups">' + side(m.home, "home") + side(m.away, "away") + "</div>" + (L.alt ? '<p class="alt">' + esc(L.alt) + "</p>" : "") +
      (news ? '<ul class="news">' + news + "</ul>" : '<p class="alt">No injury news or relevant headlines found in the last few days.</p>');
  }
  function playerTable(m, r) {
    var hasBook = r.players.some(function (p) { return p.scorerOdds; });
    var rows = r.players.slice(0, 10).map(function (p) {
      return '<tr><td><span class="pickname">' + esc(p.name) + '</span> <span class="market">' + esc(m[p.team].code) + "</span>" + (p.note ? '<br><span class="market" style="text-transform:none">' + esc(p.note) + "</span>" : "") +
        '</td><td class="r num hide-sm">' + pct(p.start) + '</td><td class="r num">' + pct(p.scorer) + '</td><td class="r num">' + odd(p.scorerFair) + "</td>" + (hasBook ? '<td class="r num">' + odd(p.scorerOdds) + "</td>" : "") + '<td class="r num">' + pct(p.assist) + '</td><td class="r num">' + odd(p.assistFair) + "</td></tr>";
    }).join("");
    if (!rows) return '<p class="alt">No player data yet.</p>';
    return '<div class="tablewrap"><table><thead><tr><th>Player</th><th class="r hide-sm">Starts</th><th class="r">Scores</th><th class="r">Fair</th>' + (hasBook ? '<th class="r">Book</th>' : "") + '<th class="r">Assists</th><th class="r">Fair</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }
  function cornersCards(m, r) {
    var c = r.corners, k = r.cards, ref = m.referee || {}, bc = (m.odds && m.odds.corners) || {}, bk = (m.odds && m.odds.cards) || {};
    var cRows = [7.5, 8.5, 9.5, 10.5, 11.5].map(function (L) { var b = bc[L]; return "<tr><td>" + L + ' corners</td><td class="r num">' + pct(c.over[L]) + '</td><td class="r num">' + odd(1 / c.over[L]) + '</td><td class="r num">' + (b ? odd(b[0]) : "–") + '</td><td class="r num">' + odd(1 / (1 - c.over[L])) + '</td><td class="r num">' + (b ? odd(b[1]) : "–") + "</td></tr>"; }).join("");
    var kRows = [2.5, 3.5, 4.5, 5.5].map(function (L) { var b = bk[L]; return "<tr><td>" + L + ' cards</td><td class="r num">' + pct(k.over[L]) + '</td><td class="r num">' + odd(1 / k.over[L]) + '</td><td class="r num">' + (b ? odd(b[0]) : "–") + '</td><td class="r num">' + odd(1 / (1 - k.over[L])) + '</td><td class="r num">' + (b ? odd(b[1]) : "–") + "</td></tr>"; }).join("");
    return '<div class="kv"><div><span>Corners</span><b class="num">' + c.total.toFixed(1) + '</b><div class="market">' + esc(m.home.code) + " " + c.home.toFixed(1) + " · " + esc(m.away.code) + " " + c.away.toFixed(1) + "</div></div>" +
      '<div><span><i class="yc"></i>Yellow cards</span><b class="num">' + k.total.toFixed(1) + '</b><div class="market">' + esc(m.home.code) + " " + k.home.toFixed(1) + " · " + esc(m.away.code) + " " + k.away.toFixed(1) + "</div></div>" +
      '<div><span>Red card</span><b class="num">' + pct(k.redCard) + '</b><div class="market">any player</div></div></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Line</th><th class="r">Over</th><th class="r">Fair</th><th class="r">Book</th><th class="r">Under fair</th><th class="r">Book</th></tr></thead><tbody>' + cRows + kRows + "</tbody></table></div>" +
      '<p class="refnote"><b>Referee</b> · ' + esc(ref.name) + (ref.country ? " (" + esc(ref.country) + ")" : "") + ". " + esc(ref.note || "") + " Corners from " + esc(c.source) + "; cards from " + esc(k.source) + ".</p>";
  }
  function wxChip(m, r) {
    var w = m.weather; if (!w) return "";
    var adj = r.weather && r.weather.factor < 0.995 ? " · goals −" + Math.round((1 - r.weather.factor) * 100) + "%" : "";
    return '<span class="chip ' + (adj ? "warn" : "plain") + ' wx" title="Forecast for kick-off, Open-Meteo">' + esc(w.desc || "Weather") + " · " + Math.round(w.tempC) + "°C · " + Math.round(w.windKmh) + " km/h" + (w.precipMm ? " · " + w.precipMm + " mm" : "") + adj + "</span>";
  }

  function matchCard(m, r) {
    var st = status(m), mp = r.market ? r.market.probs : null, mk = r.markets, b = r.picks.builder;
    var mid = st.score ? '<span class="live-score num">' + m.goals.home + " – " + m.goals.away + "</span>" : '<span class="vs">' + time(m.kickoff) + "</span>";
    return '<section class="match" id="' + esc(m.id) + '" aria-labelledby="t-' + esc(m.id) + '">' +
      '<div class="mhead"><span>' + esc(m.competition) + " · " + esc(m.venue) + '</span><span class="chips">' + wxChip(m, r) + '<span class="chip ' + st.cls + '"><span class="dot"></span>' + esc(st.label) + '</span><span class="chip ' + (m.lineups.status === "confirmed" ? "good" : "warn") + '">' + (m.lineups.status === "confirmed" ? "Lineups confirmed" : "Lineups predicted") + "</span></span></div>" +
      '<div class="scoreline"><div class="team"><span class="name" id="t-' + esc(m.id) + '">' + esc(m.home.name) + '</span><span class="xg">Expected goals <b class="num">' + r.xg.home.toFixed(2) + "</b></span></div>" + mid +
      '<div class="team away"><span class="name">' + esc(m.away.name) + '</span><span class="xg">Expected goals <b class="num">' + r.xg.away.toFixed(2) + "</b></span></div></div>" +
      '<div class="probbar"><div class="bar num" role="img" aria-label="Model: ' + esc(m.home.name) + " " + pct(mk.home) + ", draw " + pct(mk.draw) + ", " + esc(m.away.name) + " " + pct(mk.away) + '">' +
      '<div class="h" style="width:' + (mk.home * 100).toFixed(1) + '%">' + pct(mk.home) + '</div><div class="d" style="width:' + (mk.draw * 100).toFixed(1) + '%">' + pct(mk.draw) + '</div><div class="a" style="width:' + (mk.away * 100).toFixed(1) + '%">' + pct(mk.away) + "</div></div>" +
      '<div class="barlegend num"><span>Model: home · draw · away</span>' + (mp ? "<span>Bookmaker (margin removed): " + pct(mp[0]) + " · " + pct(mp[1]) + " · " + pct(mp[2]) + "</span>" : "<span>No bookmaker odds yet: model uses form only</span>") + "</div></div>" +
      (m.context ? '<p class="context">' + esc(m.context) + "</p>" : "") +
      (m.errors.length ? '<div class="notes">' + m.errors.map(function (e) { return '<span class="note-err">' + esc(e) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="mbody">' +
        '<div class="panel"><h3>Bet slip <small>one pick per market</small></h3>' + topBet(r) + slipTable(r) +
          (r.picks.value && r.picks.value.ev > 0 ? '<div class="builder"><b>Value shot:</b> ' + esc(r.picks.value.label) + ' <span class="num">@ ' + odd(r.picks.value.odds) + " · chance " + pct(r.picks.value.p) + " · edge +" + (r.picks.value.ev * 100).toFixed(1) + "%</span> " + confChip(r.picks.value.confidence) + "</div>" : "") +
          (b ? '<div class="builder"><b>Bet builder:</b> ' + b.legs.map(esc).join(" + ") + ' <span class="num">· chance ' + pct(b.p) + " · fair odds " + odd(b.fair) + "</span></div>" : "") + "</div>" +
        '<div class="panel"><h3>Most likely scores <small>chance · fair odds</small></h3>' + scoreGrid(r) + goalLadder(m, r) + ahLadder(m, r) + "</div>" +
        '<div class="panel full">' + lineups(m) + "</div>" +
        '<div class="panel"><h3>Scorers and assists <small>chance in 90 minutes</small></h3>' + playerTable(m, r) + "</div>" +
        '<div class="panel"><h3>Corners and cards</h3>' + cornersCards(m, r) + "</div>" +
      "</div>" +
      '<div class="sources"><b>Sources</b>' + m.sources.map(function (s) { return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title) + "</a>"; }).join("") + (m.odds && m.odds.book ? "<span>Odds: " + esc(m.odds.book) + (m.odds.updated ? ", " + esc(stamp(m.odds.updated)) : "") + "</span>" : "") + "</div></section>";
  }

  function banner(kind, text) { bannerEl.innerHTML = text ? '<div class="banner ' + kind + '">' + esc(text) + "</div>" : ""; }

  function render() {
    var d = current;
    var q = d.live && d.live.ok && d.live.v.quota && d.live.v.quota.remaining != null ? d.live.v.quota : d.fx.quota;
    metaEl.innerHTML = (d.loaded ? "Updated " + esc(stamp(d.loaded)) + " · " : "") + '<button type="button" class="refresh" id="refresh">Refresh</button><br><span class="num">Times in ' + esc(tz) + (q && q.remaining != null ? " · API calls left today: " + q.remaining + (q.limit ? "/" + q.limit : "") : "") + "</span>";
    document.getElementById("refresh").addEventListener("click", function () { load(d.date); });
    if (q && q.remaining != null && q.remaining < 12) banner("warn", "API-Football's daily allowance is nearly used up (" + q.remaining + " calls left). The page keeps showing cached data until the quota resets at 01:00 Warsaw time.");
    else banner("", "");
    if (!d.matches.length) { app.innerHTML = '<p class="skeleton">No matches from the tracked competitions on this day.</p>'; return; }
    var results = d.matches.map(function (m) { try { return { m: m, r: E.analyse(m) }; } catch (e) { return { m: m, err: e }; } });
    results.sort(function (a, b) { return new Date(a.m.kickoff) - new Date(b.m.kickoff); });
    var ok = results.filter(function (x) { return x.r; });
    app.innerHTML =
      '<div class="section-title"><h2>Best bets</h2><p>' + esc(d.fx.totalFixtures) + " fixtures today; these " + ok.length + " are the biggest. Odds refresh every few hours, lineups and injuries every 15 minutes before kick-off.</p></div>" +
      '<div class="slipgrid">' + ok.map(function (x) { return tile(x.m, x.r); }).join("") + "</div>" +
      '<div class="section-title"><h2>Matches</h2><p>' + ok.length + " matches</p></div>" +
      results.map(function (x) { return x.r ? matchCard(x.m, x.r) : '<div class="err">' + esc(x.m.home.name + " v " + x.m.away.name) + ": " + esc(x.err.message) + "</div>"; }).join("");
    if (location.hash && !d.scrolled) { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); d.scrolled = true; }
  }

  function showSetup() {
    app.innerHTML = '<div class="setup"><h2>One step left</h2><p>The site is deployed but has no API-Football key yet.</p><ol>' +
      "<li>Create a free account at <a href=\"https://dashboard.api-football.com\" target=\"_blank\" rel=\"noopener\">dashboard.api-football.com</a> and copy your key from <b>Account → My Access</b>.</li>" +
      "<li>In Vercel, open this project → <b>Settings → Environment Variables</b> and add <code>API_FOOTBALL_KEY</code> with your key.</li>" +
      "<li>Go to <b>Deployments</b>, open the latest one and choose <b>Redeploy</b>.</li></ol></div>";
  }

  // ---------- day picker and auto refresh ----------
  function setupDays() {
    var now = new Date(), days = [-1, 0, 1].map(function (o) { var d = new Date(now.getTime() + o * 86400000); return { date: ymd(d), label: o === 0 ? "Today" : o === -1 ? "Yesterday" : "Tomorrow" }; });
    var fromHash = /^#day-(\d{4}-\d{2}-\d{2})$/.exec(location.hash);
    var active = fromHash ? fromHash[1] : days[1].date;
    days.forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.id = "day-" + d.date; b.textContent = d.label; b.setAttribute("aria-pressed", d.date === active ? "true" : "false");
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(daysEl.children, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        app.innerHTML = '<p class="skeleton">Loading…</p>'; current = null; load(d.date);
      });
      daysEl.appendChild(b);
    });
    return active;
  }

  var startDate = setupDays();
  load(startDate);
  timer = setInterval(function () { if (current && !document.hidden) load(current.date); }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden && current && Date.now() - new Date(current.loaded || 0).getTime() > REFRESH_MS) load(current.date); });
})();
