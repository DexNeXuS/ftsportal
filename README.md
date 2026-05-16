# Rail Replacement A&D Dashboard

A browser-based dashboard for rail replacement **Arrivals & Departures (A&D)** sheets. Upload a station sheet, track coaches live at the platform, acknowledge departures, browse route patterns, and search the full movement table.

**Created by DexNeXuS**

## Quick start

1. Open **`A_D/index.html`** in a modern browser (Chrome, Edge, Firefox).
2. Tap or click **◈** in the header to upload a sheet, or drag a file onto **◈**.
3. No web server is required — the app runs from the file system (`file://`).

Supported uploads:

| Format | Notes |
|--------|--------|
| **CSV** | Works fully offline |
| **PDF** | Needs internet on first use (PDF.js loads from CDN) |
| **XLSX / XLS** | Needs internet on first use (SheetJS loads from CDN) |

Your last loaded sheet is saved in this browser (`localStorage`) and restored on the next visit.

## Project layout

```
AsDs/
├── A_D/                    # Application (open index.html here)
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # UI wiring, tabs, upload, state
│       ├── parser.js       # CSV/text parsing, vehicle cycles
│       ├── ui.js           # Rendering (live board, table, cheat sheet)
│       ├── cheatSheet.js   # Route pattern detection
│       ├── storage.js      # Session persistence
│       ├── pdfParser.js    # PDF A&D extraction
│       └── xlsxParser.js   # Excel A&D extraction
├── scripts/                # Optional Node dev/test helpers
├── package.json            # pdfjs-dist for local PDF testing only
└── README.md
```

Sample data files (e.g. `AD-Huddersfield (HUD)-16_05_2026.csv`) can live anywhere on your machine — use **◈** to pick them.

## Features

### Live

Vehicle-centric board: pairs each **arrival** at the station with the next **departure** for the same coach. Filter with **Departures**, **Arrivals**, or **All**. Mark a movement **Complete** when the coach has left.

### Done

Completed services for the current session, stored in the browser.

### Routes

Auto-generated **route cheat sheet** from departures on the sheet: destination code, minute pattern, stopper chains, and a station-code legend.

### Full A&D

Searchable table of every movement. On mobile, use the time scrubber and collapsible **Filters**; the list snaps so one row aligns under the sticky toolbar while you scroll.

## Mobile

- Bottom dock: Live · Done · Routes · Table  
- Sticky header with clock and upload  
- Layout tuned for portrait and landscape  

## Development (optional)

Node is **not** required to run the dashboard. It is only used for optional scripts under `scripts/`:

```bash
npm install
node scripts/test-parse.js
```

`pdfjs-dist` in `package.json` supports local PDF parsing tests; the live app loads PDF.js from a CDN in `index.html`.

## Browser support

Use a recent Chromium-, Firefox-, or Safari-based browser with JavaScript enabled. File upload and `localStorage` must be allowed for your user profile.

## Licence

ISC (see `package.json`).
