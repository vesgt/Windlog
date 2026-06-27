// ocr.js — read a PredictWind screenshot in the browser, no backend. Tesseract.js
// is lazy-loaded from a CDN only when you actually scan, then a heuristic pulls
// each model's base/gust/dir out of the recognised text. OCR on PW's dense tables
// is imperfect by nature — this pre-fills the grid; you correct before saving.

let _tess = null;
async function tesseract() {
  if (_tess) return _tess;
  _tess = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js");
  return _tess;
}

// Recognise text from an image File/Blob. onProgress(0..1) for a status line.
export async function recognize(file, onProgress) {
  const { createWorker } = await tesseract();
  const worker = await createWorker("eng", 1, {
    logger: (m) => { if (m.status === "recognizing text" && onProgress) onProgress(m.progress); },
  });
  try {
    const url = URL.createObjectURL(file);
    const { data } = await worker.recognize(url);
    URL.revokeObjectURL(url);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
}

const DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const degToCompass = (d) => DIRS[Math.round(d / 22.5) % 16];

// Pull the numeric/direction tokens out of one text line.
function tokensOf(line) {
  const nums = (line.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n >= 0 && n < 80);
  const degM = line.match(/(\d{1,3})\s*°/);
  let dir = "";
  const compass = line.toUpperCase().match(/\b(N|NNE|NE|ENE|E|ESE|SE|SSE|S|SSW|SW|WSW|W|WNW|NW|NNW)\b/);
  if (degM) dir = degToCompass(+degM[1]);
  else if (compass) dir = compass[1];
  return { nums, dir };
}

// Best-effort: for each model label, find the line that mentions it and take the
// first two numbers as base/gust. Returns { LABEL: {base_ms,gust_ms,dir} } for
// whatever it could find; everything missing stays for the user to type.
// `labels` is the model names shown in the grid (e.g. ["PWE","PWG","ECMWF","GFS"]).
export function parsePredictWind(text, labels) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out = {};
  for (const label of labels) {
    const key = label.replace(/[^a-z0-9]/gi, "").toLowerCase();
    // match PW aliases without matching the header: PW_PE / PWE both → "pwe"
    const aliases = [key];
    if (/pe$/.test(key)) aliases.push("pwe");
    if (/pg$/.test(key)) aliases.push("pwg");
    const line = lines.find((l) => {
      const norm = l.replace(/[^a-z0-9]/gi, "").toLowerCase();
      return aliases.some((a) => norm.includes(a));
    });
    if (!line) continue;
    const { nums, dir } = tokensOf(line);
    if (!nums.length) continue;
    out[label] = {
      base_ms: nums[0] ?? "",
      gust_ms: nums[1] ?? "",
      dir: dir || "",
    };
  }
  return out;
}
