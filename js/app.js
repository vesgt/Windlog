// app.js — UI rendering and wiring. No framework; small render functions.
import * as store from "./store.js";
import * as engine from "./engine.js";
import { parseFit } from "./fit.js";
import { fetchObservation } from "./smhi.js";
import { fetchAllSpots, consensus, bestWindow } from "./forecast.js";
import { recognize, parsePredictWind } from "./ocr.js";

let data = store.load();
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const KT = engine.MS_TO_KT;
const hhmm = (ms) => { const d = new Date(ms); return d.toTimeString().slice(0, 5); };

function windColor(kt) {
  const stops = [[0,"#2f6fb0"],[8,"#36a0c0"],[12,"#4ec07a"],[16,"#b9cf45"],[20,"#e8c93a"],[24,"#e89a3a"],[28,"#e2603f"],[34,"#b73f2f"]];
  let c = stops[0][1];
  for (const [t, col] of stops) { if (kt >= t) c = col; }
  return c;
}
const scalePos = (kt) => Math.max(0, Math.min(100, (kt / 34) * 100));
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }

// ── TODAY ─────────────────────────────────────────────
const today = { base: 6, gust: 11, dir: "S" };
let liveForecasts = null;     // { spotKey: { models:[...], fetched_at, error? } }
let liveBusy = false;
const ALL_DIRS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];

// weights per spot from the reliability track record, for the blended call
function weightsForSpot(spotKey) {
  const rel = engine.modelReliability(data.forecasts, data.observations);
  return engine.modelWeights(rel[spotKey]);
}

// a spot's live models with each one's learned bias subtracted out
function liveModels(spotKey) {
  const f = liveForecasts?.[spotKey];
  if (!f || f.error || !f.models?.length) return [];
  const rel = engine.modelReliability(data.forecasts, data.observations);
  return engine.biasCorrect(f.models, rel[spotKey]);
}

// Write the freshly-polled models into the forecast log so reliability builds
// itself with no typing. One auto row per model per spot per day; manual rows
// and PredictWind rows are left untouched.
function captureForecasts(bySpot, dayISO) {
  for (const [spotKey, f] of Object.entries(bySpot)) {
    if (!f || f.error || !f.models?.length) continue;
    const sid = store.sessionId(dayISO, spotKey);
    for (const m of f.models) {
      const existing = data.forecasts.find((r) => r.session_id === sid && r.model === m.model);
      if (existing && existing.source !== "auto") continue;   // never clobber manual/PW
      store.upsertForecast(data, { session_id: sid, model: m.model, base_ms: m.base_ms,
        gust_ms: m.gust_ms, dir: m.dir, captured_at: f.fetched_at, source: "auto" });
    }
  }
}

async function pollForecasts(force) {
  if (liveBusy) return;
  liveBusy = true;
  const day = new Date().toISOString().slice(0, 10);
  try {
    liveForecasts = await fetchAllSpots(data.config.spots, { force });
    captureForecasts(liveForecasts, day);
  } catch { /* leave whatever we had */ }
  liveBusy = false;
}

// Rank spots by today's blended call: direction-matched + windiest first, each
// scored go/no-go per sailor against their learned floor, with the best window.
function rankSpots() {
  if (!liveForecasts) return [];
  const floors = engine.learnedFloors(data.sessions, data.observations);
  const rows = [];
  for (const [key, sp] of Object.entries(data.config.spots)) {
    const f = liveForecasts[key];
    if (!f || f.error || !f.models?.length) continue;
    const models = liveModels(key);
    const c = consensus(models, weightsForSpot(key));
    if (!c || c.base_ms == null) continue;
    const baseKt = c.base_ms * engine.MS_TO_KT;
    const dirMatch = !!sp.good_dirs?.includes((c.dir || "").toUpperCase());
    const sailors = Object.entries(data.config.sailors).map(([who, s]) => ({
      name: s.name, gng: engine.goNoGo(baseKt, floors[who]) }));
    rows.push({ key, sp, c, baseKt, dirMatch, hourly: f.hourly || [],
      corrected: models.some((m) => m.corrected),
      window: bestWindow(f.hourly), agree: engine.modelAgreement(models), sailors });
  }
  rows.sort((a, b) => (b.dirMatch - a.dirMatch) || (b.baseKt - a.baseKt));
  return rows;
}

const GNG_CLASS = { "GO": "matched", "MARGINAL": "marginal", "NO-GO": "under" };
function renderToday() {
  const v = $("#view-today"); v.innerHTML = "";

  // best-spot-now banner
  const banner = el("div", "card banner"); banner.id = "t-banner";
  v.appendChild(banner);
  renderBanner();

  // live multi-model forecast per spot, with the blended call
  const live = el("div", "card");
  live.id = "t-live";
  v.appendChild(live);
  renderLive();

  const inp = el("div", "card");
  inp.innerHTML = `
    <details ${liveForecasts ? "" : "open"}><summary class="section" style="margin:0;cursor:pointer">Override the call</summary>
    <div class="hint" style="margin:8px 0">Tap a spot above to load its blended forecast, or set the number you'd actually bet on.</div>
    <div class="row">
      <label class="fld"><span class="lab">Base m/s</span><input class="num" id="t-base" type="number" inputmode="decimal" step="0.5" value="${today.base}"></label>
      <label class="fld"><span class="lab">Gust m/s</span><input class="num" id="t-gust" type="number" inputmode="decimal" step="0.5" value="${today.gust}"></label>
    </div>
    <label class="fld"><span class="lab">Direction</span>
      <select class="num" id="t-dir">${ALL_DIRS.map(d=>`<option ${d===today.dir?"selected":""}>${d}</option>`).join("")}</select>
    </label></details>`;
  v.appendChild(inp);
  const out = el("div"); out.id = "t-out"; v.appendChild(out);
  const recompute = () => {
    today.base = parseFloat($("#t-base").value) || 0;
    today.gust = parseFloat($("#t-gust").value) || 0;
    today.dir = $("#t-dir").value;
    renderRecommendation(out);
  };
  $("#t-base").oninput = recompute; $("#t-gust").oninput = recompute; $("#t-dir").onchange = recompute;
  recompute();

  // first paint: if we have nothing yet, fetch and re-render
  if (!liveForecasts) pollForecasts(false).then(() => { if (currentTab === "today") renderToday(); });
}

