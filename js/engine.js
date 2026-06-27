// engine.js — gear recommender + reliability/threshold analysis + automatic
// session assessment. Pure functions, no DOM, no storage.

export const MS_TO_KT = 1.943844;

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

export function dadKit(base) {
  // Dad's daily board is the 169 — keep him on it every day, just trim the sail.
  if (base < 8)  return ["carve169", 7.8, "below threshold in the base — gust-hunting (a 9.0 fixes this)"];
  if (base < 10) return ["carve169", 7.5, "getting going, powered in the gusts"];
  if (base < 12) return ["carve169", 6.9, "well powered and settled"];
  if (base < 15) return ["carve169", 6.0, "lit on the 169 — sheet out the gusts"];
  return ["carve169", 5.5, "strong-wind setup, staying on the 169"];
}

// ideal centre wind (kt) for a sail at a given rider weight — shared by the
// power read and the automatic assessment so they agree.
export function idealCentreKt(sail, weight) {
  return (49 - 4.67 * sail) * Math.sqrt(weight / 75);
}

// Gust-aware sail tweak. Base wind decides whether you'll plane (that's the
// kit's job); the GUSTS decide how overpowered you get up top. This takes the
// base-chosen sail and steps it DOWN — never up — until its top end covers the
// gusts, so a gusty forecast rigs you smaller than a steady one at the same base.
// A sail is "blown out" roughly OVERPOWER_KT above its centre wind.
const OVERPOWER_KT = 8;
export function gustAdjustSail(sail, gustKt, weight, sails) {
  if (gustKt == null || !sails || !sails.length) return { sail, downsized: false };
  const blowout = (s) => idealCentreKt(s, weight) + OVERPOWER_KT;
  const smaller = [...sails].filter((s) => s <= sail).sort((a, b) => b - a); // big→small
  let chosen = sail;
  for (const s of smaller) {
    chosen = s;
    if (gustKt <= blowout(s)) break;   // this size handles the peaks — stop here
  }
  return { sail: chosen, downsized: chosen < sail };
}

export function powerNote(base, gust, sail, weight) {
  const baseKt = base * MS_TO_KT, gustKt = gust * MS_TO_KT;
  const ideal = idealCentreKt(sail, weight);
  if (baseKt < ideal - 4) {
    if (gustKt >= ideal - 1) return "marginal — powered only in gusts";
    return "under-powered";
  }
  if (baseKt > ideal + 5) return "overpowered up top — sheet out / size down";
  return "nicely matched";
}

// ── automatic session assessment ──────────────────────────────────
// Decides whether you actually planed and whether the sail was a good call,
// from the planing ratio (FIT) cross-checked against measured wind. No self-
// assessment. Returns { planed:'y'|'n', powered:'under'|'ideal'|'over',
//   label, ratioPct }.  Any input may be null; it does the best it can.
export function assessSession({ planingRatio, baseKt, gustKt, sail, weight }) {
  const ideal = (baseKt != null && sail) ? idealCentreKt(sail, weight) : null;
  const pct = planingRatio != null ? Math.round(planingRatio * 100) : null;

  // No FIT ratio: fall back to a wind-vs-gear expectation, planed unknown.
  if (planingRatio == null) {
    if (baseKt == null) return { planed: "", powered: "", label: "no data to assess — add a FIT or measured wind", ratioPct: null };
    let powered = "ideal";
    if (baseKt < ideal - 4) powered = (gustKt != null && gustKt >= ideal - 1) ? "under" : "under";
    else if (baseKt > ideal + 5) powered = "over";
    const exp = powered === "ideal" ? "wind suited the sail" : powered === "over" ? "likely overpowered for the sail" : "likely underpowered/under-winded";
    return { planed: "", powered, label: `${exp} (from wind only — no FIT)`, ratioPct: null };
  }

  const planed = planingRatio >= 0.1 ? "y" : "n";

  if (planingRatio >= 0.6) {
    // planed most of the time → good call, unless gusts ran well over range
    if (ideal != null && gustKt != null && gustKt > ideal + 12) {
      return { planed, powered: "over", ratioPct: pct,
        label: `overpowered — planing ${pct}% but gusts ran well over the sail's range; size down next time` };
    }
    return { planed, powered: "ideal", ratioPct: pct, label: `good call — planing ${pct}% of the time` };
  }

  if (planingRatio >= 0.25) {
    const lulls = (ideal != null && baseKt < ideal - 4) ? ", and the wind was light" : "; sized a touch small for the lulls — size up";
    return { planed, powered: "under", ratioPct: pct, label: `marginal — planing only ${pct}%${lulls}` };
  }

  // barely planed
  if (ideal != null && baseKt < ideal - 4) {
    return { planed, powered: "under", ratioPct: pct,
      label: `under-winded — planing ${pct}%, base only ${Math.round(baseKt)} kt; not the gear's fault` };
  }
  return { planed, powered: "under", ratioPct: pct,
    label: `underpowered — planing ${pct}% despite ${baseKt != null ? Math.round(baseKt) + " kt base" : "usable wind"}; size up` };
}

