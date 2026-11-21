# GV Jathagam — Tamil birth chart (jothidam)

A client-side Tamil astrology site: rasi and navamsam charts in the South Indian
square format, nakshatram/padam, lagnam, planet table with vakram, Vimshottari
dasa/bhukti and the panchangam at birth. Tamil/English toggle (Tamil names in
both modes).

**Live:** `https://masalameterratings.com/jathagam/` (GitHub Pages, served from
the `jathagam/` folder of the default branch).

## Palan (traditional readings)
A **Palan** button on the result page shows readings for that chart, generated
by rules in `src/palan/` (Tamil and English): lagnam, rasi and nakshatra traits;
the current dasa/bhukti with dates and the house it acts through; career,
marriage, education, wealth and home from the relevant houses, their lords and
significators; and each planet's house, uchcham/neecham/aatchi and vakram.
Significations follow classical conventions (BPHS, Phaladeepika). Every line is
phrased as what tradition says, with a note that these are cultural beliefs, not
proven predictions. Health, lifespan and dosham verdicts are deliberately left
out (a test checks this).

## Thirumana porutham (marriage matching)
The **Marriage porutham** tab (`#porutham`) runs the ten traditional Tamil
checks for a bride and groom, from birth details or directly from a known
nakshatram + rasi. Code: `src/engine/porutham.js`, UI `src/ui/porutham.js`.
Counts are inclusive, from the girl's star/sign to the boy's.

| Porutham | Rule used |
|---|---|
| Dinam | star count mod 9 ∈ {2,4,6,8,0} |
| Ganam | same ganam, or deva girl + manushya boy = good; manushya girl + deva boy = fair; any rakshasa mismatch = no |
| Mahendram | star count ∈ {4,7,10,13,16,19,22,25} |
| Stree deergham | star count > 13 good, > 7 fair |
| Yoni | enemy animals (horse–buffalo, elephant–lion, goat–monkey, serpent–mongoose, dog–deer, cat–rat, cow–tiger) = no; same animal good; else fair |
| Rasi | sign count 1 or 7 good; 9–12 fair; 2–6, 8 no |
| Rasi adhipathi | lords friendly both ways good; any enmity no; else fair |
| Vasyam | Tamil almanac vasya table, either direction |
| Rajju | stars must be in different rajju (pada/ooru/naabhi/kanta/siro) |
| Vedhai | the 13 vedha pairs (incl. Mirugaseeridam–Chithirai–Avittam) |

Rules vary between families and almanacs; same-nakshatram exceptions and
Sevvai dosham are not applied. The result is shown as a traditional guide
(score out of 10, rajju highlighted), never as a verdict.

## Privacy
Everything runs in the browser. No storage (no cookies/localStorage), no
analytics. The only network request is the place-name search to the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api); the
font is self-hosted. Latitude/longitude can be typed in manually instead.

## Layout
```
jathagam-src/            source (this folder)
  src/engine/            calculation engine, no DOM
    astro.js             sidereal positions, Lahiri ayanamsa, nodes, lagnam, sunrise
    nakshatra.js vargas.js dasa.js panchangam.js time.js constants.js
    index.js             computeChart() — the only API the UI uses
  src/i18n.js            Tamil / English names and labels
  src/ui/                South Indian chart renderer, geocoder autocomplete
  test/                  verification tests + Swiss Ephemeris reference data
  tools/gen_reference.py regenerates the reference data
../jathagam/             built site (committed; what Pages serves)
```

```sh
npm install
npm test          # vitest
npm run dev       # local dev server
npm run build     # writes ../jathagam — commit it
```

## Calculation engine
* **Ephemeris:** [Astronomy Engine](https://github.com/cosinekitty/astronomy) (MIT),
  apparent geocentric positions (light-time + aberration).
* **Why not Swiss Ephemeris?** The WebAssembly ports on npm (e.g. `swisseph-wasm`
  0.1.x) are young and the Swiss Ephemeris is dual-licensed **AGPL-3.0 /
  commercial** — bundling it would make the whole site AGPL (source must be
  offered to every visitor) or need a paid licence. Astronomy Engine keeps the
  site MIT and lets us test against Swiss Ephemeris as an *independent* reference.
* **Ayanamsa:** Lahiri (Chitrapaksha), implemented here exactly as Swiss
  Ephemeris `SIDM_LAHIRI` defines it: 23.245524743° at JD 2435553.5, carried by
  IAU 2006 general precession. Sidereal longitude = tropical longitude of the
  mean equinox of date − mean ayanamsa (equivalently true longitude − true ayanamsa).
* **Rahu/Ketu:** mean node (Meeus/ELP formula, default) or true (osculating) node
  from the Moon's instantaneous orbit plane. Ketu = Rahu + 180°.
* **Lagnam:** from apparent sidereal time, true obliquity and latitude.
* **Vakram:** sign of the longitude speed (central difference over ±15 min).
* **Dasa year:** 365.25 days (`DEFAULT_YEAR_DAYS` in `dasa.js`, overridable).
* **Vaaram:** the Tamil day runs sunrise to sunrise; births before local sunrise
  get the previous weekday (flagged in the output).
* **Time zones:** IANA zone from lat/long via `@photostructure/tz-lookup`, local
  → UTC with Luxon (uses the browser's tz database, so historical offsets and DST
  rules are applied for the exact date). Non-existent (spring-forward) times are
  flagged; ambiguous (fall-back) times use the first, daylight-saving occurrence.
  Caveat: tzdb treats all of India as IST/Madras time; births recorded in
  **Bombay Time (UTC+4:51, until 1955)** or **Calcutta Time (UTC+5:53, until
  1948)** need the manual offset under *Settings*.

## Verification
`test/engine.test.js` compares the engine with Swiss Ephemeris 2.10.03 (the
engine inside Jagannatha Hora) using `SIDM_LAHIRI` and the full `.se1`
ephemeris files. References are produced by `tools/gen_reference.py`; local
time → UTC for them is done independently with Python's `zoneinfo`.

* 7 reference charts, end to end from local time + place, including Chennai
  1943 (India war time, UTC+6:30), Madurai 1931, New York July 1990 (EDT) and
  Chicago 2008 (first day of the new US DST rules).
* A random sweep of 150 instants/places between 1900 and 2050.
* Tolerances asserted: grahas ≤ 1′, lagnam ≤ 3′, ayanamsa ≤ 1″.
* Measured worst case: Sun 1.4″, Moon 9″, other planets ≤ 13″, mean node 0.1″,
  true node 14″, lagnam 0.2″, ayanamsa 0.13″; vakram flags all match.
  (The Moon drifts after ~2050 because the two libraries extrapolate ΔT
  differently; irrelevant for birth charts.)
* DST gap/overlap and pre-/post-2007 US rules; unit tests for navamsam,
  nakshatra/padam boundaries, dasa sequence and naming.

## Phase 2 hooks (not built)
* **Today's panchangam + rahu kalam:** `panchangam(date, lat, lon)` and the
  sunrise helpers in `astro.js` take any instant/location.
* **Vakya vs Thirukanitha:** `SYSTEMS` in `engine/index.js`; `computeChart`
  takes `{ system }` (only `thirukanitha` is implemented).

## Licences
App code MIT. Astronomy Engine MIT, Luxon MIT, tz-lookup CC0, Noto Sans Tamil
OFL-1.1. Swiss Ephemeris (AGPL) is used only offline to produce test data and
is not shipped.
