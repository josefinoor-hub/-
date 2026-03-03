# CLAUDE.md — Professional Fermentation Calculator PWA

## Project Overview

This is a **Progressive Web Application (PWA)** for professional bread fermentation calculations. It is written entirely in Hebrew and designed for Hebrew-speaking bakers who want to calculate fermentation times based on temperature, yeast percentage, flour types, and hydration.

- **App name (Hebrew):** מחשבון התססה המקצועי (Professional Fermentation Calculator)
- **Language:** Vanilla HTML5 + CSS + JavaScript (no frameworks, no build tools)
- **Deployment:** Netlify (static hosting, auto-deploys from GitHub)
- **Offline support:** Full PWA with Service Worker and localStorage persistence

---

## Repository Structure

```
/
├── fermentation_calculator.html   # Entire application — HTML, CSS, and JS in one file
├── sw.js                          # Service Worker for offline/caching support
├── manifest.json                  # PWA manifest (icons, shortcuts, display settings)
├── netlify.toml                   # Netlify deployment and caching configuration
└── NETLIFY_SETUP_HE.txt           # Deployment guide in Hebrew
```

This is intentionally a **single-file app**. There is no `src/` directory, no build process, no `package.json`, and no external dependencies. Do not introduce a build system or framework unless explicitly requested.

---

## Running Locally

The Netlify dev config specifies Python's SimpleHTTPServer:

```bash
# Python 2
python -m SimpleHTTPServer 8000

# Python 3 (equivalent)
python3 -m http.server 8000
```

Open `http://localhost:8000/fermentation_calculator.html` in a browser. The Service Worker requires HTTPS or localhost to function.

**No build step is needed.** Edit files and reload the browser.

---

## Deployment

Deployment is fully automated via Netlify connected to the GitHub repository:

1. Push changes to GitHub (`master` branch or the configured Netlify branch)
2. Netlify rebuilds and deploys automatically (no build command, publish dir is `.`)
3. The Service Worker on the user's device will pick up changes via the network-first fetch strategy

**netlify.toml** controls:
- SPA routing: all paths redirect to `/fermentation_calculator.html` with status 200
- Cache headers: HTML is `no-cache`, JS is cached for 1 year, `sw.js` is `no-cache`
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`

To update the Service Worker cache version (e.g. after significant changes), bump `CACHE_NAME` in `sw.js`:

```js
const CACHE_NAME = 'fermentation-calc-v2'; // increment the version
```

---

## Application Architecture

### Single File: `fermentation_calculator.html`

The file is structured as:
1. `<head>` — charset, viewport, title, PWA manifest link
2. `<style>` — all CSS inline (RTL layout, responsive grid, color themes)
3. `<body>` — three-tab UI layout:
   - **מחשבון** (Calculator tab, id=`calc`) — main calculator form
   - **קמחים** (Flours reference tab, id=`ref`) — read-only flour database display
   - **קליברציה** (Calibration tab, id=`cal`) — user calibration log
4. `<script>` — all JavaScript inline:
   - Service Worker registration
   - `FLOURS` database constant
   - UI event handlers
   - Fermentation calculation logic
   - localStorage calibration persistence

### Tabs

Tab switching is handled by `switchTab(tab)`. It removes/adds the `active` class on `.tab` divs and `.tab-btn` buttons.

---

## Flour Database (`FLOURS`)

Defined as a JavaScript constant at the top of `<script>`:

```js
const FLOURS = {
    key: { name: 'Hebrew Name', protein: Number, hydrationBase: Number }
};
```

**18 flour types** are included:
- Shtibel Swiss-style flours: `t405`, `t650`, `t1`–`t6`, `t14`, `t15`, `t17`, `t18`, `t20`
- Specialty flours: `rye`, `durum`, `artisan`, `emmer`, `einkorn`, `khorasan`

To add a flour, add an entry to `FLOURS`. It will automatically appear in all three select dropdowns and the reference tab. No other code changes are needed.

---

## Fermentation Calculation Model

The calculation is based on the **TXCraig1 / Q10 temperature model**:

```
Base reference: 75 minutes at 24°C with 2% instant dry yeast

baseTimeAt24 = 75 × (2 / yeastPercent)
tempFactor   = 1.2 ^ ((24 - ddt) / 2)        // Q10 = 1.2 per 2°C
hydrationFactor = 1 + ((hydration - 65) × 0.01)