// set the trusted call from a spot's blended forecast and refresh inputs
function useSpot(spotKey) {
  const models = liveModels(spotKey);
  if (!models.length) return;
  const c = consensus(models, weightsForSpot(spotKey));
  if (!c) return;
  if (c.base_ms != null) today.base = c.base_ms;
  if (c.gust_ms != null) today.gust = c.gust_ms;
  if (c.dir) today.dir = c.dir;
  renderToday();
}

// Compact hourly wind timeline: base as a coloured bar, gust as a faint cap,
// the best window highlighted. Pure inline markup, no chart lib.
function sparkline(hourly, win) {
  if (!hourly || hourly.length < 2) return "";
  const top = Math.max(15, ...hourly.map((p) => p.gust_ms || 0));
  const bars = hourly.map((p) => {
    const inWin = win && p.h >= win.from && p.h <= win.to;
    const bh = Math.round(((p.base_ms || 0) / top) * 100);
    const gh = Math.round(((p.gust_ms || 0) / top) * 100);
    const kt = (p.base_ms || 0) * KT;
    return `<div class="spk-col${inWin ? " win" : ""}" title="${p.h}:00 — ${p.base_ms}/${p.gust_ms} m/s ${p.dir||""}">
      <div class="spk-gust" style="height:${gh}%"></div>
      <div class="spk-base" style="height:${bh}%;background:${windColor(kt)}"></div></div>`;
  }).join("");
  const first = hourly[0].h, last = hourly[hourly.length - 1].h;
  return `<div class="spark"><div class="spk-bars">${bars}</div>
    <div class="spk-axis"><span>${first}:00</span><span>${last}:00</span></div></div>`;
}

// One-line read on whether today favours one sailor over the other.
function whoseDayLine(sailors) {
  const rank = { "GO": 2, "MARGINAL": 1, "NO-GO": 0 };
  const known = sailors.filter((s) => s.gng);
  if (known.length < 2) return "";
  const [a, b] = known;
  if (rank[a.gng] === rank[b.gng]) {
    if (a.gng === "GO") return "🌬️ On for you both.";
    if (a.gng === "NO-GO") return "Too light for either of you right now.";
    return "Marginal for you both — gust-dependent.";
  }
  const hi = rank[a.gng] > rank[b.gng] ? a : b, lo = hi === a ? b : a;
  return `Better day for <b>${hi.name}</b> (${hi.gng}) than ${lo.name} (${lo.gng}).`;
}

function renderBanner() {
  const box = $("#t-banner"); if (!box) return;
  if (!liveForecasts) {
    box.innerHTML = `<div class="hint" style="margin:0">Fetching the call for every spot…</div>`;
    return;
  }
  const ranked = rankSpots();
  if (!ranked.length) {
    box.innerHTML = `<div class="hint" style="margin:0">No live wind yet — tap ⟳ below, or set the call by hand.</div>`;
    return;
  }
  const top = ranked[0];
  const win = top.window;
  const winTxt = win ? `best window <b>${String(win.from).padStart(2,"0")}–${String(win.to).padStart(2,"0")}h</b> (${win.avgBase} m/s)` : "";
  const agreeTxt = top.agree.spreadKt == null ? "" :
    `<span class="agree ${top.agree.level}">models ${top.agree.level}${top.agree.level!=="solid"?` ±${top.agree.spreadKt}kt`:""}</span>`;
  const sailorChips = top.sailors.filter((s) => s.gng).map((s) =>
    `<span class="gng ${GNG_CLASS[s.gng]}">${s.name}: ${s.gng}</span>`).join("");
  const whose = whoseDayLine(top.sailors);
  const corr = top.corrected ? `<span class="agree solid" title="adjusted using your logged reliability">bias-corrected</span>` : "";
  box.innerHTML = `
    <div class="banner-head"><span class="kick">Best right now</span>${agreeTxt}${corr}</div>
    <div class="banner-spot">${top.sp.name} <span class="bw">${top.c.base_ms}–${top.c.gust_ms} m/s ${top.c.dir||""}</span></div>
    <div class="banner-sub">${top.dirMatch ? "✓ direction suits this spot" : "⚠︎ direction is off for all spots — best of a bad set"}${winTxt ? " · "+winTxt : ""}</div>
    ${sparkline(top.hourly, top.window)}
    ${sailorChips ? `<div class="banner-chips">${sailorChips}</div>` : `<div class="hint" style="margin:6px 0 0">Log sessions with SMHI wind to unlock GO/NO-GO per sailor.</div>`}
    ${whose ? `<div class="whose">${whose}</div>` : ""}
    <button class="btn sm ghost" id="t-banner-use" style="width:auto;margin-top:10px;padding:5px 14px">Use this call</button>`;
  $("#t-banner-use").onclick = () => useSpot(top.key);
}

