// smhi.js — fetch measured wind from the nearest SMHI station for the EXACT
// window you sailed. Pass the session's start/end (from the FIT, or manual
// times); base = mean over the window, gust = max over the window, dir =
// nearest the midpoint. Picks the right archive period by how old the session
// is. CORS-blocked or offline → enter wind by hand; analysis treats both the same.

const API = "https://opendata-download-metobs.smhi.se/api/version/1.0";
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const HOUR = 3600e3;

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

// choose the archive period that will contain the session time
function periodFor(midMs) {
  const ageH = (Date.now() - midMs) / HOUR;
  if (ageH <= 22) return "latest-day";       // last 24h of values
  if (ageH <= 24 * 110) return "latest-months"; // ~4 months
  return "corrected-archive";                 // older
}

async function paramSeries(stationId, parameter, period) {
  try {
    const data = await getJSON(`${API}/parameter/${parameter}/station/${stationId}/period/${period}/data.json`);
    return (data.value || []).map((v) => ({ t: +v.date, val: parseFloat(v.value) }))
      .filter((x) => Number.isFinite(x.val));
  } catch { return []; }
}

const nearestVal = (s, t) => s.length ? s.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).val : null;
const inWindow = (s, a, b) => s.filter((x) => x.t >= a && x.t <= b);
const meanOf = (s) => (s.length ? s.reduce((m, x) => m + x.val, 0) / s.length : null);
const maxOf = (s) => (s.length ? Math.max(...s.map((x) => x.val)) : null);

// startMs/endMs define the session window. If only one time is known, a ±45min
// window is used around it. whenMs is the midpoint used for period + direction.
export async function fetchObservation(lat, lon, { startMs, endMs } = {}) {
  const st = await nearestStation(lat, lon);
  if (!st) throw new Error("No SMHI station found");

  let a = startMs, b = endMs;
  if (a == null && b == null) { b = Date.now(); a = b; }
  if (a == null) a = b; if (b == null) b = a;
  if (a === b) { a -= 45 * 60e3; b += 45 * 60e3; }       // pad a point into a window
  const mid = (a + b) / 2;
  const period = periodFor(mid);

  const [speed, dir, gust] = await Promise.all([
    paramSeries(st.id, 4, period), paramSeries(st.id, 3, period), paramSeries(st.id, 21, period),
  ]);

  // window first, fall back to nearest-the-midpoint if the window is empty
  const sWin = inWindow(speed, a, b), gWin = inWindow(gust, a, b);
  const base = sWin.length ? meanOf(sWin) : nearestVal(speed, mid);
  const gmax = gWin.length ? maxOf(gWin) : nearestVal(gust, mid);
  const dirv = nearestVal(dir, mid);

  const r1 = (x) => (x == null ? "" : Math.round(x * 10) / 10);
  return {
    station_id: st.id, station_name: st.name, km: Math.round(st.km),
    obs_base_ms: r1(base), obs_gust_ms: r1(gmax), obs_dir: degToCompass(dirv),
    window: { from: a, to: b, period, n_samples: sWin.length },
  };
}
