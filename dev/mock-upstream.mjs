// Offline stand-in for API-Football, Open-Meteo and Google News, shaped like their real
// responses. Used by `npm run dev:mock` and the tests.
import http from "node:http";

const T = (id, name) => ({ id, name, logo: "" });
const TEAMS = { tur: T(777, "Turkey"), bel: T(1, "Belgium"), ita: T(768, "Italy"), fra: T(2, "France"), eng: T(10, "England"), cro: T(3, "Croatia"), cze: T(770, "Czech Republic"), esp: T(9, "Spain") };
const NL = (round) => ({ id: 5, name: "UEFA Nations League", country: "World", season: 2026, round });
const day = process.env.MOCK_DATE || new Date().toISOString().slice(0, 10);
function fx(id, h, a, hhmm, venue, city, referee, league, status) {
  return { fixture: { id, referee, timezone: "UTC", date: `${day}T${hhmm}:00+00:00`, venue: { id: id, name: venue, city }, status: status || { long: "Not Started", short: "NS", elapsed: null } },
    league, teams: { home: TEAMS[h] || h, away: TEAMS[a] || a }, goals: { home: null, away: null } };
}
const FIX = [
  fx(9001, "tur", "bel", "17:00", "Göztepe Gürsel Aksel Stadı", "İzmir", "Sandro Schärer, Switzerland", NL("League A - 5")),
  fx(9002, "ita", "fra", "19:45", "Stadio Giuseppe Meazza", "Milano", "István Kovács, Romania", NL("League A - 5")),
  fx(9003, "eng", "cro", "19:45", "Wembley Stadium", "London", "Morten Krogh, Denmark", NL("League A - 5")),
  fx(9004, "cze", "esp", "19:45", "Epet Arena", "Praha", "Nikola Dabanović, Montenegro", NL("League A - 5")),
  fx(9005, T(1100, "Armenia"), T(1101, "Cyprus"), "17:00", "Vazgen Sargsyan", "Yerevan", null, NL("League C - 5")),
  fx(9006, T(1102, "San Marino"), T(1103, "Belarus"), "19:45", "San Marino Stadium", "Serravalle", null, NL("League C - 5")),
  fx(9007, T(1104, "England U19"), T(1105, "Lithuania U19"), "22:00", "St George's Park", "Burton", null, { id: 38, name: "UEFA U19 Championship - Qualification", country: "World", season: 2026, round: "Group 3" }),
  fx(9008, T(1106, "New Zealand"), T(1107, "India"), "05:00", "Eden Park", "Auckland", null, { id: 10, name: "Friendlies", country: "World", season: 2026, round: "Friendlies 1" })
];
const P = (id, name, number, pos, grid) => ({ player: { id, name, number, pos, grid } });
const LINEUPS = {
  9001: [
    { team: TEAMS.tur, formation: "4-2-3-1", coach: { name: "Sergen Yalçın" }, startXI: [P(1, "Uğurcan Çakır", 23, "G"), P(2, "Oğuz Aydın", 18, "D"), P(3, "Ferdi Kadıoğlu", 20, "D"), P(4, "Merih Demiral", 3, "D"), P(5, "Ozan Kabak", 15, "D"), P(6, "İsmail Yüksek", 16, "M"), P(7, "Orkun Kökçü", 6, "M"), P(8, "Arda Güler", 8, "M"), P(9, "Barış Alper Yılmaz", 21, "M"), P(10, "Yunus Akgün", 11, "M"), P(11, "Enes Ünal", 9, "F")], substitutes: [P(12, "Kerem Aktürkoğlu", 7, "F"), P(13, "Hakan Çalhanoğlu", 10, "M")] },
    { team: TEAMS.bel, formation: "4-3-3", coach: { name: "Mark van Bommel" }, startXI: [P(21, "Senne Lammens", 1, "G"), P(22, "Timothy Castagne", 21, "D"), P(23, "Brandon Mechele", 4, "D"), P(24, "Nathan Ngoy", 15, "D"), P(25, "Maxim De Cuyper", 5, "D"), P(26, "Youri Tielemans", 8, "M"), P(27, "Nicolas Raskin", 23, "M"), P(28, "Kevin De Bruyne", 7, "M"), P(29, "Diego Moreira", 14, "F"), P(30, "Charles De Ketelaere", 17, "F"), P(31, "Jérémy Doku", 11, "F")], substitutes: [P(32, "Dodi Lukébakio", 19, "F"), P(33, "Leandro Trossard", 10, "F"), P(34, "Hans Vanaken", 20, "M")] }
  ]
};
const LAST = { // last starting XI per team, for predicted lineups
  768: ["Gianluigi Donnarumma:G", "Michael Kayode:D", "Gianluca Mancini:D", "Alessandro Bastoni:D", "Riccardo Calafiori:D", "Nicolò Barella:M", "Manuel Locatelli:M", "Sandro Tonali:M", "Nicolò Cambiaghi:F", "Pio Esposito:F", "Moise Kean:F"],
  2: ["Mike Maignan:G", "Jules Koundé:D", "Dayot Upamecano:D", "Maxence Lacroix:D", "Malo Gusto:D", "Manu Koné:M", "Adrien Rabiot:M", "Michael Olise:F", "Rayan Cherki:M", "Désiré Doué:F", "Kylian Mbappé:F"],
  10: ["Jordan Pickford:G", "Reece James:D", "Ezri Konsa:D", "Marc Guéhi:D", "Nico O'Reilly:D", "Declan Rice:M", "Elliot Anderson:M", "Bukayo Saka:F", "Jude Bellingham:M", "Anthony Gordon:F", "Harry Kane:F"],
  3: ["Dominik Livaković:G", "Josip Stanišić:D", "Josip Šutalo:D", "Luka Vušković:D", "Joško Gvardiol:D", "Mateo Kovačić:M", "Luka Modrić:M", "Petar Sučić:M", "Martin Baturina:M", "Ivan Perišić:F", "Igor Matanović:F"],
  770: ["Matěj Kovář:G", "Vladimír Coufal:D", "Robin Hranáč:D", "Ladislav Krejčí:D", "Jiří Sláma:D", "Alex Král:M", "Lukáš Červ:M", "Lukáš Ambros:M", "Matěj Radosta:F", "Adam Hložek:F", "Ondřej Lingr:F"],
  9: ["Unai Simón:G", "Marc Pubill:D", "Pau Cubarsí:D", "Aymeric Laporte:D", "Marc Cucurella:D", "Pedri:M", "Fabián Ruiz:M", "Lamine Yamal:F", "Fermín López:M", "Nico Williams:F", "Mikel Oyarzabal:F"]
};
let pid = 500;
function lastFixture(team) {
  const xi = (LAST[team] || []).map((s, i) => { const [name, pos] = s.split(":"); return P(team * 100 + i, name, i + 1, pos); });
  const opp = T(4000 + team, "Previous Opponent");
  return { fixture: { id: 80000 + team, date: "2026-10-06T18:45:00+00:00", referee: null, venue: {}, status: { short: "FT" } }, league: NL("League A - 4"),
    teams: { home: { id: team, name: "Team" }, away: opp }, goals: { home: 1, away: 0 },
    lineups: [{ team: { id: team }, formation: team === 9 ? "4-2-3-1" : "4-3-3", startXI: xi, substitutes: [] }, { team: opp, formation: "4-4-2", startXI: [], substitutes: [] }] };
}
const INJ = [
  { team: TEAMS.tur, fixture: 9001, name: "Kenan Yıldız", type: "Missing Fixture", reason: "Foot Injury" },
  { team: TEAMS.fra, fixture: 9002, name: "Maghnes Akliouche", type: "Questionable", reason: "Muscle Injury" },
  { team: TEAMS.fra, fixture: 9002, name: "William Saliba", type: "Missing Fixture", reason: "Knee Injury" },
  { team: TEAMS.esp, fixture: 9004, name: "Rodri", type: "Missing Fixture", reason: "Injury" },
  { team: TEAMS.esp, fixture: 9004, name: "Nico Williams", type: "Missing Fixture", reason: "Groin Injury" },
  { team: TEAMS.cro, fixture: 9003, name: "Ivan Perišić", type: "Missing Fixture", reason: "Suspended" }
].map((x) => ({ player: { id: ++pid, name: x.name, type: x.type, reason: x.reason }, team: x.team, fixture: { id: x.fixture }, league: NL("") }));

