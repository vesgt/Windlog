# Windlog — phone web app

Gear & spot calls plus a forecast-reliability log for you and Dad, sailing the
Stockholm archipelago. Runs entirely in the browser — **no backend, no build
step, no account**. Host it free on GitHub Pages and add it to your home screen
so it behaves like a native app.

Your data lives in the phone's local storage; export a JSON backup any time.

---

## Deploy to GitHub Pages (≈3 minutes)

1. Make a repo (e.g. `windlog`) and drop this whole folder's contents at the root.
   ```bash
   git init && git add . && git commit -m "windlog"
   git branch -M main
   git remote add origin git@github.com:YOURNAME/windlog.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a
   branch**, pick `main` / `/ (root)`, Save.
3. Wait ~1 min, then open `https://YOURNAME.github.io/windlog/` on your phone.

No bundler or Node needed — it's plain ES modules and static files. The only
thing the browser pulls from elsewhere at runtime is the Garmin FIT decoder
(from a CDN) and the SMHI API, both only when you use those features.

## Add to home screen (iPhone)

Open the Pages URL in Safari → Share → **Add to Home Screen**. It launches
full-screen, works offline for everything except FIT parsing and SMHI fetch
(those need a connection), and keeps your log between launches.

---

## The four tabs

**Today** — opens and **auto-polls live wind for every spot** (YR/MET Norway,
ECMWF, GFS, ICON via Open-Meteo — no key, no typing) plus a refresh button. Tap
a spot to load its **reliability-weighted blended call**, or override the number
by hand. You get the wind on the colour scale you already read, gear for both
sailors (now including the **Old Mistral** floater on the lightest days), and
the spot for the direction. Every poll quietly logs each model's forecast so the
trust scores build themselves. If you've logged enough sessions it also shows
your *measured* planing floor and whether today clears it.

**Log** — record a session. Drop in your Garmin `.fit` and it fills max speed
and planing minutes automatically; tick "Pull SMHI" and it grabs the nearest
station's measured wind as ground truth. One entry per sailor.

**Stats** — a **0–100 trust score** per model per spot with a plain-language
read on how it's wrong ("GFS over-reads gusts by 4.2 m/s"), best model flagged,
the detailed bias/error table underneath, plus your planing thresholds per
board+sail as they accumulate.

**Data** — add forecast rows by hand, or use the **PredictWind** card: drop in a
screenshot and in-browser OCR pre-fills the 4-model grid (check the numbers, it's
best-effort), or just type the rows. Each model saves separately so it earns its
own trust score. Browse/delete sessions and **export JSON or CSV**. The CSVs
match the earlier Python toolkit's schema, so both systems read the same data.

---

## Daily loop

1. Before you leave: **Data → Add forecast** for the models you care about
   (or just trust the Today tab for the call).
2. Sail.
3. After: **Log** the session per sailor, FIT + SMHI ticked.
4. Every few sessions: check **Stats** to see which model owns each spot and
   how your real planing floor compares to the estimates.

---

## Notes & honest caveats

- **SMHI in the browser:** the app calls SMHI Open Data directly. If your
  browser blocks it (CORS) you'll see a "fetch blocked" note — just type the
  measured wind into a forecast/observation row by hand; the analysis treats
  manual and fetched values identically. (Worth testing on-device once; SMHI's
  open API is generally permissive.)
- **FIT parsing** uses the official Garmin SDK loaded from jsdelivr, so it needs
  a connection the first time. Everything else works offline.
- **Backups:** data is per-browser. Export a JSON from the Data tab now and then
  and commit it to the repo — that's your sync and your safety net.
- **Seeded with today:** Östnora, you on 145 + 6.9, 18.5 kt, marginal — so the
  app isn't empty on first open. Wipe or reset from the Data tab.
- The gear/power/planing logic starts from the estimates we worked out; it gets
  more honest as your real sessions pile up. Tune `js/config.js` for the shipped
  defaults (weights, quiver, spots, coordinates).

## Files

```
index.html              app shell + bottom nav
app.css                 dark archipelago theme, wind colour scale
manifest.webmanifest    PWA metadata (installable)
service-worker.js       offline app shell
icons/                  home-screen icons
js/
  app.js                UI rendering + routing
  engine.js             recommend + reliability/threshold maths
  store.js              localStorage + CSV/JSON export & import
  config.js             your quiver, sailors, spots (+ seed data)
  fit.js                Garmin .fit → max speed, planing minutes
  smhi.js               nearest SMHI station → measured wind (ground truth)
  forecast.js           Open-Meteo multi-model auto-poll (YR/ECMWF/GFS/ICON)
  ocr.js                PredictWind screenshot → grid (Tesseract.js, lazy CDN)
```