// Plain go/no-go for one sailor at a given base wind vs their learned planing
// floor. Needs real logged floors to be meaningful; returns null without one.
export function goNoGo(baseKt, floorKt) {
  if (floorKt == null || baseKt == null) return null;
  if (baseKt >= floorKt + 2) return "GO";
  if (baseKt >= floorKt - 1) return "MARGINAL";
  return "NO-GO";
}

// Apply each model's learned bias back onto a fresh forecast: a model that
// always over-reads gusts here gets pulled down to its measured tendency. Bias
// is forecast−measured, so corrected = forecast − bias. Only kicks in once a
// model has BIAS_MIN_N matched days here. relForSpot is modelReliability()[spot].
const BIAS_MIN_N = 3;
export function biasCorrect(models, relForSpot) {
  const by = relForSpot ? Object.fromEntries(relForSpot.map((r) => [r.model, r])) : {};
  const adj = (v, bias) => (v == null || v === "" || bias == null) ? v
    : Math.round(Math.max(0, v - bias) * 10) / 10;
  return models.map((m) => {
    const r = by[m.model];
    if (!r || (r.n || 0) < BIAS_MIN_N) return { ...m, corrected: false };
    return { ...m, base_ms: adj(m.base_ms, r.baseBias), gust_ms: adj(m.gust_ms, r.gustBias), corrected: true };
  });
}

// Spread of the models' base wind (kt) — small = models agree = confident call.
export function modelAgreement(models) {
  const bases = models.map((m) => m.base_ms).filter((x) => x != null && x !== "");
  if (bases.length < 2) return { spreadKt: null, level: "thin", n: bases.length };
  const spreadMs = Math.max(...bases) - Math.min(...bases);
  const spreadKt = spreadMs * MS_TO_KT;
  const level = spreadKt <= 4 ? "solid" : spreadKt <= 8 ? "fair" : "split";
  return { spreadKt: Math.round(spreadKt * 10) / 10, level, n: bases.length };
}

// Nearest configured spot to a lat/lon (e.g. from a FIT's GPS), so the Log tab
// can auto-pick where you sailed. Returns { key, spot, km } or null if too far
// from any known spot (default 5 km — beyond that it's somewhere new).
function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371, r = Math.PI / 180;
  const dLa = (la2 - la1) * r, dLo = (lo2 - lo1) * r;
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function nearestSpot(lat, lon, spots, maxKm = 5) {
  if (lat == null || lon == null) return null;
  let best = null, bestD = Infinity;
  for (const [key, sp] of Object.entries(spots)) {
    if (sp.lat == null || sp.lon == null) continue;
    const d = haversineKm(lat, lon, sp.lat, sp.lon);
    if (d < bestD) { best = { key, spot: sp, km: Math.round(d * 10) / 10 }; bestD = d; }
  }
  return best && bestD <= maxKm ? best : null;
}

export function pickSpots(dir, spots) {
  const D = dir.toUpperCase();
  return Object.entries(spots).filter(([, s]) => s.good_dirs.includes(D));
}

export function boardName(boards, id) {
  const b = boards.find((x) => x.id === id);
  return b ? `${b.name} (${b.litres}L)` : id;
}

