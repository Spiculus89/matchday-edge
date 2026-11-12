// Picks "the most popular games of the day" from every fixture API-Football lists for a date.
// Score = competition weight + a bonus for each big club or national team involved.

// API-Football league ids, with a name fallback in case an id differs.
const LEAGUES = [
  { id: 1, re: /^World Cup$/i, w: 100 },
  { id: 4, re: /^Euro Championship$/i, w: 100 },
  { id: 2, re: /^UEFA Champions League$/i, w: 98 },
  { id: 39, re: /^Premier League$/i, country: /England/i, w: 95 },
  { id: 140, re: /^La Liga$/i, country: /Spain/i, w: 90 },
  { id: 5, re: /^UEFA Nations League$/i, w: 88 },
  { id: 135, re: /^Serie A$/i, country: /Italy/i, w: 88 },
  { id: 78, re: /^Bundesliga$/i, country: /Germany/i, w: 87 },
  { id: 61, re: /^Ligue 1$/i, country: /France/i, w: 80 },
  { id: 3, re: /^UEFA Europa League$/i, w: 78 },
  { id: 32, re: /World Cup - Qualification Europe/i, w: 80 },
  { id: 960, re: /Euro Championship - Qualification/i, w: 78 },
  { id: 9, re: /^Copa America$/i, w: 85 },
  { id: 13, re: /^CONMEBOL Libertadores$/i, w: 68 },
  { id: 848, re: /^UEFA Europa Conference League$|Conference League/i, w: 62 },
  { id: 45, re: /^FA Cup$/i, w: 60 },
  { id: 143, re: /^Copa del Rey$/i, w: 58 },
  { id: 81, re: /^DFB Pokal$/i, w: 56 },
  { id: 137, re: /^Coppa Italia$/i, w: 56 },
  { id: 48, re: /^League Cup$/i, country: /England/i, w: 52 },
  { id: 66, re: /^Coupe de France$/i, w: 48 },
  { id: 88, re: /^Eredivisie$/i, w: 55 },
  { id: 94, re: /^Primeira Liga$/i, w: 55 },
  { id: 203, re: /^S[uü]per Lig$/i, w: 50 },
  { id: 106, re: /^Ekstraklasa$/i, w: 50 },
  { id: 40, re: /^Championship$/i, country: /England/i, w: 45 },
  { id: 144, re: /^Jupiler Pro League$|^Pro League$/i, country: /Belgium/i, w: 45 },
  { id: 179, re: /^Premiership$/i, country: /Scotland/i, w: 42 },
  { id: 71, re: /^Serie A$/i, country: /Brazil/i, w: 48 },
  { id: 128, re: /^Liga Profesional Argentina$/i, w: 44 },
  { id: 307, re: /^Pro League$/i, country: /Saudi/i, w: 45 },
  { id: 253, re: /^Major League Soccer$/i, w: 40 },
  { id: 10, re: /^Friendlies$/i, w: 35 }
];

const BIG = [
  "Real Madrid", "Barcelona", "Atletico Madrid", "Manchester City", "Liverpool", "Arsenal", "Chelsea",
  "Manchester United", "Tottenham", "Newcastle", "Bayern Munich", "Bayern München", "Borussia Dortmund",
  "Bayer Leverkusen", "Paris Saint Germain", "Inter", "AC Milan", "Juventus", "Napoli", "Roma",
  "Benfica", "Porto", "Sporting CP", "Ajax", "PSV Eindhoven", "Galatasaray", "Fenerbahce", "Celtic",
  "Legia Warszawa", "Lech Poznan",
  "France", "Spain", "England", "Germany", "Italy", "Portugal", "Netherlands", "Belgium", "Brazil",
  "Argentina", "Croatia", "Uruguay", "Poland", "Turkey", "Türkiye", "Denmark", "Norway", "Switzerland"
];
const BIG_SET = new Set(BIG.map((s) => s.toLowerCase()));

const EXCLUDE = /(U1[0-9]|U2[0-3]|Women|Feminin|Femenina|Youth|Reserve|Primavera|Amateur|\bII\b)/i;

export function leagueWeight(league) {
  if (!league) return 0;
  if (EXCLUDE.test(league.name || "")) return 0;
  for (const L of LEAGUES) {
    if (league.id === L.id) return L.w;
  }
  for (const L of LEAGUES) {
    if (L.re.test(league.name || "") && (!L.country || L.country.test(league.country || ""))) return L.w;
  }
  return 0;
}

// Nations League tiers: League A is the headline act.
function roundAdjust(league) {
  const m = /League ([A-D])/i.exec(league.round || "");
  if (!m) return 0;
  return { A: 0, B: -18, C: -35, D: -50 }[m[1].toUpperCase()] || 0;
}

export function scoreFixture(f) {
  const w = leagueWeight(f.league);
  if (w <= 0) return 0;
  const names = [f.teams.home.name, f.teams.away.name].map((n) => String(n || "").toLowerCase());
  if (names.some((n) => EXCLUDE.test(n))) return 0;
  const big = names.filter((n) => BIG_SET.has(n)).length;
  return w + roundAdjust(f.league) + big * 8;
}

export function pickTop(fixtures, n) {
  return fixtures
    .map((f) => ({ f, s: scoreFixture(f) }))
    .filter((x) => x.s > 0 && !["PST", "CANC", "ABD", "AWD", "WO"].includes(x.f.fixture.status && x.f.fixture.status.short))
    .sort((a, b) => b.s - a.s || new Date(a.f.fixture.date) - new Date(b.f.fixture.date))
    .slice(0, n)
    .map((x) => ({ ...x.f, popularity: x.s }));
}