function renderLive() {
  const box = $("#t-live"); if (!box) return;
  const spots = data.config.spots;
  const updated = liveForecasts ? Object.values(liveForecasts).find((f) => f && f.fetched_at)?.fetched_at : null;
  box.innerHTML = `<div class="row" style="align-items:center;justify-content:space-between">
      <h2 class="section" style="margin:0">Live forecast</h2>
      <button class="icon-btn" id="t-refresh" title="Refresh" aria-label="Refresh forecasts">${liveBusy ? "…" : "⟳"}</button>
    </div>
    <div class="hint" style="margin:4px 0 10px">${liveBusy ? "Fetching YR · ECMWF · GFS · ICON…" : updated ? `Auto-polled · ${updated.replace("T"," ")} · tap a spot to use it` : "Open to fetch — YR, ECMWF, GFS, ICON per spot"}</div>`;
  if (liveForecasts) {
    Object.entries(spots).forEach(([key, sp], i) => {
      const f = liveForecasts[key];
      if (i) box.appendChild(el("div", "divider"));
      const card = el("div", "spotlive");
      if (!f || f.error || !f.models.length) {
        card.innerHTML = `<div class="nm">${sp.name}</div><div class="hint">${f?.error ? "fetch blocked — "+f.error : "no data"}</div>`;
      } else {
        const models = liveModels(key);
        const c = consensus(models, weightsForSpot(key));
        const anyCorr = models.some((m) => m.corrected);
        const rows = models.map((m) => `<tr><td>${m.model}${m.corrected ? '<span class="corr">•</span>' : ""}</td><td>${m.base_ms ?? "–"}</td><td>${m.gust_ms ?? "–"}</td><td>${m.dir || "–"}</td></tr>`).join("");
        const ck = c ? `${c.base_ms ?? "–"}–${c.gust_ms ?? "–"} m/s ${c.dir || ""}` : "–";
        card.innerHTML = `
          <div class="row" style="align-items:baseline;justify-content:space-between">
            <div class="nm">${sp.name}</div>
            <button class="btn sm ghost" data-spot="${key}" style="width:auto;padding:4px 12px">Use · ${ck}</button>
          </div>
          <table class="tbl"><thead><tr><th>model</th><th>base</th><th>gust</th><th>dir</th></tr></thead><tbody>${rows}</tbody></table>
          ${anyCorr ? '<div class="hint" style="margin-top:6px">• adjusted from your logged reliability</div>' : ""}`;
      }
      box.appendChild(card);
    });
  }
  const rb = $("#t-refresh");
  if (rb) rb.onclick = async () => { await pollForecasts(true); renderToday(); };
  box.querySelectorAll("[data-spot]").forEach((b) => b.onclick = () => useSpot(b.dataset.spot));
}
function renderRecommendation(out) {
  const floors = engine.learnedFloors(data.sessions, data.observations);
  const r = engine.recommend(today.base, today.gust, today.dir, data.config, floors);
  out.innerHTML = "";
  const hero = el("div", "card windhero");
  const bk = r.baseKt, gk = r.gustKt;
  hero.innerHTML = `
    <div class="dir"><span class="arrow">➜</span><b>${r.dir}</b><span>· base & gust</span></div>
    <div class="scale-track">
      <div class="pin base" style="left:${scalePos(bk)}%"><div class="dot" style="background:${windColor(bk)}"></div><div class="lab">${bk.toFixed(0)}<span class="u">kt base</span></div></div>
      <div class="pin gust" style="left:${scalePos(gk)}%"><div class="dot" style="background:${windColor(gk)}"></div><div class="lab">${gk.toFixed(0)}<span class="u">kt gust</span></div></div>
    </div>
    <div class="scale-ends"><span>0</span><span>light</span><span>planing</span><span>lit</span><span>34+ kt</span></div>`;
  out.appendChild(hero);
  const gc = el("div", "card");
  gc.innerHTML = `<h2 class="section" style="margin-top:0">Gear</h2>`;
  r.sailors.forEach((s, i) => {
    if (i) gc.appendChild(el("div", "divider"));
    const pc = s.power.includes("matched") ? "matched" : s.power.startsWith("over") ? "over" : s.power.startsWith("marginal") ? "marginal" : "under";
    const g = el("div", "gear");
    g.innerHTML = `
      <div class="who"><div class="nm">${s.name}</div><div class="wt num">${s.weight}kg</div></div>
      <div class="kit">
        <div class="line"><span class="pill board">${s.board}</span><span class="pill sail">${s.sail} m²</span></div>
        <div class="note">${s.note}</div>
        <span class="power ${pc}">${s.power}</span>
        ${s.verdict ? `<span class="power ${s.verdict.startsWith("planing")?"matched":"marginal"}" style="margin-left:6px">logged floor ${s.floor.toFixed(0)}kt → ${s.verdict}</span>` : ""}
      </div>`;
    gc.appendChild(g);
  });
  out.appendChild(gc);
  const sc = el("div", "card spotcard");
  sc.innerHTML = `<h2 class="section" style="margin-top:0">Spot for ${r.dir}</h2>`;
  if (r.spots.length) {
    r.spots.forEach((sp, i) => {
      if (i) sc.appendChild(el("div", "divider"));
      sc.appendChild(el("div", "", `<div class="nm">${sp.name}</div><div class="area">${sp.area}</div><div class="launch">${sp.launch}</div>`));
    });
  } else sc.appendChild(el("div", "hint", `No configured spot faces ${r.dir}. Add one in Setup.`));
  out.appendChild(sc);

  const drill = engine.drillOfTheDay(r.baseKt, r.gustKt);
  if (drill) {
    const dc = el("div", "card drillcard");
    dc.innerHTML = `<div class="kick">Drill today</div><div class="drill-t">${drill.title}</div><div class="drill-d">${drill.detail}</div>`;
    out.appendChild(dc);
  }

  // what-if: every sail at this wind, per sailor
  const wc = el("div", "card");
  const cls = (p) => p.includes("matched") ? "matched" : p.startsWith("over") ? "over" : p.startsWith("marginal") ? "marginal" : "under";
  const sailorIds = Object.keys(data.config.sailors);
  const headCells = sailorIds.map((w) => `<th>${data.config.sailors[w].name}</th>`).join("");
  const rows = [...data.config.sails].sort((a, b) => b - a).map((sail) => {
    const cells = sailorIds.map((w) => {
      const p = engine.powerNote(today.base, today.gust, sail, data.config.sailors[w].weight_kg);
      return `<td><span class="power ${cls(p)} mini">${p}</span></td>`;
    }).join("");
    return `<tr><td>${sail} m²</td>${cells}</tr>`;
  }).join("");
  wc.innerHTML = `<details><summary class="section" style="margin:0;cursor:pointer">What-if — every sail at this wind</summary>
    <table class="tbl whatif" style="margin-top:10px"><thead><tr><th>sail</th>${headCells}</tr></thead><tbody>${rows}</tbody></table></details>`;
  out.appendChild(wc);
}

