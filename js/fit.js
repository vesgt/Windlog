// fit.js — parse a Garmin .fit in the browser using the official Garmin
// FIT SDK loaded from jsdelivr (ESM). Returns max speed (kt) + planing minutes.
// Needs connectivity the first time (CDN). Falls back gracefully if offline:
// the Log form still accepts a manually typed max speed.

const MS_TO_KT = 1.943844;
const SPIKE_KT = 45;

let _sdk = null;
async function sdk() {
  if (_sdk) return _sdk;
  _sdk = await import("https://cdn.jsdelivr.net/npm/@garmin/fitsdk/+esm");
  return _sdk;
}

export function summarise(speedsMs, dtS = 1, planingKt = 12, movingKt = 2) {
  const kt = speedsMs.filter((s) => s != null).map((s) => s * MS_TO_KT).filter((s) => s >= 0 && s < SPIKE_KT);
  if (!kt.length) return { max_speed_kt: 0, avg_moving_kt: 0, mins_planing: 0, mins_moving: 0, samples: 0 };
  const moving = kt.filter((s) => s >= movingKt);
  const planing = kt.filter((s) => s >= planingKt);
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    max_speed_kt: round1(Math.max(...kt)),
    avg_moving_kt: moving.length ? round1(moving.reduce((a, b) => a + b, 0) / moving.length) : 0,
    mins_planing: round1((planing.length * dtS) / 60),
    mins_moving: round1((moving.length * dtS) / 60),
    samples: kt.length,
  };
}

export async function parseFit(arrayBuffer, planingKt = 12) {
  const { Decoder, Stream } = await sdk();
  const stream = Stream.fromArrayBuffer(arrayBuffer);
  const decoder = new Decoder(stream);
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
  let dt = 1;
  const clean = times.filter((t) => t != null);
  if (clean.length >= 2) {
    const span = (clean[clean.length - 1] - clean[0]) / 1000;
    if (span > 0) dt = span / (clean.length - 1);
  }
  return summarise(speeds, dt, planingKt);
}
