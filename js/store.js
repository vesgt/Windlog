// store.js — all persistence. localStorage on device, with JSON/CSV
// export so you can commit a backup into the repo and re-import anywhere.

import { DEFAULT_CONFIG, SEED } from "./config.js";

const KEY = "windlog.v1";

function fresh() {
  return {
    config: structuredClone(DEFAULT_CONFIG),
    forecasts: structuredClone(SEED.forecasts),
    observations: structuredClone(SEED.observations),
    sessions: structuredClone(SEED.sessions),
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) { const d = fresh(); save(d); return d; }
    const d = JSON.parse(raw);
    d.config ||= structuredClone(DEFAULT_CONFIG);
    d.forecasts ||= []; d.observations ||= []; d.sessions ||= [];
    return d;
  } catch { return fresh(); }
}

export function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

const META_KEY = "windlog.v1.meta";       // { lastExport }
const SNAP_KEY = "windlog.v1.prewipe";     // pre-destructive snapshot for undo

function meta() { try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; } }
export function lastExport() { return meta().lastExport || null; }
export function markExported() {
  const m = meta(); m.lastExport = new Date().toISOString();
  localStorage.setItem(META_KEY, JSON.stringify(m));
}
// stash current data before a wipe/reset so it can be restored
function snapshot() { const raw = localStorage.getItem(KEY); if (raw) localStorage.setItem(SNAP_KEY, raw); }
export function hasSnapshot() { return !!localStorage.getItem(SNAP_KEY); }
export function restoreSnapshot() {
  const raw = localStorage.getItem(SNAP_KEY); if (!raw) return null;
  localStorage.setItem(KEY, raw); localStorage.removeItem(SNAP_KEY);
  return load();
}

export function resetSeed() { snapshot(); const d = fresh(); save(d); return d; }
export function wipe() {
  snapshot();
  const d = { config: structuredClone(DEFAULT_CONFIG), forecasts: [], observations: [], sessions: [] };
  save(d); return d;
}

export function sessionId(date, spot) { return `${date}_${spot}`; }

// ── mutations ─────────────────────────────────────────────────────
export function addSession(data, row) {
  data.sessions.push(row); save(data); return data;
}
export function upsertForecast(data, row) {
  const i = data.forecasts.findIndex((f) => f.session_id === row.session_id && f.model === row.model);
  if (i >= 0) data.forecasts[i] = row; else data.forecasts.push(row);
  save(data); return data;
}
export function upsertObservation(data, row) {
  const i = data.observations.findIndex((o) => o.session_id === row.session_id);
  if (i >= 0) data.observations[i] = row; else data.observations.push(row);
  save(data); return data;
}
export function deleteSession(data, idx) { data.sessions.splice(idx, 1); save(data); return data; }

// ── export / import ───────────────────────────────────────────────
export function exportJSON(data) {
  return new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
}

function toCSV(rows, fields) {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [fields.join(","), ...rows.map((r) => fields.map((f) => esc(r[f])).join(","))].join("\n");
}

export const CSV_FIELDS = {
  sessions: ["session_id","date","spot","sailor","weight_kg","board","sail","fin_cm","time_start","time_end","max_speed_kt","mins_planing","planing_ratio","tacks_tried","tacks_made","jibes_tried","jibes_made","powered","planed","sky","air_t","water_t","notes"],
  forecasts: ["session_id","model","base_ms","gust_ms","dir","captured_at","source"],
  observations: ["session_id","station_id","station_name","obs_base_ms","obs_gust_ms","obs_dir","fetched_at"],
};

export function exportCSV(data, which) {
  return new Blob([toCSV(data[which], CSV_FIELDS[which])], { type: "text/csv" });
}

export function importJSON(text) {
  const d = JSON.parse(text);
  if (!d.sessions || !d.forecasts) throw new Error("Not a windlog export");
  d.config ||= structuredClone(DEFAULT_CONFIG);
  d.observations ||= [];
  save(d); return d;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
