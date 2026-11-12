// GET /api/news?team=England&national=1
// Recent headlines about a team's injuries, suspensions, returns and lineups from the
// Google News RSS search feed (free, no key). Each headline is tagged by keywords.
import { ttl } from "../lib/ttl.js";
import { sendJson, fail, query, need } from "../lib/http.js";

const BASE = process.env.NEWS_RSS_BASE || "https://news.google.com/rss/search";
const HL = process.env.NEWS_LANG || "en-GB";
const GL = process.env.NEWS_REGION || "GB";

const TAGS = [
  ["back", /back from (injury|suspension|a ban)|returns? from|fit again|recalled|cleared to play|back in (training|the squad)|available again/i],
  ["out", /ruled out|out of the|will miss|to miss|misses|sidelined|suspended|suspension|banned|injury blow|withdraw|pulled out|out injured|surgery|season-ending|torn/i],
  ["doubt", /doubt|doubtful|fitness test|race against time|questionable|knock|could miss|may miss|injury scare|limp|precaution|assessed/i],
  ["back", /returns?|back in training|fit again|available again|recalled|boost|cleared to play|back from injury/i],
  ["lineup", /line-?up|starting (xi|eleven)|team news|confirmed xi|predicted xi|to start|benched|dropped/i]
];

function decode(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
}
function tag(re, xml) { const m = re.exec(xml); return m ? decode(m[1]) : null; }

export function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const it = m[1];
    const title = tag(/<title>([\s\S]*?)<\/title>/, it);
    const link = tag(/<link>([\s\S]*?)<\/link>/, it);
    const pub = tag(/<pubDate>([\s\S]*?)<\/pubDate>/, it);
    const source = tag(/<source[^>]*>([\s\S]*?)<\/source>/, it);
    if (title && link) items.push({ title, link, published: pub ? new Date(pub).toISOString() : null, source });
  }
  return items;
}

export function classify(title) {
  for (const [name, re] of TAGS) if (re.test(title)) return name;
  return "info";
}

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["team"]);
    const team = String(q.team).slice(0, 60);
    const who = q.national === "1" ? `"${team}" national team` : `"${team}"`;
    const query_ = `${who} (injury OR injured OR "ruled out" OR doubt OR suspended OR "team news" OR lineup OR "starting XI") when:3d`;
    const u = new URL(BASE);
    u.searchParams.set("q", query_); u.searchParams.set("hl", HL); u.searchParams.set("gl", GL); u.searchParams.set("ceid", `${GL}:${HL.split("-")[0]}`);
    const r = await fetch(u, { headers: { "user-agent": "MatchdayEdge/1.0 (+https://vercel.com)" } });
    if (!r.ok) return sendJson(res, 200, { team, items: [], error: `News feed HTTP ${r.status}` }, 600);
    const xml = await r.text();
    const cutoff = Date.now() - 4 * 86400000;
    const order = { out: 0, doubt: 1, back: 2, lineup: 3, info: 4 };
    const seen = new Set();
    const items = parseRss(xml)
      .filter((x) => !x.published || new Date(x.published).getTime() >= cutoff)
      .map((x) => ({ ...x, title: x.source && x.title.endsWith(" - " + x.source) ? x.title.slice(0, -(x.source.length + 3)) : x.title }))
      .filter((x) => { const k = x.title.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((x) => ({ ...x, tag: classify(x.title) }))
      .sort((a, b) => order[a.tag] - order[b.tag] || new Date(b.published || 0) - new Date(a.published || 0))
      .slice(0, 6);
    sendJson(res, 200, { team, items, generated: new Date().toISOString(), source: "Google News" }, ttl("news"));
  } catch (e) { fail(res, e); }
}
