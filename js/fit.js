// fit.js — parse a Garmin .fit in the browser using the official Garmin
// FIT SDK from jsdelivr (ESM). Returns max speed, planing minutes, the
// planing RATIO (share of moving time actually on plane), and the real
// session start/end timestamps so wind can be pulled for the exact window.
// Needs connectivity the first time (CDN). Offline → type max speed by hand.

const MS_TO_KT = 1.943844;
const SPIKE_KT = 45;

let _sdk = null;
async function sdk() {
  if (_sdk) return _sdk;
  _sdk = await import("https://cdn.jsdelivr.net/npm/@garmin/fitsdk/+esm");
  return _sdk;
}

// planingKt = boardspeed at which these boards are up and planing (~12 kt).
// movingKt   = above this you're sailing, not drifting; used as the denominator
//              so schlogging/floating time doesn't distort the ratio. The
//              lowest GPS speed (e.g. 2.7 kt) is never treated as meaningful.
export function summarise(speedsMs, dtS = 1, planingKt = 12, movingKt = 4) {
  const kt = speedsMs.filter((s) => s != null).map((s) => s * MS_TO_KT).filter((s) => s >= 0 && s < SPIKE_KT);
  if (!kt.length) return { max_speed_kt: 0, mins_planing: 0, mins_moving: 0, planing_ratio: null, samples: 0 };
  const movingN = kt.filter((s) => s >= movingKt).length;
  const planingN = kt.filter((s) => s >= planingKt).length;
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    max_speed_kt: round1(Math.max(...kt)),
    mins_planing: round1((planingN * dtS) / 60),
    mins_moving: round1((movingN * dtS) / 60),
    planing_ratio: movingN ? Math.round((planingN / movingN) * 100) / 100 : null,
    samples: kt.length,
  };
}

export async function parseFit(arrayBuffer, planingKt = 12) {
  const { Decoder, Stream } = await sdk();
  const decoder = new Decoder(Stream.fromArrayBuffer(arrayBuffer));
  if (!decoder.isFIT()) throw new Error("Not a FIT file");
  const { messages } = decoder.read({
    convertTypesToStrings: true, convertDateTimesToDates: true,
    includeUnknownData: false, mergeHeartRates: false,
  });
  const records = messages.recordMesgs || [];
  const speeds = [], times = [];
  for (const r of records) {
    const v = r.enhancedSpeed != null ? r.enhancedSpeed : r.speed;
    if (v != null) { speeds.push(v); times.push(r.timestamp ? new Date(r.timestamp).getTime() : null); }
  }
  const clean = times.filter((t) => t != null);
  let dt = 1, startMs = null, endMs = null;
  if (clean.length >= 2) {
    startMs = clean[0]; endMs = clean[clean.length - 1];
    const span = (endMs - startMs) / 1000;
    if (span > 0) dt = span / (clean.length - 1);
  }
  return { ...summarise(speeds, dt, planingKt), startMs, endMs };
}
