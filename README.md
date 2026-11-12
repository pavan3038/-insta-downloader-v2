# Insta Downloader

Instagram Reel / Post / Story downloader website (Hindi + English, light + dark). Node.js backend, **zero dependencies** (Node 18+).

```
server.js              entry point & routing
src/                   config · utils (SSRF guard) · media (response scanner) · api · stats · feedback · admin · static · http · store · log
src/providers/         graph.js (official) · rapidapi.js · custom.js · generic.js
public/                index.html · about/contact/privacy/terms/404/offline.html · admin.html
                       style.css · admin.css · js/ (i18n, common, media-url, history, downloads, app, feedback, admin)
                       manifest.webmanifest · sw.js · img/ (icons, og.jpg) · ads.txt
partials/              shared header & footer
scripts/hash-password.js   npm run admin:hash
test/                  npm test (mock APIs, no network)
```

## Run
```bash
cp .env.example .env     # add your API key(s)
npm start                # http://localhost:3000
npm test
```

## API setup (.env)
Without a key the site works but shows the **"API not configured"** banner. Save a valid key in `.env` and the banner disappears by itself (the file is re-read automatically; the page re-checks when the tab is focused).

**RapidAPI** – subscribe to an Instagram-downloader API on rapidapi.com, then copy from its *Code Snippets* tab:
```
RAPIDAPI_KEY=...            # X-RapidAPI-Key
RAPIDAPI_HOST=...           # X-RapidAPI-Host
RAPIDAPI_ENDPOINT=/convert?url={url}   # the request path of that API, {url} = Instagram link
```
Reels, posts and stories links are all sent as `{url}`. The server scans the JSON response and finds the video/thumbnail/caption automatically; set `RAPIDAPI_VIDEO_PATH` (e.g. `data.medias.0.url`) only if an API needs a specific field. Every API has its own response format and quota — test your chosen API once with a real link.

**Official Instagram API** – `IG_ACCESS_TOKEN` (free; only the connected account's own reels, posts and stories).
**Any other API** – `CUSTOM_API_*` (see `.env.example`).
`PROVIDER=auto` tries graph → rapidapi → custom.

## Qualities, audio, sharing
- Quality buttons (e.g. 1080p / 720p) appear only when the provider returns several real files; every button shows the real file size and format. Nothing is up-scaled or invented.
- **Audio only** appears only when the provider returns an audio file (`audio_url`, `.mp3`/`.m4a` …). The server does not convert video to MP3; the badge shows the real format. `RAPIDAPI_AUDIO_PATH` / `CUSTOM_AUDIO_PATH` handle unusual field names.
- **Share** uses the Web Share API (native share sheet); browsers without it get the link copied.
- **Paste** uses `navigator.clipboard`; where a browser forbids it (older iOS, Firefox) the user gets a hint to long-press and paste.

## Ad slots
`partials/header.html` (`ad-slot-header`), `public/index.html` (`ad-slot-middle`) and `partials/footer.html` (`ad-slot-footer`). Paste your network's code inside the div: the grey placeholder hides itself as soon as an element is added (delete the `<span class="ad-ph">` to remove it entirely). Update the CSP in `src/http.js` for the network's domains first, or the browser will block the script.

## Admin dashboard
Set `ADMIN_USER` and `ADMIN_PASSWORD_HASH` (from `npm run admin:hash`) in `.env`, restart, open `/admin`. Real counters only (requests, success/failure, page views, unique visitors per day, provider health, errors, feedback). No IP, link or media is stored. Sessions are HttpOnly cookies with CSRF protection and login lockout. Serve over HTTPS in production.

## PWA
`manifest.webmanifest` + `sw.js` make the site installable and show an offline page when there is no connection. Downloading always needs the internet; the service worker never caches `/api/` or `/admin`.

## Ad networks (AdSense / Adsterra…) (AdSense / Adsterra…)
Included: About, Contact, Privacy Policy (with advertising/cookie section), Terms of Service, `ads.txt` placeholder, sitemap, robots. Put your own ad code/script only after the network approves the site, and update the CSP in `src/http.js` to allow the network's domains. Note: Google AdSense policy often rejects download-tool sites; other networks have their own rules — check before applying.

## Deploy
Any Node host (VPS, Render, Railway…): `npm start`. Set `SITE_URL`, and `TRUST_PROXY=1` behind a proxy. Set `DATA_DIR` to a persistent disk (Render: add a Disk and use its mount path, e.g. `/var/data`). If it is empty or not writable the app falls back to `./data`, then the temp folder, then memory, and never crashes; on ephemeral hosts without a disk, stats and feedback reset on redeploy.
