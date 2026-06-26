// engine.js — gear recommender + reliability/threshold analysis.
// Pure functions, no DOM, no storage. Ported 1:1 from the Python scripts
// so results match.

export const MS_TO_KT = 1.943844;

const DIR_ORDER = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

// ── gear selection ────────────────────────────────────────────────
export function joelKit(base, gust) {
  const gf = base ? gust / base : 1.5;
  if (base < 6)  return ["b145", 7.5, "marginal — plane the gusts, carry through lulls"];
  if (base < 8)  return ["b145", 7.5, "early planing, sweet spot building"];
  if (base < 10) return ["b145", 6.9, "nicely powered"];
  if (base < 12) return ["b145", gf > 1.8 ? 6.0 : 6.9, "well lit"];
  if (base < 15) return ["rrd", 6.0, "stepped down — smaller board settles the chop"];
  return ["hawaii", 5.5, "fully lit, small-kit day (25 cm fin)"];
}

export function dadKit(base, gust) {
  if (base < 12) {
    if (base < 8)  return ["carve169", 7.8, "below threshold in the base — gust-hunting (a 9.0 fixes this)"];
    if (base < 10) return ["carve169", 7.5, "getting going, powered in the gusts"];
    return ["carve169", 6.9, "well powered and settled"];
  }
  if (base < 15) return ["b145", 6.0, "now on the 145 — planes instantly so volume matters less"];
  return ["b145", 5.5, "strong-wind setup"];
}

// over/under-powered read, calibrated to the seeded bands
export function powerNote(base, gust, sail, weight) {
  const baseKt = base * MS_TO_KT, gustKt = gust * MS_TO_KT;
  const ideal = (49 - 4.67 * sail) * Math.sqrt(weight / 75);
  if (baseKt < ideal - 4) {
    if (gustKt >= ideal - 1) return "marginal — powered only in gusts";
    return "under-powered";
  }
  if (baseKt > ideal + 5) return "overpowered up top — sheet out / size down";
  return "nicely matched";
}

export function pickSpots(dir, spots) {
  const D = dir.toUpperCase();
  return Object.entries(spots).filter(([, s]) => s.good_dirs.includes(D));
}

export function boardName(boards, id) {
  const b = boards.find((x) => x.id === id);
  return b ? `${b.name} (${b.litres}L)` : id;
}

// full recommendation object for the Today tab
export function recommend(base, gust, dir, config, learnedFloors = {}) {
  const out = { base, gust, dir: dir.toUpperCase(), baseKt: base * MS_TO_KT, gustKt: gust * MS_TO_KT, sailors: [], spots: [] };
  for (const [who, fn] of [["joel", joelKit], ["dad", dadKit]]) {
    const s = config.sailors[who];
    const [bid, sail, note] = fn(base, gust);
    const pn = powerNote(base, gust, sail, s.weight_kg);
    const floor = learnedFloors[who];
    let verdict = null;
    if (floor != null) verdict = out.baseKt >= floor ? "planing" : "marginal / gust-dependent";
    out.sailors.push({ who, name: s.name, weight: s.weight_kg,
      board: boardName(config.boards, bid), sail, note, power: pn, floor, verdict });
  }
  out.spots = pickSpots(dir, config.spots).map(([, s]) => s);
  return out;
}

// ── analysis ──────────────────────────────────────────────────────
const spotOf = (sid) => (sid.includes("_") ? sid.split("_").slice(1).join("_") : sid);
const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export function modelReliability(forecasts, observations) {
  const obs = Object.fromEntries(observations.map((o) => [o.session_id, o]));
  const err = {}; // key: spot|model -> {base:[],gust:[]}
  for (const r of forecasts) {
    const o = obs[r.session_id];
    if (!o) continue;
    const ob = num(o.obs_base_ms), og = num(o.obs_gust_ms);
    const fb = num(r.base_ms), fg = num(r.gust_ms);
    const key = `${spotOf(r.session_id)}|${r.model}`;
    (err[key] ||= { base: [], gust: [] });
    if (ob != null && fb != null) err[key].base.push(fb - ob);
    if (og != null && fg != null) err[key].gust.push(fg - og);
  }
  const bySpot = {};
  for (const [key, e] of Object.entries(err)) {
    const [spot, model] = key.split("|");
    const bMAE = mean(e.base.map(Math.abs)), gMAE = mean(e.gust.map(Math.abs));
    (bySpot[spot] ||= []).push({
      model,
      baseBias: mean(e.base), baseMAE: bMAE,
      gustBias: mean(e.gust), gustMAE: gMAE,
      n: Math.max(e.base.length, e.gust.length),
      score: (bMAE ?? 9) + (gMAE ?? 9),
    });
  }
  for (const spot of Object.keys(bySpot)) bySpot[spot].sort((a, b) => a.score - b.score);
  return bySpot; // { spot: [ {model, ...} sorted best-first ] }
}

export function planingThresholds(sessions, observations) {
  const obs = Object.fromEntries(observations.map((o) => [o.session_id, o]));
  const combos = {};
  for (const r of sessions) {
    const o = obs[r.session_id];
    const baseMs = o ? num(o.obs_base_ms) : null;
    const baseKt = baseMs != null ? baseMs * MS_TO_KT : null;
    const key = `${r.sailor}|${r.board}|${r.sail}`;
    (combos[key] ||= []).push({ baseKt, planed: (r.planed || "").toLowerCase(),
      max: num(r.max_speed_kt), powered: r.powered || "" });
  }
  return Object.entries(combos).map(([key, recs]) => {
    const [sailor, board, sail] = key.split("|");
    const planedWinds = recs.filter((x) => x.planed === "y" && x.baseKt != null).map((x) => x.baseKt);
    const maxes = recs.map((x) => x.max).filter((x) => x != null);
    return {
      sailor, board, sail, n: recs.length,
      floor_kt: planedWinds.length ? Math.min(...planedWinds) : null,
      best_kt: maxes.length ? Math.max(...maxes) : null,
      feels: [...new Set(recs.map((x) => x.powered).filter(Boolean))],
    };
  });
}

// learned floors for the recommender: lowest measured base each sailor planed at
export function learnedFloors(sessions, observations) {
  const obs = Object.fromEntries(observations.map((o) => [o.session_id, o]));
  const out = {};
  for (const r of sessions) {
    const o = obs[r.session_id];
    const baseMs = o ? num(o.obs_base_ms) : null;
    if ((r.planed || "").toLowerCase() === "y" && baseMs != null) {
      const kt = baseMs * MS_TO_KT;
      out[r.sailor] = out[r.sailor] == null ? kt : Math.min(out[r.sailor], kt);
    }
  }
  return out;
}