// ── LOG ───────────────────────────────────────────────
const logForm = { sailor: "joel" };
let lastFit = null; // parsed FIT metrics for the current draft
function renderLog() {
  const v = $("#view-log"); v.innerHTML = "";
  lastFit = null;
  const cfg = data.config;
  const c = el("div", "card");
  const dts = new Date().toISOString().slice(0, 10);
  c.innerHTML = `
    <h2 class="section" style="margin-top:0">New session</h2>
    <div class="row">
      <label class="fld"><span class="lab">Date</span><input id="l-date" type="date" value="${dts}"></label>
      <label class="fld"><span class="lab">Spot</span><select id="l-spot">${Object.entries(cfg.spots).map(([k,s])=>`<option value="${k}">${s.name}</option>`).join("")}</select></label>
    </div>
    <label class="fld"><span class="lab">Sailor</span>
      <div class="seg" id="l-sailor">${Object.entries(cfg.sailors).map(([k,s])=>`<button data-v="${k}" class="${k===logForm.sailor?"on":""}">${s.name}</button>`).join("")}</div>
    </label>
    <div class="row">
      <label class="fld"><span class="lab">Board</span><select id="l-board">${cfg.boards.map(b=>`<option value="${b.id}">${b.name} (${b.litres}L)</option>`).join("")}</select></label>
      <label class="fld"><span class="lab">Sail m²</span><select class="num" id="l-sail">${cfg.sails.map(s=>`<option>${s}</option>`).join("")}</select></label>
    </div>
    <label class="fld"><span class="lab">Garmin .fit — fills speed, planing time & exact wind window</span>
      <input id="l-fit" type="file" accept=".fit"></label>
    <div id="l-fitout"></div>
    <div class="row" id="l-times">
      <label class="fld"><span class="lab">Start (if no FIT)</span><input id="l-start" type="time"></label>
      <label class="fld"><span class="lab">End</span><input id="l-end" type="time"></label>
    </div>
    <div class="row">
      <label class="fld"><span class="lab">Max speed kt</span><input class="num" id="l-max" type="number" inputmode="decimal" step="0.1" placeholder="—"></label>
      <label class="fld"><span class="lab">Planing min</span><input class="num" id="l-plan" type="number" inputmode="decimal" placeholder="—"></label>
    </div>
    <div class="seg-lab">Tacks &amp; jibes — made / tried</div>
    <div class="row">
      <label class="fld"><span class="lab">Tacks made</span><input class="num" id="l-tm" type="number" inputmode="numeric" min="0" placeholder="0"></label>
      <label class="fld"><span class="lab">Tacks tried</span><input class="num" id="l-tt" type="number" inputmode="numeric" min="0" placeholder="0"></label>
    </div>
    <div class="row">
      <label class="fld"><span class="lab">Jibes made</span><input class="num" id="l-jm" type="number" inputmode="numeric" min="0" placeholder="0"></label>
      <label class="fld"><span class="lab">Jibes tried</span><input class="num" id="l-jt" type="number" inputmode="numeric" min="0" placeholder="0"></label>
    </div>
    <label class="fld"><span class="lab">Notes</span><textarea id="l-notes" placeholder="anything worth remembering"></textarea></label>
    <label class="fld"><input id="l-smhi" type="checkbox" style="width:auto;margin-right:8px" checked>Pull SMHI measured wind for the session window</label>
    <button class="btn" id="l-save">Log session</button>
    <div id="l-assess"></div>
    <div class="hint">The sail call is assessed automatically from your planing ratio vs the measured wind — no self-rating. Saved on this device.</div>`;
  v.appendChild(c);
  $("#l-sailor").onclick = (e) => seg(e, "l-sailor", (val) => logForm.sailor = val);
  $("#l-fit").onchange = onFitPick;
  $("#l-save").onclick = saveSession;
}
function seg(e, id, set) {
  const b = e.target.closest("button"); if (!b) return;
  const cur = $(`#${id} .on`);
  if (cur) cur.classList.remove("on"); b.classList.add("on"); set(b.dataset.v);
}
async function onFitPick(e) {
  const f = e.target.files[0]; if (!f) return;
  const out = $("#l-fitout"); out.innerHTML = `<div class="hint">Parsing ${f.name}…</div>`;
  try {
    const m = await parseFit(await f.arrayBuffer());
    lastFit = m;
    $("#l-max").value = m.max_speed_kt; $("#l-plan").value = m.mins_planing;
    if (m.startMs) { $("#l-start").value = hhmm(m.startMs); $("#l-end").value = hhmm(m.endMs); $("#l-times").style.opacity = .5; }
    const ratioTxt = m.planing_ratio != null ? `, planing ${Math.round(m.planing_ratio*100)}% of moving time` : "";
    // auto-pick the spot from the FIT's GPS
    let spotTxt = "";
    const near = engine.nearestSpot(m.lat, m.lon, data.config.spots);
    if (near) { $("#l-spot").value = near.key; spotTxt = ` · ${near.spot.name} (${near.km} km from GPS)`; }
    else if (m.lat != null) spotTxt = " · GPS didn't match a known spot — pick it manually";
    out.innerHTML = `<div class="filechip">✓ ${f.name} — max ${m.max_speed_kt} kt${ratioTxt}${spotTxt}</div>`;
    // provisional assessment (wind pending)
    const prov = engine.assessSession({ planingRatio: m.planing_ratio, baseKt: null, gustKt: null, sail: parseFloat($("#l-sail").value), weight: data.config.sailors[logForm.sailor].weight_kg });
    showAssess(prov, true);
  } catch (err) {
    lastFit = null;
    out.innerHTML = `<div class="hint">Couldn't read that FIT (${err.message}). Type the max speed and start/end by hand.</div>`;
  }
}
function showAssess(a, provisional) {
  const box = $("#l-assess"); if (!box) return;
  if (!a || !a.label) { box.innerHTML = ""; return; }
  const cls = a.powered === "ideal" ? "matched" : a.powered === "over" ? "over" : "under";
  box.innerHTML = `<div class="card tight" style="margin-top:12px"><div style="font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Auto assessment${provisional?" · provisional":""}</div>
    <span class="power ${cls}">${a.planed==="y"?"planed":a.planed==="n"?"schlogged":"—"}</span>
    <span class="power ${cls}" style="margin-left:6px">${a.label}</span></div>`;
}
function windowFromForm() {
  if (lastFit && lastFit.startMs) return { startMs: lastFit.startMs, endMs: lastFit.endMs };
  const d = $("#l-date").value, st = $("#l-start").value, en = $("#l-end").value;
  const out = {};
  if (st) out.startMs = Date.parse(`${d}T${st}:00`);
  if (en) out.endMs = Date.parse(`${d}T${en}:00`);
  if (!st && !en) { out.startMs = Date.parse(`${d}T12:00:00`); out.endMs = Date.parse(`${d}T15:00:00`); }
  return out;
}
async function saveSession() {
  const date = $("#l-date").value, spot = $("#l-spot").value;
  const sid = store.sessionId(date, spot);
  const sailor = logForm.sailor;
  const win = windowFromForm();
  const row = {
    session_id: sid, date, spot, sailor, weight_kg: data.config.sailors[sailor].weight_kg,
    board: $("#l-board").value, sail: parseFloat($("#l-sail").value), fin_cm: "",
    time_start: win.startMs ? hhmm(win.startMs) : "", time_end: win.endMs ? hhmm(win.endMs) : "",
    max_speed_kt: $("#l-max").value, mins_planing: $("#l-plan").value,
    planing_ratio: lastFit && lastFit.planing_ratio != null ? lastFit.planing_ratio : "",
    tacks_tried: $("#l-tt").value, tacks_made: $("#l-tm").value,
    jibes_tried: $("#l-jt").value, jibes_made: $("#l-jm").value,
    powered: "", planed: "", sky: "", air_t: "", water_t: "", notes: $("#l-notes").value,
  };
  store.addSession(data, row); // pushes by reference; we finalise powered/planed below
  const btn = $("#l-save"); btn.disabled = true;

  let obs = null;
  if ($("#l-smhi").checked) {
    btn.textContent = "Fetching SMHI…";
    try {
      const sp = data.config.spots[spot];
      obs = await fetchObservation(sp.lat, sp.lon, win);
      store.upsertObservation(data, { session_id: sid, station_id: obs.station_id, station_name: obs.station_name, obs_base_ms: obs.obs_base_ms, obs_gust_ms: obs.obs_gust_ms, obs_dir: obs.obs_dir, fetched_at: new Date().toISOString().slice(0,16) });
    } catch (err) { obs = null; }
  }

  const baseKt = obs && obs.obs_base_ms !== "" ? parseFloat(obs.obs_base_ms) * KT : null;
  const gustKt = obs && obs.obs_gust_ms !== "" ? parseFloat(obs.obs_gust_ms) * KT : null;
  const a = engine.assessSession({ planingRatio: lastFit ? lastFit.planing_ratio : null, baseKt, gustKt, sail: row.sail, weight: row.weight_kg });
  row.powered = a.powered; row.planed = a.planed; store.save(data);

  btn.textContent = "Saved ✓";
  showAssess(a, false);
  if (obs) toast(`SMHI ${obs.obs_base_ms} m/s base, gust ${obs.obs_gust_ms} (${obs.station_name}) · ${a.powered||"—"}`);
  else if ($("#l-smhi").checked) toast("SMHI blocked — add measured wind in Data to assess");
  else toast(a.label || "Logged");
  setTimeout(() => renderLog(), 1500);
}

