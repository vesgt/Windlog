# Windlog — companion-app roadmap

The vision: not a generic forecast app, but **your** sailing brain for you and Dad
— two intermediates, same spots, chasing more planing time and clean tacks &
jibes. It already (a) auto-polls four models per spot, (b) learns which model to
trust, (c) calls gear per sailor (gust-aware), and (d) logs sessions from your
Garmin + SMHI truth. Everything below builds on that, staying no-backend / no-build.

Legend: ✅ shipped · 🔜 next · 🌅 later · 💭 idea

---

## 1. The morning decision — "go or not, where, with what?"
The thing you actually open the app for.

- ✅ Live multi-model forecast per spot + reliability-weighted blended call
- ✅ Gust-aware sail sizing (rig for the gusts, plane on the base)
- ✅ **Best-spot-now banner** — best spot for the current direction + per-sailor
  GO / MARGINAL / NO-GO against each of your *learned* planing floors
- ✅ **Hourly timeline** — sparkline of the day with the best 2–3 h window lit up
- ✅ **Model-agreement confidence** — "solid / fair ±Xkt / split" badge
- 🌅 **3-day outlook** — rank the next days: "Saturday 13–16 is the session"
- 🌅 Water temp / wetsuit call + sunset cutoff (both in SMHI)

## 2. Two sailors, together — the "me and Dad" core
What no off-the-shelf app does for you.

- ✅ Side-by-side gear per sailor
- ✅ **Whose day is it** — banner line: "Better day for Joel (GO) than Dad (MARGINAL)"
- 🌅 **Shared session** — one outing, both log, auto-compared on the *same* wind
- 🌅 **Head-to-head** — max speed, planing %, who's improving fastest (friendly)
- 💭 Two-up planning: pick a day/spot that gives you both a session

## 3. Progression — planing, tacks, jibes
Tied directly to your stated goals.

- ✅ **Planing-time trend** — `planing_ratio` from each FIT, charted over sessions
  per sailor (Stats → Progression)
- ✅ **Skill log** — per-session tack/jibe made-vs-tried counts → success rates
- ✅ **Drill of the day** — from today's wind: light → tacks; planing → carve
  jibes; gusty/lit → control & speed
- 🌅 **Milestones** — first planing jibe, 5 planing sessions running, longest
  planing stretch, new top speed
- 🌅 **Diagnosed tips** — "your jibes fail when overpowered" derived from the
  data (planing% drop + over-powered assessment + jibe misses)

## 4. The learning forecast engine — your real edge
The reliability log that compounds.

- ✅ Per-model, per-spot trust score + plain-language "how wrong"
- ✅ **Auto-bias-correction** — learned per-model bias subtracted from live
  forecasts before blending (live panel marks corrected models)
- 🌅 **Per-direction reliability** — models miss differently on offshore vs
  onshore; score by direction band
- 🌅 **Trust trend** — is a model getting better/worse for us over the season
- 💭 Gust-factor learning per spot — some launches gust harder (terrain)

## 5. Gear intelligence
- ✅ **What-if sail table** — every sail in the quiver, power read per sailor at
  today's wind (Today → "What-if")
- 🌅 **Quiver-gap analysis** — "nothing dialed for steady 18 kt+" → concrete buys
  (Dad's ~120–135 L freeride for windy/jibe days; the 9.0 for light days)
- 💭 Fin suggestions per board + wind; per-combo tuning notes
- ✅ Per board+sail learned planing floor (in Stats)

## 6. Friction-killers
- ✅ **Auto-detect spot from FIT GPS** — the Log tab matches your Garmin's
  position to the nearest configured spot (within 5 km)
- ✅ **Backup safety net** — backup-age nudge + undoable wipe/reset (snapshot
  restore). Still browser-local; Gist/file sync is the next step up.
- 🌅 **Notifications** — "Sat 14:00 Östnora clears both your floors" (needs a
  tiny scheduled fetch — the one feature that wants a sliver of backend)
- 💭 Session photo + a little map of where you sailed; shareable session card

## 7. Local knowledge base
- 🌅 **Spot notes that grow** — launch hazards, best tide/level, rigging area,
  parking, where it's gusty — per spot, building into archipelago local-lore
- 💭 Hazard log (shallow fin-catchers, ferry traffic, offshore-wind warnings)

---

## Suggested order
1. **Best-spot-now banner + hourly timeline + GO/NO-GO** — finishes the "open it
   and know" loop. Highest daily value, all from data already fetched.
2. **Auto-detect spot from FIT + bulletproof backup** — kills the two biggest
   friction/risk points.
3. **Planing-time trend + skill log** — makes the progression goals visible.
4. **Auto-bias-correction** — turns the reliability log from a scoreboard into a
   sharper forecast.
5. Everything in 🌅/💭 as the season's data piles up.
