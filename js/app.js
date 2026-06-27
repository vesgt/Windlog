// app.js — UI rendering and wiring. No framework; small render functions.
import * as store from "./store.js";
import * as engine from "./engine.js";
import { parseFit } from "./fit.js";
import { fetchObservation } from "./smhi.js";

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
function renderToday() {
  const v = $("#view-today"); v.innerHTML = "";
  const inp = el("div", "card");
  inp.innerHTML = `
    <h2 class="section" style="margin-top:0">Forecast you trust</h2>
    <div class="row">
      <label class="fld"><span class="lab">Base m/s</span><input class="num" id="t-base" type="number" inputmode="decimal" step="0.5" value="${today.base}"></label>
      <label class="fld"><span class="lab">Gust m/s</span><input class="num" id="t-gust" type="number" inputmode="decimal" step="0.5" value="${today.gust}"></label>
    </div>
    <label class="fld"><span class="lab">Direction</span>
      <select class="num" id="t-dir">${["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"].map(d=>`<option ${d===today.dir?"selected":""}>${d}</option>`).join("")}</select>
    </label>
    <div class="hint">Weight the models first — SMHI & PredictWind P_E tend to win locally; discount GFS gusts. Enter the number you'd actually bet on.</div>`;
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
    out.innerHTML = `<div class="filechip">✓ ${f.name} — max ${m.max_speed_kt} kt${ratioTxt}</div>`;
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
      relCard.appendChild(el("div", "hint", `<b style="color:var(--text)">${spot}</b> — forecast minus measured (m/s); +hot, −cold`));
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
  bc.innerHTML = `<h2 class="section" style="margin-top:0">Backup & sync</h2>
    <div class="hint" style="margin-bottom:12px">Everything lives in this browser. Export a JSON to commit into your repo, or CSVs for the Python tools.</div>
    <div class="btn-row"><button class="btn sm ghost" id="d-json">Export JSON</button><button class="btn sm ghost" id="d-import">Import JSON</button></div>
    <div class="btn-row"><button class="btn sm ghost" id="d-csv-s">sessions.csv</button><button class="btn sm ghost" id="d-csv-f">forecasts.csv</button><button class="btn sm ghost" id="d-csv-o">obs.csv</button></div>
    <input id="d-file" type="file" accept=".json" style="display:none">
    <div class="divider"></div>
    <div class="btn-row"><button class="btn sm ghost" id="d-reset" style="color:var(--warn)">Reset to seed</button><button class="btn sm ghost" id="d-wipe" style="color:var(--bad)">Wipe all</button></div>`;
  v.appendChild(bc);
  $("#d-json").onclick = () => store.download(store.exportJSON(data), "windlog-backup.json");
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