// ── STATS ─────────────────────────────────────────────
// Plain-language read on a model's error: how far off and which way.
function howWrong(m) {
  const dir = (x) => (x > 0 ? "over-reads" : "under-reads");
  const parts = [];
  if (m.baseMAE != null) {
    parts.push(m.baseMAE < 1
      ? `nails the base (±${m.baseMAE.toFixed(1)})`
      : `${dir(m.baseBias)} base by ${Math.abs(m.baseBias).toFixed(1)} m/s`);
  }
  if (m.gustMAE != null) {
    parts.push(m.gustMAE < 1.5
      ? `gusts close (±${m.gustMAE.toFixed(1)})`
      : `${dir(m.gustBias)} gusts by ${Math.abs(m.gustBias).toFixed(1)} m/s`);
  }
  return parts.join(" · ") || "not enough matched days yet";
}

function renderStats() {
  const v = $("#view-stats"); v.innerHTML = "";
  const rel = engine.modelReliability(data.forecasts, data.observations);
  const thr = engine.planingThresholds(data.sessions, data.observations);
  const relCard = el("div", "card");
  relCard.innerHTML = `<h2 class="section" style="margin-top:0">Model reliability</h2>`;
  const spots = Object.keys(rel);
  if (!spots.length) {
    relCard.appendChild(el("div", "empty", `<b>No matched pairs yet</b>Log a session with SMHI wind, and the models you entered for that day get scored against what actually blew.`));
  } else {
    for (const spot of spots) {
      const spotName = data.config.spots[spot]?.name || spot;
      relCard.appendChild(el("div", "hint", `<b style="color:var(--text)">${spotName}</b> — ranked by trust; how wrong each runs vs SMHI measured`));
      // headline: trust score + plain-language error per model
      rel[spot].forEach((m, i) => {
        const trust = engine.trustScore(m);
        const row = el("div", "trustrow");
        row.innerHTML = `
          <div class="tr-head"><b class="${i===0?"win":""}">${m.model}</b>
            <span class="tr-score">${trust}<span class="u">/100</span></span></div>
          <div class="tr-bar-track"><div class="tr-bar" style="width:${trust}%"></div></div>
          <div class="tr-say">${howWrong(m)} <span class="sm">· ${m.n} day${m.n>1?"s":""}</span></div>`;
        relCard.appendChild(row);
      });
      relCard.appendChild(el("div", "hint", `Detail — forecast minus measured (m/s); +over-reads, −under-reads`));
      const t = el("table", "tbl");
      t.innerHTML = `<thead><tr><th>Model</th><th>base bias</th><th>base err</th><th>gust bias</th><th>gust err</th><th>n</th></tr></thead>`;
      const tb = el("tbody");
      rel[spot].forEach((m, i) => {
        const sgn = (x) => x == null ? "–" : `<span class="${x>0.3?"bias-hot":x<-0.3?"bias-cold":""}">${x>0?"+":""}${x.toFixed(1)}</span>`;
        const r = el("tr", i === 0 ? "best" : "");
        r.innerHTML = `<td>${m.model}</td><td>${sgn(m.baseBias)}</td><td>${m.baseMAE?.toFixed(1)??"–"}</td><td>${sgn(m.gustBias)}</td><td>${m.gustMAE?.toFixed(1)??"–"}</td><td>${m.n}</td>`;
        tb.appendChild(r);
      });
      t.appendChild(tb); relCard.appendChild(t);
      relCard.appendChild(el("div", "hint", `Most accurate so far: <b style="color:var(--good)">${rel[spot][0].model}</b>`));
    }
  }
  v.appendChild(relCard);
  const thrCard = el("div", "card");
  thrCard.innerHTML = `<h2 class="section" style="margin-top:0">Your planing thresholds</h2>`;
  if (!thr.length) {
    thrCard.appendChild(el("div", "empty", `<b>No sessions yet</b>Log a few and your real planing floor per board+sail shows up here.`));
  } else {
    thr.forEach((t) => {
      const name = data.config.sailors[t.sailor]?.name || t.sailor;
      const bn = engine.boardName(data.config.boards, t.board);
      thrCard.appendChild(el("div", "logrow", `
        <div class="meta"><b>${name}</b> · ${bn} <span class="sm">${t.sail}m²</span><div class="sm">${t.n} session${t.n>1?"s":""}${t.feels.length?` · ${t.feels.join("/")}`:""}</div></div>
        <div style="text-align:right"><div class="sp">${t.best_kt!=null?t.best_kt.toFixed(1)+" kt":"—"}</div><div class="sm">${t.floor_kt!=null?"planed from "+t.floor_kt.toFixed(0):"no wind data"}</div></div>`));
    });
    thrCard.appendChild(el("div", "hint", "Planing floor uses SMHI measured base wind. Fetch it when you log to anchor these."));
  }
  v.appendChild(thrCard);

  // progression: planing-% trend + tack/jibe success per sailor
  const trend = engine.planingTrend(data.sessions);
  const rates = engine.skillRates(data.sessions);
  const sailorsWithData = new Set([...Object.keys(trend), ...Object.keys(rates).filter((k) => {
    const r = rates[k]; return r.tacksTried || r.jibesTried; })]);
  const progCard = el("div", "card");
  progCard.innerHTML = `<h2 class="section" style="margin-top:0">Progression</h2>`;
  if (!sailorsWithData.size) {
    progCard.appendChild(el("div", "empty", `<b>No progress data yet</b>Log sessions with a FIT (planing %) and your tack/jibe counts — your curve shows up here.`));
  } else {
    for (const who of sailorsWithData) {
      const name = data.config.sailors[who]?.name || who;
      const hist = trend[who] || [];
      const r = rates[who] || {};
      const pct = (m, t) => (t ? Math.round((m / t) * 100) + "%" : "—");
      const last = hist.length ? Math.round(hist[hist.length - 1].ratio * 100) : null;
      const first = hist.length ? Math.round(hist[0].ratio * 100) : null;
      const arrow = last != null && first != null && hist.length > 1 ? (last > first ? `↑ ${first}→${last}%` : last < first ? `↓ ${first}→${last}%` : `${last}%`) : last != null ? `${last}%` : "";
      progCard.appendChild(el("div", "progrow", `
        <div class="prog-head"><b>${name}</b>${last != null ? `<span class="prog-now">planing ${last}% <span class="sm">${arrow !== `${last}%` ? arrow : "latest"}</span></span>` : ""}</div>
        ${ratioSpark(hist)}
        <div class="prog-skills"><span>tacks <b>${pct(r.tacksMade, r.tacksTried)}</b> <span class="sm">${r.tacksMade||0}/${r.tacksTried||0}</span></span><span>jibes <b>${pct(r.jibesMade, r.jibesTried)}</b> <span class="sm">${r.jibesMade||0}/${r.jibesTried||0}</span></span></div>`));
    }
    progCard.appendChild(el("div", "hint", "Planing % is your share of moving time on the plane (from the FIT). Tack/jibe rates are made ÷ tried across all sessions."));
  }
  v.appendChild(progCard);
}