function ou(pairs) { const v = []; for (const [L, o, u] of pairs) { v.push({ value: "Over " + L, odd: String(o) }, { value: "Under " + L, odd: String(u) }); } return v; }
const ODDS = {
  9001: [[3.9, 4.1, 1.8], [[0.5, 1.02, 19], [1.5, 1.14, 5.5], [2.5, 1.5, 2.5], [3.5, 2.2, 1.62]], [1.5, 2.5]],
  9002: [[3.75, 3.7, 1.95], [[0.5, 1.04, 13], [1.5, 1.2, 4.33], [2.5, 1.67, 2.15], [3.5, 2.63, 1.44], [4.5, 5, 1.17]], [1.57, 2.25]],
  9003: [[1.22, 7, 11], [[0.5, 1.01, 23], [1.5, 1.13, 6], [2.5, 1.44, 2.7], [3.5, 2.1, 1.67], [4.5, 3.5, 1.29]], [1.83, 1.83]],
  9004: [[13, 8, 1.18], [[0.5, 1.02, 19], [1.5, 1.17, 5], [2.5, 1.53, 2.4], [3.5, 2.25, 1.57], [4.5, 4, 1.22]], [2.4, 1.5]]
};
function oddsFor(id) {
  const o = ODDS[id]; if (!o) return [];
  const bets = [
    { id: 1, name: "Match Winner", values: [{ value: "Home", odd: String(o[0][0]) }, { value: "Draw", odd: String(o[0][1]) }, { value: "Away", odd: String(o[0][2]) }] },
    { id: 5, name: "Goals Over/Under", values: ou(o[1]) },
    { id: 8, name: "Both Teams Score", values: [{ value: "Yes", odd: String(o[2][0]) }, { value: "No", odd: String(o[2][1]) }] }
  ];
  if (id === 9003) {
    bets.push({ id: 4, name: "Asian Handicap", values: [{ value: "Home -1.5", odd: "1.95" }, { value: "Away +1.5", odd: "1.85" }, { value: "Home -1", odd: "1.62" }, { value: "Away +1", odd: "2.25" }, { value: "Home -1.25", odd: "1.75" }, { value: "Away +1.25", odd: "2.05" }] });
    bets.push({ id: 45, name: "Corners Over Under", values: ou([[8.5, 1.66, 2.1], [9.5, 1.95, 1.8], [10.5, 2.4, 1.5]]) });
    bets.push({ id: 80, name: "Cards Over/Under", values: ou([[3.5, 1.9, 1.8], [4.5, 2.75, 1.4]]) });
    bets.push({ id: 92, name: "Anytime Goal Scorer", values: [{ value: "Harry Kane", odd: "1.65" }, { value: "Jude Bellingham", odd: "2.75" }, { value: "Anthony Gordon", odd: "3.0" }, { value: "Bukayo Saka", odd: "2.6" }] });
    bets.push({ id: 12, name: "Double Chance", values: [{ value: "Home/Draw", odd: "1.05" }, { value: "Home/Away", odd: "1.10" }, { value: "Draw/Away", odd: "4.0" }] });
    bets.push({ id: 2, name: "Home/Away", values: [{ value: "Home", odd: "1.08" }, { value: "Away", odd: "8.0" }] });
  }
  return [{ league: NL(""), fixture: { id }, update: `${day}T15:00:00+00:00`, bookmakers: [{ id: 8, name: "Bet365", bets }] }];
}
const STATS = { 777: [0.5, 2.8, "WLLLL", 1.6], 1: [1.5, 1.3, "WLWL", 1.8], 768: [2.0, 1.3, "LWWD", 2.3], 2: [1.8, 0.5, "WWDW", 1.5], 10: [3.5, 0.8, "LWWW", 1.3], 3: [1.0, 3.5, "WLLL", 2.0], 770: [0.5, 2.5, "LLLL", 1.8], 9: [3.0, 1.3, "WWWW", 1.0] };
function teamStats(team) {
  const s = STATS[team]; if (!s) return [];
  const played = 4;
  return { team: { id: team }, form: s[2], fixtures: { played: { total: played } },
    goals: { for: { total: { total: Math.round(s[0] * played) }, average: { total: String(s[0]) } }, against: { total: { total: Math.round(s[1] * played) }, average: { total: String(s[1]) } } },
    clean_sheet: { total: 1 }, failed_to_score: { total: 1 },
    cards: { yellow: { "0-15": { total: 1 }, "46-60": { total: Math.round(s[3] * played) - 1 } }, red: { "76-90": { total: 0 } } } };
}
const SC = (id, name, team, pos, apps, goals, assists, shots, pens) => ({ player: { id, name }, statistics: [{ team: { id: team }, league: NL(""), games: { appearences: apps, minutes: apps * 80, position: pos }, shots: { total: shots, on: Math.round(shots / 2.5) }, goals: { total: goals, assists }, penalty: { scored: pens }, cards: { yellow: 0 } }] });
const SCORERS = [SC(1001, "Harry Kane", 10, "Attacker", 4, 7, 1, 18, 2), SC(28, "Kevin De Bruyne", 1, "Midfielder", 3, 3, 2, 19, 1), SC(1002, "Pio Esposito", 768, "Attacker", 4, 4, 0, 13, 0),
  SC(1003, "Michael Olise", 2, "Attacker", 4, 7, 3, 16, 0), SC(1004, "Désiré Doué", 2, "Attacker", 4, 3, 2, 15, 0), SC(32, "Dodi Lukébakio", 1, "Attacker", 4, 6, 1, 14, 0),
  SC(1005, "Lamine Yamal", 9, "Attacker", 4, 4, 3, 16, 0), SC(1006, "Mikel Oyarzabal", 9, "Attacker", 3, 4, 0, 9, 1), SC(1007, "Anthony Gordon", 10, "Attacker", 4, 4, 2, 15, 0),
  SC(9, "Barış Alper Yılmaz", 777, "Midfielder", 4, 3, 0, 9, 0), SC(1008, "Luka Modrić", 3, "Midfielder", 4, 2, 1, 6, 1), SC(1009, "Jude Bellingham", 10, "Midfielder", 4, 2, 4, 12, 0)];

