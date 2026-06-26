// smhi.js — fetch measured wind from the nearest SMHI station, in-browser.
// SMHI Open Data is free and keyless. If the browser blocks the request
// (CORS) or you're offline, the Log form lets you type the measured wind by
// hand instead — the analysis treats both identically.

const API = "https://opendata-download-metobs.smhi.se/api/version/1.0";
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

export function degToCompass(deg) {
  if (deg == null) return "";
  return DIRS[Math.round(deg / 22.5) % 16];
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SMHI ${res.status}`);
  return res.json();
}

export async function nearestStation(lat, lon, parameter = 4) {
  const data = await getJSON(`${API}/parameter/${parameter}.json`);
  let best = null, bestD = Infinity;
  for (const s of data.station || []) {
    if (s.active === false) continue;
    const d = haversine(lat, lon, s.latitude, s.longitude);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best ? { id: best.id, name: best.name, km: bestD } : null;
}

async function paramSeries(stationId, parameter, period = "latest-day") {
  try {
    const data = await getJSON(`${API}/parameter/${parameter}/station/${stationId}/period/${period}/data.json`);
    return (data.value || []).map((v) => ({ t: +v.date, val: parseFloat(v.value) }))
      .filter((x) => Number.isFinite(x.val));
  } catch { return []; }
}

const nearestVal = (series, whenMs) =>
  series.length ? series.reduce((a, b) => (Math.abs(b.t - whenMs) < Math.abs(a.t - whenMs) ? b : a)).val : null;

// Returns { station_id, station_name, obs_base_ms, obs_gust_ms, obs_dir }
export async function fetchObservation(lat, lon, whenMs = Date.now()) {
  const st = await nearestStation(lat, lon);
  if (!st) throw new Error("No SMHI station found");
  const [speed, dir, gust] = await Promise.all([
    paramSeries(st.id, 4), paramSeries(st.id, 3), paramSeries(st.id, 21),
  ]);
  const base = nearestVal(speed, whenMs);
  const dirv = nearestVal(dir, whenMs);
  const gmax = gust.length ? Math.max(...gust.map((x) => x.val)) : null;
  const r1 = (x) => (x == null ? "" : Math.round(x * 10) / 10);
  return {
    station_id: st.id, station_name: st.name,
    obs_base_ms: r1(base), obs_gust_ms: r1(gmax), obs_dir: degToCompass(dirv),
    km: Math.round(st.km),
  };
}
