// GET /api/weather?city=London&time=2026-11-12T19:45:00Z
// Forecast at the venue for the kick-off hour from Open-Meteo (free for non-commercial use,
// no key). Set OPEN_METEO_KEY to use a paid commercial plan instead.
import { ttl } from "../lib/ttl.js";
import { sendJson, fail, query, need } from "../lib/http.js";

const KEY = process.env.OPEN_METEO_KEY;
const GEO = process.env.OPEN_METEO_GEO_BASE || (KEY ? "https://customer-geocoding-api.open-meteo.com" : "https://geocoding-api.open-meteo.com");
const WX = process.env.OPEN_METEO_BASE || (KEY ? "https://customer-api.open-meteo.com" : "https://api.open-meteo.com");

const CODES = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail" };

function withKey(u) { if (KEY) u.searchParams.set("apikey", KEY); return u; }

export default async function handler(req, res) {
  try {
    const q = query(req);
    need(q, ["city", "time"]);
    const t = new Date(q.time);
    if (isNaN(t)) { const e = new Error("Bad time"); e.status = 400; throw e; }
    const city = String(q.city).split(",")[0].trim();
    const g = withKey(new URL("/v1/search", GEO));
    g.searchParams.set("name", city); g.searchParams.set("count", "1"); g.searchParams.set("language", "en"); g.searchParams.set("format", "json");
    const gr = await fetch(g);
    if (!gr.ok) throw Object.assign(new Error(`Geocoding HTTP ${gr.status}`), { status: 502 });
    const gj = await gr.json();
    const place = gj.results && gj.results[0];
    if (!place) return sendJson(res, 200, { city, found: false }, ttl("weather"));
    const day = t.toISOString().slice(0, 10);
    const f = withKey(new URL("/v1/forecast", WX));
    f.searchParams.set("latitude", place.latitude); f.searchParams.set("longitude", place.longitude);
    f.searchParams.set("hourly", "temperature_2m,precipitation,wind_speed_10m,weather_code");
    f.searchParams.set("timezone", "GMT"); f.searchParams.set("start_date", day); f.searchParams.set("end_date", day);
    const fr = await fetch(f);
    if (!fr.ok) throw Object.assign(new Error(`Forecast HTTP ${fr.status}`), { status: 502 });
    const fj = await fr.json();
    const h = fj.hourly || {};
    const times = (h.time || []).map((s) => new Date(s + "Z").getTime());
    if (!times.length) return sendJson(res, 200, { city, found: false }, ttl("weather"));
    let i = 0, best = Infinity;
    times.forEach((tm, k) => { const d = Math.abs(tm - t.getTime()); if (d < best) { best = d; i = k; } });
    const code = h.weather_code ? h.weather_code[i] : null;
    sendJson(res, 200, {
      found: true, city: place.name, country: place.country, lat: place.latitude, lon: place.longitude,
      hour: h.time[i] + "Z",
      tempC: h.temperature_2m ? h.temperature_2m[i] : null,
      precipMm: h.precipitation ? h.precipitation[i] : null,
      windKmh: h.wind_speed_10m ? h.wind_speed_10m[i] : null,
      code, desc: CODES[code] || null,
      source: "Open-Meteo"
    }, ttl("weather"));
  } catch (e) { fail(res, e); }
}
