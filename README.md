# Flood Church

A static, mobile-first church app UI, built as a proper modular JS app: separate `App.js` core, per-page component files, JSON data files, and a shared stylesheet. No build step, no framework — plain ES modules that run directly in the browser (and on GitHub Pages).

## File structure

```
flood-church-app/
├── index.html          Home page (shell only — content is rendered by JS)
├── bible.html           Bible page
├── media.html            Media page
├── give.html              Give page
├── profile.html            Profile page
├── settings.html            Settings page
├── css/
│   └── style.css              All shared styles / design tokens
├── js/
│   ├── App.js                  Core: top bar, bottom nav, JSON loader, boot()
│   ├── icons.js                  Shared inline-SVG icon library
│   └── components/
│       ├── home.js                Renders index.html from data/home.json
│       ├── bible.js                 Renders bible.html from data/bible.json
│       ├── media.js                   Renders media.html from data/media.json
│       ├── give.js                      Renders give.html from data/give.json (+ interactive state)
│       ├── profile.js                     Renders profile.html from data/user.json
│       └── settings.js                     Renders settings.html from data/settings.json
└── data/
    ├── user.json          Member profile, stats, ministries
    ├── home.json           Hero, service times, quick actions, verse of the day
    ├── bible.json            Daily reading + reading plans
    ├── media.json              Media tiles + podcast list
    ├── give.json                 Funds, amounts, payment methods
    └── settings.json               Account / notification / support rows
```

## How it works

- Each `.html` file is a **shell**: static markup with empty containers (`id="topbar"`, `id="bottomnav"`, etc.) and one `<script type="module">` tag that imports and calls its page's render function.
- `App.js` exports `bootApp()`, which renders the top bar and bottom navigation on every page, plus `loadData()`, a small `fetch()` wrapper for reading the JSON files.
- Each file in `js/components/` fetches its page's JSON and fills in the DOM. Editing the JSON (e.g. changing a fund name in `data/give.json`, or an amount in `data/home.json`) updates the page — no HTML editing needed.
- `icons.js` is just a lookup table of inline SVG strings shared by every page, so icons aren't duplicated across files.

## Running locally

Because the pages use `fetch()` and ES module `import`, they need to be served over HTTP (not opened directly as `file://`):

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying to GitHub Pages

1. Create a new GitHub repo and push everything in this folder to the `main` branch (keep the folder structure as-is).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`.
4. Save — your app will be live at `https://<your-username>.github.io/<repo-name>/`.

No build tools, bundler, or `npm install` required — GitHub Pages serves the files as they are.

## Notes

- The "Give" flow is a front-end demo only — it doesn't process real payments.
- The countdown on the Home page targets the next Sunday 9:00 AM in the visitor's local time (configurable via `data/home.json`).
- All icons are inline SVG — no external icon library or fonts required.
