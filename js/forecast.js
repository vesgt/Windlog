// forecast.js — automatic multi-model wind forecasts per spot, no backend, no
// key. One Open-Meteo call returns MET Norway (Yr), ECMWF, GFS and ICON side by
// side; we average each model over the sailing window and hand back per-spot,
// per-model { base, gust, dir } so the app no longer needs hand-typed numbers.
// SMHI's measured wind (smhi.js) stays the ground truth these get scored against.

const API = "https://api.open-meteo.com/v1/forecast";
const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const CACHE_KEY = "windlog.forecastcache.v1";

// Open-Meteo model id → the short label the rest of the app already uses.
// metno_seamless is Yr / MET Norway's Nordic model — usually the best local one.
export const MODELS = [
  { id: "metno_seamless", label: "YR" },
  { id: "ecmwf_ifs025",   label: "ECMWF" },
  { id: "gfs_seamless",   label: "GFS" },
  { id: "icon_seamless",  label: "ICON" },
];

// sailing window in local hours — the part of the day we actually care about
const WIN_START = 10, WIN_END = 18;

export function degToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return "";
  return DIRS[Math.round(deg / 22.5) % 16];
}

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// circular mean of compass degrees, so 350° and 10° average to 0°, not 180°
function meanDir(degs) {
  const v = degs.filter((d) => d != null && !Number.isNaN(d));
  if (!v.length) return null;
  const r = Math.PI / 180;
  const x = mean(v.map((d) => Math.cos(d * r)));
  const y = mean(v.map((d) => Math.sin(d * r)));
  let deg = Math.atan2(y, x) / r;
  if (deg < 0) deg += 360;
  return deg;
}

function buildURL(lat, lon) {
  const models = MODELS.map((m) => m.id).join(",");
  const params = new URLSearchParams({
    latitude: lat, longitude: lon,
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    models, wind_speed_unit: "ms", timezone: "auto", forecast_days: "3",
  });
  return `${API}?${params}`;
}

// reduce one model's hourly arrays to a single window-average for the target day
function windowReduce(hourly, suffix, dayISO) {
  const times = hourly.time || [];
  const spd = hourly[`wind_speed_10m_${suffix}`] || [];
  const gst = hourly[`wind_gusts_10m_${suffix}`] || [];
  const dir = hourly[`wind_direction_10m_${suffix}`] || [];
  const bases = [], gusts = [], dirs = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];               // "2026-06-27T13:00" local
    if (!t.startsWith(dayISO)) continue;
    const h = +t.slice(11, 13);
    if (h < WIN_START || h > WIN_END) continue;
    if (spd[i] != null) bases.push(spd[i]);
    if (gst[i] != null) gusts.push(gst[i]);
    if (dir[i] != null) dirs.push(dir[i]);
  }
  if (!bases.length && !gusts.length) return null;
  return {
    base_ms: round1(mean(bases)),
    gust_ms: round1(maxOf(gusts)),
    dir: degToCompass(meanDir(dirs)),
  };
}

const maxOf = (a) => (a.length ? Math.max(...a) : null);

// Per-hour consensus across all models for the target day — feeds the timeline
// and the best-window pick. base = mean of models, gust = worst-case max, dir =
// circular mean.
function hourlySeries(hourly, dayISO) {
  const times = hourly.time || [];
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    if (!t.startsWith(dayISO)) continue;
    const hr = +t.slice(11, 13);
    if (hr < 8 || hr > 20) continue;             // sailable daylight only
    const bases = [], gusts = [], dirs = [];
    for (const m of MODELS) {
      const b = hourly[`wind_speed_10m_${m.id}`]?.[i];
      const g = hourly[`wind_gusts_10m_${m.id}`]?.[i];
      const d = hourly[`wind_direction_10m_${m.id}`]?.[i];
      if (b != null) bases.push(b);
      if (g != null) gusts.push(g);
      if (d != null) dirs.push(d);
    }
    if (!bases.length) continue;
    out.push({ h: +t.slice(11, 13), base_ms: round1(mean(bases)),
      gust_ms: round1(maxOf(gusts)), dir: degToCompass(meanDir(dirs)) });
  }
  return out;
}

// Best contiguous sailing window (default 3h) within the day's series, ranked by
// mean base wind. Returns { from, to, avgBase, peakGust, dir } or null.
export function bestWindow(series, len = 3) {
  if (!series || !series.length) return null;
  const n = Math.min(len, series.length);
  let best = null;
  for (let i = 0; i + n <= series.length; i++) {
    const slice = series.slice(i, i + n);
    const avg = mean(slice.map((s) => s.base_ms));
    if (!best || avg > best.avgBase) {
      best = { from: slice[0].h, to: slice[n - 1].h, avgBase: round1(avg),
        peakGust: maxOf(slice.map((s) => s.gust_ms)), dir: slice[Math.floor(n / 2)].dir };
    }
  }
  return best;
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function writeCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {} }

// Fetch forecasts for one spot. Returns { models:[{model,base_ms,gust_ms,dir}],
// fetched_at, day }. Cached per spot+day for `maxAgeMin`; force bypasses cache.
export async function fetchSpotForecast(spot, { dayISO, force = false, maxAgeMin = 60 } = {}) {
  const day = dayISO || new Date().toISOString().slice(0, 10);
  const ck = `${spot.lat},${spot.lon}|${day}`;
  const cache = readCache();
  const hit = cache[ck];
  if (!force && hit && (Date.now() - hit.fetched_ms) < maxAgeMin * 60e3) return hit;

  const res = await fetch(buildURL(spot.lat, spot.lon));
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const hourly = data.hourly || {};
  const models = [];
  for (const m of MODELS) {
    const r = windowReduce(hourly, m.id, day);
    if (r && (r.base_ms != null || r.gust_ms != null)) models.push({ model: m.label, ...r });
  }
  const out = { models, hourly: hourlySeries(hourly, day), day,
    fetched_ms: Date.now(), fetched_at: new Date().toISOString().slice(0, 16) };
  cache[ck] = out; writeCache(cache);
  return out;
}

// Fetch every spot in parallel; never rejects — failed spots come back as
// { spotKey, error }. Returns a map keyed by the spot's config key.
export async function fetchAllSpots(spots, opts = {}) {
  const entries = Object.entries(spots);
  const results = await Promise.all(entries.map(async ([key, spot]) => {
    try { return [key, await fetchSpotForecast(spot, opts)]; }
    catch (e) { return [key, { error: e.message, models: [] }]; }
  }));
  return Object.fromEntries(results);
}

// Consensus across models for a spot's forecast: median-ish base/gust and the
// circular-mean direction. `weights` maps model label → weight (from the
// reliability engine); missing/zero falls back to an equal-weight average.
export function consensus(models, weights = {}) {
  const pick = (k) => models.map((m) => m[k]).filter((x) => x != null && x !== "");
  const bases = pick("base_ms"), gusts = pick("gust_ms");
  if (!bases.length && !gusts.length) return null;
  const wmean = (key) => {
    let ws = 0, acc = 0;
    for (const m of models) {
      const v = m[key];
      if (v == null || v === "") continue;
      const w = weights[m.model] != null ? weights[m.model] : 1;
      acc += v * w; ws += w;
    }
    return ws ? round1(acc / ws) : null;
  };
  const degs = models.map((m) => DIRS.indexOf(m.dir)).filter((i) => i >= 0).map((i) => i * 22.5);
  return { base_ms: wmean("base_ms"), gust_ms: wmean("gust_ms"), dir: degToCompass(meanDir(degs)) };
}
