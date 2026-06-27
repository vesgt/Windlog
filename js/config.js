// config.js — your quiver, sailors, and spots. Edit freely in the app's
// Setup tab (persisted to localStorage) or here for the shipped defaults.

export const DEFAULT_CONFIG = {
  sailors: {
    joel: { name: "Joel", weight_kg: 75, planing_floor_kt: 11 },
    dad:  { name: "Dad",  weight_kg: 100, planing_floor_kt: 14 },
  },
  boards: [
    { id: "mistral",  name: "Old Mistral",            litres: 180, owner: "shared", note: "old big board, ~170–190L — light-wind / learner floater" },
    { id: "carve169", name: "Starboard Carve 2024",   litres: 169, owner: "dad" },
    { id: "b145",     name: "145",                     litres: 145, owner: "joel" },
    { id: "rrd",      name: "RRD Evolution",           litres: 125, owner: "joel" },
    { id: "hawaii",   name: "Hawaii",                  litres: 115, owner: "joel" },
  ],
  sails: [7.8, 7.5, 6.9, 6.0, 5.9, 5.5],
  spots: {
    ostnora:  { name: "Östnora",        area: "Haninge / Sorunda",       lat: 58.93, lon: 17.84, good_dirs: ["S","SSW","SW"], launch: "shallow — wade out before the fin bites" },
    oxno:     { name: "Oxnö klippbad",  area: "Nynäshamn, faces Mysingen", lat: 58.93, lon: 17.90, good_dirs: ["S","SSE","SSW","SW"], launch: "faces Mysingen — clean south fetch" },
    skalaker: { name: "Skälåker (Gålö)", area: "Haninge",                 lat: 59.03, lon: 18.18, good_dirs: ["N","NNE","NE"], launch: "primary north/northeast spot" },
  },
  wishlist: [{ for: "dad", item: "9.0 freeride sail", why: "planes him in the 5–7 m/s base you get most days" }],
};

// Seed data so the app isn't empty on first open — today's session.
export const SEED = {
  forecasts: [
    { session_id: "2026-06-26_ostnora", model: "PW_PE", base_ms: 10, gust_ms: 21, dir: "S" },
    { session_id: "2026-06-26_ostnora", model: "PW_PG", base_ms: 11, gust_ms: 20, dir: "S" },
    { session_id: "2026-06-26_ostnora", model: "PW_PA", base_ms: 15, gust_ms: 24, dir: "S" },
    { session_id: "2026-06-26_ostnora", model: "ECMWF", base_ms: 12, gust_ms: 22, dir: "S" },
    { session_id: "2026-06-26_ostnora", model: "GFS",   base_ms: 13, gust_ms: 27, dir: "S" },
    { session_id: "2026-06-26_ostnora", model: "SMHI",  base_ms: 6,  gust_ms: 11, dir: "S" },
  ],
  observations: [],
  sessions: [
    { session_id: "2026-06-26_ostnora", date: "2026-06-26", spot: "ostnora", sailor: "joel",
      weight_kg: 75, board: "b145", sail: 6.9, fin_cm: 50, max_speed_kt: 18.5, mins_planing: "",
      powered: "under", planed: "y", notes: "marginal gust-dependent; 6.9 small in lulls, 7.5 better" },
  ],
};

export const MS_TO_KT = 1.943844;