const RSS = (items) => `<?xml version="1.0"?><rss><channel>${items.map(([t, s, h]) => `<item><title><![CDATA[${t} - ${s}]]></title><link>https://example.com/${encodeURIComponent(t)}</link><pubDate>${new Date(Date.now() - h * 3600000).toUTCString()}</pubDate><source url="https://example.com">${s}</source></item>`).join("")}</channel></rss>`;
const NEWS = {
  Belgium: [["De Bruyne and Tielemans back from suspension for Türkiye trip", "HLN", 20], ["Belgium boost as Doku returns to squad", "Sporza", 30]],
  Turkey: [["Kenan Yıldız ruled out of Nations League double-header", "Fanatik", 40]],
  France: [["Saliba ruled out of Italy clash with knee injury", "L'Équipe", 18], ["Akliouche a doubt for San Siro after muscle problem", "RMC Sport", 10], ["Mbappé returns to France squad", "AFP", 60]],
  Italy: [["Mancini team news: Kean set to start against France", "Gazzetta", 8]],
  England: [["Kane set to break England appearance record against Croatia", "BBC Sport", 12]],
  Croatia: [["Perišić suspended for Wembley trip", "Index.hr", 22]],
  Spain: [["Rodri and Olmo miss Spain's November games", "Marca", 70], ["Nico Williams withdraws from Spain squad with groin injury", "AS", 15]],
  "Czech Republic": [["Souček recalled after long ankle injury", "iSport", 50]]
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://local"), q = Object.fromEntries(u.searchParams), p = u.pathname.replace(/^\//, "");
  const json = (response, extra) => { res.setHeader("content-type", "application/json"); res.setHeader("x-ratelimit-requests-remaining", "57"); res.setHeader("x-ratelimit-requests-limit", "100"); res.end(JSON.stringify({ get: p, parameters: q, errors: [], results: Array.isArray(response) ? response.length : 1, paging: { current: 1, total: 1 }, response, ...extra })); };
  if (p === "status") return json({ account: { firstname: "Mock" }, subscription: { plan: "Free", active: true }, requests: { current: 43, limit_day: 100 } });
  if (p === "fixtures" && q.date) return json(FIX);
  if (p === "fixtures" && q.ids) {
    const ids = q.ids.split("-").map(Number);
    return json(ids.map((id) => { const f = FIX.find((x) => x.fixture.id === id); if (f) return { ...f, lineups: LINEUPS[id] || [], events: [] }; const team = id - 80000; return LAST[team] ? lastFixture(team) : null; }).filter(Boolean));
  }
  if (p === "fixtures" && q.team && q.last) return json(LAST[q.team] ? [lastFixture(parseInt(q.team, 10))] : []);
  if (p === "injuries") { const ids = (q.ids || q.fixture || "").split("-").map(Number); return json(INJ.filter((x) => ids.includes(x.fixture.id))); }
  if (p === "odds") return json(oddsFor(parseInt(q.fixture, 10)));
  if (p === "teams/statistics") return json(teamStats(parseInt(q.team, 10)));
  if (p === "players/topscorers" || p === "players/topassists") return json(SCORERS);
  if (p === "v1/search") return json(null, { results: [{ name: q.name, latitude: 45, longitude: 9, country: "Mock" }] });
  if (p === "v1/forecast") {
    const times = Array.from({ length: 24 }, (_, h) => `${q.start_date}T${String(h).padStart(2, "0")}:00`);
    const rainy = /Milano/i.test(q.latitude) ? 0 : 0;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ hourly: { time: times, temperature_2m: times.map(() => 9), precipitation: times.map((_, h) => (h >= 18 ? 4.5 + rainy : 0)), wind_speed_10m: times.map(() => 18), weather_code: times.map((_, h) => (h >= 18 ? 63 : 3)) } }));
  }
  if (p === "rss/search") {
    const team = (/"([^"]+)"/.exec(q.q || "") || [])[1] || "";
    res.setHeader("content-type", "application/rss+xml");
    return res.end(RSS(NEWS[team] || []));
  }
  res.statusCode = 404; res.end("{}");
});
const port = parseInt(process.env.MOCK_PORT || "9911", 10);
server.listen(port, () => console.log("mock upstream on", port));
export default server;