export function recommend(base, gust, dir, config, learnedF = {}) {
  const out = { base, gust, dir: dir.toUpperCase(), baseKt: base * MS_TO_KT, gustKt: gust * MS_TO_KT, sailors: [], spots: [] };
  for (const [who, fn] of [["joel", joelKit], ["dad", dadKit]]) {
    const s = config.sailors[who];
    const [bid, sail0, note0] = fn(base, gust);
    const { sail, downsized } = gustAdjustSail(sail0, out.gustKt, s.weight_kg, config.sails);
    const note = downsized ? `${note0} · sized down to ${sail} for the gusts` : note0;
    const pn = powerNote(base, gust, sail, s.weight_kg);
    const floor = learnedF[who];
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
  const err = {};
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
      model, baseBias: mean(e.base), baseMAE: bMAE, gustBias: mean(e.gust), gustMAE: gMAE,
      n: Math.max(e.base.length, e.gust.length), score: (bMAE ?? 9) + (gMAE ?? 9),
    });
  }
  for (const spot of Object.keys(bySpot)) bySpot[spot].sort((a, b) => a.score - b.score);
  return bySpot;
}

// Turn a spot's reliability rows into blend weights: lower error → more weight.
// Models with no track record still get a small baseline so they're not ignored
// on day one. Returns { MODEL: weight }.
export function modelWeights(relForSpot) {
  const out = {};
  if (!relForSpot || !relForSpot.length) return out;
  for (const m of relForSpot) {
    const err = (m.baseMAE ?? 4) + (m.gustMAE ?? 4);    // kt-ish, smaller is better
    const conf = Math.min(1, (m.n || 0) / 5);           // ramps in over ~5 matched days
    out[m.model] = (1 / (1 + err)) * (0.3 + 0.7 * conf);
  }
  return out;
}

// A 0–100 trust score per model for display: 100 = perfect, falls with error and
// with thin sample sizes. Plain-language "how wrong" lives in app.js.
export function trustScore(m) {
  const err = (m.baseMAE ?? 4) + (m.gustMAE ?? 4);
  const conf = Math.min(1, (m.n || 0) / 5);
  const raw = (1 / (1 + err)) * (0.4 + 0.6 * conf);     // 0..1
  return Math.round(raw * 100);
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
    return { sailor, board, sail, n: recs.length,
      floor_kt: planedWinds.length ? Math.min(...planedWinds) : null,
      best_kt: maxes.length ? Math.max(...maxes) : null,
      feels: [...new Set(recs.map((x) => x.powered).filter(Boolean))] };
  });
}

// ── progression ───────────────────────────────────────────────────
// What to practise given today's wind — tuned for two intermediates working on
// planing, tacks and jibes.
export function drillOfTheDay(baseKt, gustKt) {
  if (baseKt == null) return null;
  const gf = baseKt ? gustKt / baseKt : 1.4;
  if (baseKt < 10) return { title: "Light-wind skills", detail: "uphaul, balance and slow tacks — non-planing board work that pays off later." };
  if (baseKt < 14) return { title: "Tacks & getting planing", detail: "steady enough to work upwind and drill tacks; hunt the gusts onto the plane." };
  if (gf > 1.9)    return { title: "Control in the gusts", detail: "gusty and lit — stay in control and sheet through the gusts; survival over finesse." };
  if (baseKt < 20) return { title: "Carve jibes", detail: "planing and steady — the day to commit: speed in, carve, flip, plane out." };
  return { title: "Speed & control", detail: "strong and lit — small kit, work speed runs and staying pinned." };
}

// Per-sailor planing-ratio history (chronological) — the core progress curve.
export function planingTrend(sessions) {
  const out = {};
  for (const s of sessions) {
    const r = parseFloat(s.planing_ratio);
    if (!Number.isFinite(r)) continue;
    (out[s.sailor] ||= []).push({ date: s.date, ratio: r });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// Per-sailor tack/jibe attempt + make totals → success rates.
export function skillRates(sessions) {
  const out = {};
  const n = (x) => { const v = parseInt(x, 10); return Number.isFinite(v) ? v : 0; };
  for (const s of sessions) {
    const o = (out[s.sailor] ||= { tacksTried: 0, tacksMade: 0, jibesTried: 0, jibesMade: 0 });
    o.tacksTried += n(s.tacks_tried); o.tacksMade += n(s.tacks_made);
    o.jibesTried += n(s.jibes_tried); o.jibesMade += n(s.jibes_made);
  }
  return out;
}

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