// little bar trend of planing ratio over sessions
function ratioSpark(hist) {
  if (!hist || hist.length < 2) return hist && hist.length === 1 ? "" : "";
  const bars = hist.slice(-16).map((p) => {
    const h = Math.round(Math.max(0, Math.min(1, p.ratio)) * 100);
    return `<div class="rs-col" title="${p.date} — ${Math.round(p.ratio*100)}%"><div class="rs-bar" style="height:${h}%"></div></div>`;
  }).join("");
  return `<div class="ratiospark">${bars}</div>`;
}

// ── PredictWind grid (OCR + manual) ───────────────────
const PW_ROWS = ["PWE", "PWG", "ECMWF", "GFS"];
function renderPwCard(v) {
  const c = el("div", "card");
  c.innerHTML = `<h2 class="section" style="margin-top:0">PredictWind models</h2>
    <div class="hint" style="margin-bottom:12px">Scan a PredictWind screenshot or type the rows. OCR pre-fills — always check the numbers before saving. Saved as separate models so each gets its own trust score.</div>
    <div class="row">
      <label class="fld"><span class="lab">Date</span><input id="pw-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
      <label class="fld"><span class="lab">Spot</span><select id="pw-spot">${Object.entries(data.config.spots).map(([k,s])=>`<option value="${k}">${s.name}</option>`).join("")}</select></label>
    </div>
    <label class="fld"><span class="lab">PredictWind screenshot (optional)</span><input id="pw-img" type="file" accept="image/*"></label>
    <div id="pw-ocr" class="hint" style="margin:6px 0"></div>
    <table class="tbl pwgrid"><thead><tr><th>model</th><th>base</th><th>gust</th><th>dir</th></tr></thead>
      <tbody>${PW_ROWS.map((m,i)=>`<tr>
        <td><input class="pw-m" data-i="${i}" value="${m}" style="width:72px"></td>
        <td><input class="pw-b num" data-i="${i}" type="number" inputmode="decimal" step="0.5" placeholder="m/s" style="width:60px"></td>
        <td><input class="pw-g num" data-i="${i}" type="number" inputmode="decimal" step="0.5" placeholder="m/s" style="width:60px"></td>
        <td><input class="pw-d" data-i="${i}" value="S" style="width:56px"></td></tr>`).join("")}</tbody></table>
    <button class="btn sm" id="pw-save" style="margin-top:12px">Save PredictWind rows</button>`;
  v.appendChild(c);

  $("#pw-img").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const status = $("#pw-ocr");
    status.textContent = "Loading OCR engine…";
    try {
      const text = await recognize(f, (p) => { status.textContent = `Reading screenshot… ${Math.round(p*100)}%`; });
      const labels = [...document.querySelectorAll(".pw-m")].map((i) => i.value);
      const parsed = parsePredictWind(text, labels);
      let filled = 0;
      labels.forEach((label, i) => {
        const p = parsed[label]; if (!p) return;
        if (p.base_ms !== "") { document.querySelector(`.pw-b[data-i="${i}"]`).value = p.base_ms; filled++; }
        if (p.gust_ms !== "") document.querySelector(`.pw-g[data-i="${i}"]`).value = p.gust_ms;
        if (p.dir) document.querySelector(`.pw-d[data-i="${i}"]`).value = p.dir;
      });
      status.innerHTML = filled
        ? `Pre-filled ${filled} model${filled>1?"s":""} — <b style="color:var(--warn)">check the numbers</b>, then save.`
        : `Couldn't read the table cleanly — type the rows by hand below.`;
    } catch (err) {
      status.textContent = `OCR failed (${err.message}). Type the rows by hand.`;
    }
  };

  $("#pw-save").onclick = () => {
    const sid = store.sessionId($("#pw-date").value, $("#pw-spot").value);
    const labels = [...document.querySelectorAll(".pw-m")].map((i) => i.value.trim());
    let saved = 0;
    labels.forEach((label, i) => {
      if (!label) return;
      const b = document.querySelector(`.pw-b[data-i="${i}"]`).value;
      const g = document.querySelector(`.pw-g[data-i="${i}"]`).value;
      const d = document.querySelector(`.pw-d[data-i="${i}"]`).value;
      if (b === "" && g === "") return;     // skip blank rows
      store.upsertForecast(data, { session_id: sid, model: label, base_ms: b, gust_ms: g,
        dir: d, captured_at: new Date().toISOString().slice(0,16), source: "predictwind" });
      saved++;
    });
    if (!saved) return toast("Fill at least one row");
    toast(`Saved ${saved} PredictWind model${saved>1?"s":""}`); renderData();
  };
}