bulkTime = baseTimeAt24 × tempFactor × hydrationFactor
```

- **Temperature (DDT):** Each 2°C change from 24°C shifts fermentation time by ~20%
- **Hydration:** Deviating from 65% base adjusts time by 1% per percentage point
- **Yeast %:** Directly scales the base time (halving yeast doubles the time)
- **Weighted average protein** is calculated from multiple flours but currently used for display only (protein content does not yet factor into the time formula)

The result range displayed is ± 15 minutes from the calculated time.

### Timeline Generation

After calculation, a timeline is rendered into `#timeline` showing:
- T-0:30 — Autolyse
- T+0:00 — Add yeast + salt
- T+H:MM — End of bulk fermentation / shaping
- T+H:MM — Bench rest (20 min)
- T+H:MM to T+H:MM — Final proof (~40% of bulk time, minimum 60 min)

---

## Multi-Flour Blending

Up to 3 flours can be blended:
- Flour 1 is always required
- Flour 2 is shown by default; remove with `removeFlour(2)`
- Flour 3 is hidden by default; shown after clicking "הוסף קמח נוסף" (Add another flour)
- Weighted average for protein and hydration is calculated from gram weights

The `selections` object tracks current selections:
```js
const selections = { flour1: 't650', flour2: null, flour3: null };
```

---

## Yeast Types

Three yeast types are supported with distinct UX labels:
| Value | Type |
|---|---|
| `instant` | Instant Dry Yeast (שמרים יבשים מיידיים) |
| `active` | Active Dry Yeast (שמרים יבשים פעילים) |
| `fresh` | Fresh / Compressed Yeast (שמרים טריים) |

**No conversion factor is applied between types** — the percentage entered is used as-is. Labels update to clarify which yeast type the percentage applies to. Sourdough (מחמצת) uses a separate `levain` percentage field.

---

## Calibration System

Users log their baking results to compare predicted vs actual fermentation times:

```js
calibrations.push({ notes, pred, actual, date })
localStorage.setItem('cals', JSON.stringify(calibrations))
```

- Data is stored in `localStorage` under the key `'cals'`
- `loadCals()` restores data on page load
- `renderCals()` renders the log to `#logDiv`
- No server-side storage; data is local to the user's device/browser

---

## UI Conventions

- **Language:** All user-facing text is in Hebrew (עברית)
- **Direction:** RTL — `<html lang="he" dir="rtl">` — all layout uses `border-right` for accents, not `border-left`
- **Date locale:** `'he-IL'` via `toLocaleDateString()`
- **Color theme:**
  - Primary dark: `#2c3e50`
  - Accent blue: `#3498db`
  - Accent yellow (yeast section): `#f39c12`
  - Result green: `#27ae60`
- **Max width:** 650px centered container
- **Emoji icons** are used extensively throughout the UI — preserve this style
- **Info boxes:** `.info-box` (blue left border), `.warning-box` (yellow left border)

---

## Service Worker (`sw.js`)

- **Cache name:** `fermentation-calc-v1` (bump version to force cache refresh on users)
- **Install event:** Caches `/`, `/index.html`, `/fermentation_calculator.html`, `/manifest.json`
- **Activate event:** Deletes all old caches not matching current `CACHE_NAME`
- **Fetch strategy:**
  - CDN resources and images: **Cache First**
  - Everything else: **Network First, Cache Fallback**
- `self.skipWaiting()` and `self.clients.claim()` ensure immediate activation

Note: The HTML file registers the SW twice (once inline at top, once inside `DOMContentLoaded`). This is redundant but harmless.

---

## No Testing Framework

There are no automated tests. Calculations should be verified manually:
- At 24°C, 2% instant yeast → expect ~75 min bulk fermentation
- At 26°C, 2% instant yeast → expect ~52 min (×1.2^(-1) = ÷1.2)
- At 22°C, 2% instant yeast → expect ~108 min (×1.2^1)

---

## Key Constraints for AI Assistants

1. **Do not introduce a build system, npm, or external dependencies.** This is intentionally dependency-free.
2. **Do not split into multiple files** unless explicitly asked. The single-file architecture is a feature.
3. **Preserve Hebrew UI text** — do not translate any user-facing strings.
4. **Maintain RTL layout conventions** — use `border-right` for left-border accents, not `border-left`.
5. **Do not change the fermentation formula** without verifying against the Q10 model reference values.
6. **localStorage key `'cals'`** must remain stable — changing it would break existing user data.
7. **Service Worker cache name** should only be bumped when there are breaking cache changes.
8. **Security headers** in `netlify.toml` should not be weakened.