// ── DATA ──────────────────────────────────────────────
function renderData() {
  const v = $("#view-data"); v.innerHTML = "";
  const fc = el("div", "card");
  fc.innerHTML = `<h2 class="section" style="margin-top:0">Add forecast row</h2>
    <div class="hint" style="margin-bottom:12px">Log what a model predicted, before you sail. session = date+spot ties it to the session.</div>
    <div class="row">
      <label class="fld"><span class="lab">Date</span><input id="f-date" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
      <label class="fld"><span class="lab">Spot</span><select id="f-spot">${Object.entries(data.config.spots).map(([k,s])=>`<option value="${k}">${s.name}</option>`).join("")}</select></label>
    </div>
    <div class="row">
      <label class="fld"><span class="lab">Model</span><input id="f-model" placeholder="PW_PE, SMHI, GFS…"></label>
      <label class="fld"><span class="lab">Dir</span><input class="num" id="f-dir" value="S"></label>
    </div>
    <div class="row">
      <label class="fld"><span class="lab">Base m/s</span><input class="num" id="f-base" type="number" inputmode="decimal" step="0.5"></label>
      <label class="fld"><span class="lab">Gust m/s</span><input class="num" id="f-gust" type="number" inputmode="decimal" step="0.5"></label>
    </div>
    <button class="btn sm" id="f-add">Add forecast</button>`;
  v.appendChild(fc);
  $("#f-add").onclick = () => {
    const sid = store.sessionId($("#f-date").value, $("#f-spot").value);
    const model = $("#f-model").value.trim(); if (!model) return toast("Model name?");
    store.upsertForecast(data, { session_id: sid, model, base_ms: $("#f-base").value, gust_ms: $("#f-gust").value, dir: $("#f-dir").value, captured_at: new Date().toISOString().slice(0,16), source: "manual" });
    toast(`Forecast ${model} saved`); renderData();
  };
  renderPwCard(v);
  const sc = el("div", "card");
  sc.innerHTML = `<h2 class="section" style="margin-top:0">Logged data</h2>
    <div class="hint" style="margin-bottom:10px">${data.sessions.length} sessions · ${data.forecasts.length} forecasts · ${data.observations.length} observations</div>`;
  [...data.sessions].reverse().slice(0, 8).forEach((s, ri) => {
    const idx = data.sessions.length - 1 - ri;
    const name = data.config.sailors[s.sailor]?.name || s.sailor;
    const tag = s.powered ? ` · ${s.powered}` : "";
    sc.appendChild(el("div", "logrow", `
      <div class="meta"><b>${name}</b> · ${data.config.spots[s.spot]?.name||s.spot}<div class="sm">${s.date} · ${s.sail}m² · ${s.planed==="y"?"planed":s.planed==="n"?"schlog":"—"}${tag}</div></div>
      <div style="display:flex;align-items:center;gap:12px"><span class="sp">${s.max_speed_kt||"—"}<span style="font-size:10px;color:var(--muted)">kt</span></span><button class="icon-btn" data-del="${idx}" style="width:30px;height:30px">✕</button></div>`));
  });
  sc.onclick = (e) => { const b = e.target.closest("[data-del]"); if (!b) return; store.deleteSession(data, +b.dataset.del); renderData(); toast("Deleted"); };
  v.appendChild(sc);
  const bc = el("div", "card");
  const last = store.lastExport();
  const ageDays = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  const stale = ageDays == null || ageDays >= 14;
  const backupNote = last
    ? `Last backup ${ageDays === 0 ? "today" : ageDays + " day" + (ageDays > 1 ? "s" : "") + " ago"}.`
    : "No backup yet.";
  bc.innerHTML = `<h2 class="section" style="margin-top:0">Backup & sync</h2>
    <div class="${stale ? "warnbox" : "hint"}" style="margin-bottom:12px">${stale ? "⚠︎ " : ""}${backupNote} Everything lives in this browser — export a JSON now and then (save it to Files/iCloud or commit it to the repo). Save it to the same place each time so it's easy.</div>
    <div class="btn-row"><button class="btn sm ghost" id="d-json">Export JSON</button><button class="btn sm ghost" id="d-import">Import JSON</button></div>
    <div class="btn-row"><button class="btn sm ghost" id="d-csv-s">sessions.csv</button><button class="btn sm ghost" id="d-csv-f">forecasts.csv</button><button class="btn sm ghost" id="d-csv-o">obs.csv</button></div>
    <input id="d-file" type="file" accept=".json" style="display:none">
    <div class="divider"></div>
    ${store.hasSnapshot() ? `<div class="btn-row"><button class="btn sm ghost" id="d-undo" style="color:var(--good)">↩ Undo last wipe/reset</button></div>` : ""}
    <div class="btn-row"><button class="btn sm ghost" id="d-reset" style="color:var(--warn)">Reset to seed</button><button class="btn sm ghost" id="d-wipe" style="color:var(--bad)">Wipe all</button></div>`;
  v.appendChild(bc);
  if (store.hasSnapshot()) $("#d-undo").onclick = () => { data = store.restoreSnapshot(); renderAll(); toast("Restored"); };
  $("#d-json").onclick = () => { store.download(store.exportJSON(data), "windlog-backup.json"); store.markExported(); renderData(); };
  $("#d-csv-s").onclick = () => store.download(store.exportCSV(data, "sessions"), "sessions.csv");
  $("#d-csv-f").onclick = () => store.download(store.exportCSV(data, "forecasts"), "forecasts.csv");
  $("#d-csv-o").onclick = () => store.download(store.exportCSV(data, "observations"), "observations.csv");
  $("#d-import").onclick = () => $("#d-file").click();
  $("#d-file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { data = store.importJSON(await f.text()); toast("Imported"); renderAll(); } catch (err) { toast("Bad file: " + err.message); } };
  $("#d-reset").onclick = () => { if (confirm("Reset to the seeded demo data?")) { data = store.resetSeed(); renderAll(); toast("Reset"); } };
  $("#d-wipe").onclick = () => { if (confirm("Delete ALL logged data? Export a backup first.")) { data = store.wipe(); renderAll(); toast("Wiped"); } };
}

// ── routing ───────────────────────────────────────────
const views = { today: renderToday, log: renderLog, stats: renderStats, data: renderData };
let currentTab = "today";
function go(name) {
  document.querySelectorAll(".view").forEach((vv) => vv.classList.toggle("active", vv.id === `view-${name}`));
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === name));
  views[name](); window.scrollTo(0, 0);
}
function renderAll() { go(currentTab); }
document.querySelector("nav.tabs").onclick = (e) => { const b = e.target.closest("button"); if (b) { currentTab = b.dataset.go; go(currentTab); } };
go("today");
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
