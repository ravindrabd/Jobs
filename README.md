# Job Tracker — Personal Edition

A self-hosted job-search tracker. Scrapes university / healthcare / nonprofit job boards,
matches each posting against your hardcoded skill list, and lets you save / apply / track
follow-ups via a clean local web UI.

- **Sources scraped**: HigherEdJobs (IT category, ~2k jobs), us-rse.org, HIMSS JobMine,
  AHIMA Career Center, university Workday/Greenhouse/Lever portals (~99 orgs).
- **Auto-refresh**: a `node-cron` job runs every 3 hours (configurable) and only
  inserts URLs not already in the DB.
- **JD-aware matching**: every new job's full description is fetched, scanned for
  the skills in `my_skills.js` (using an alias map), and tagged `show_flag = 1`
  only if ≥ 1 skill is found.
- **Title blocklist**: lecturers, professors, nurses, doctors, etc. are auto-hidden.

## Run locally

```bash
npm install
node import.js        # one-time: load jobs.csv into jobs.db
node server.js        # starts on :3001 with the 3-hour cron armed
```

Open <http://localhost:3001>. To trigger a scrape right now:

```bash
curl -X POST http://localhost:3001/api/scrape
# or set DISABLE_CRON=1 and run the script directly:
DISABLE_CRON=1 node cron_scrape.mjs
```

## Deploy to Railway

### 1. Create a Railway project

1. Fork or push this repo to GitHub.
2. On <https://railway.app>, click **New Project → Deploy from GitHub repo**.
3. Pick this repo. Railway auto-detects the `Dockerfile` (declared in `railway.toml`).

### 2. Add a persistent volume

The SQLite database needs to survive deploys.

1. In your service → **Settings → Volumes → Add Volume**.
2. Mount path: `/data` (any name works).
3. Railway sets `RAILWAY_VOLUME_MOUNT_PATH` automatically — `server.js` reads it and
   stores `jobs.db` inside the volume.

### 3. Set environment variables

In the service → **Variables**:

| Var | Value | Notes |
|---|---|---|
| `PORT` | `3000` | Railway routes to this |
| `SCRAPE_CRON` | `0 */3 * * *` | every 3 hours |
| `CHROMIUM_PATH` | `/usr/bin/chromium-browser` | already set in Dockerfile |
| `NODE_ENV` | `production` | already set in Dockerfile |

### 4. Deploy

Push to GitHub. Railway builds the image, mounts the volume, starts the server.
First-run flow:

1. `import.js` populates the volume's `jobs.db` from `jobs.csv` baked into the image.
2. Health check probes `GET /api/health` — must return 200 within 5 minutes.
3. Cron arms; first scrape runs at the next 3-hour boundary
   (or trigger immediately via `curl -X POST https://YOUR-APP/api/scrape`).

### 5. Upload your resume

Open `https://YOUR-APP/resume.html` and upload your resume PDF.
The skill list is hardcoded in `my_skills.js` (single-user app),
so resume upload is mainly to seed the legacy `resume` row used by some endpoints.

## File map

```
server.js              Express server + cron scheduler + all API endpoints
import.js              CSV → SQLite importer, schema migrations
my_skills.js           Hardcoded MY_SKILLS + alias map + title blocklist
jd_fetch.js            Generic JD-page fetcher (auto-routes Playwright vs plain HTTP)
match.js               (legacy, kept for compatibility)
skills.js              (legacy, kept for compatibility)
cron_scrape.mjs        Scheduled scraper: HEDjobs + us-rse + HIMSS + AHIMA
phase2.mjs             University direct-portal scraper
phase2b_aggregators.mjs Aggregator scrapers (HEDjobs, Chronicle, Idealist)
phase2e_himss.mjs      HIMSS-only scraper
hospitals_step1.mjs    CMS + OSM → hospitals.csv
hospitals_step2.mjs    ATS detection for hospital websites
hospitals_step3.mjs    Hospital JSON-API scrapers
public/                Static HTML/CSS/JS for the web UI
Dockerfile             Alpine + Chromium for Railway
railway.toml           Railway build/deploy config
```

## API quick reference

| Endpoint | Purpose |
|---|---|
| `GET  /api/health` | `{ status, jobs, showing, lastScrape, uptime }` |
| `GET  /api/jobs?...` | paginated list, supports `org_type`, `posted_within=fresh`, `source`, `sort`, `min_match`, `min_skills` |
| `GET  /api/dashboard` | aggregate counts + source breakdown + reminders |
| `GET  /api/applications` | saved/applied/interview/offer/rejected list |
| `POST /api/applications` | create/update an application |
| `POST /api/jobs/:id/remove` / `/restore` | soft-delete & undelete |
| `POST /api/jobs/:id/fetch-jd` | on-click JD fetch (for jobs without `jd_text`) |
| `POST /api/scrape` | manually trigger the cron scraper |

## What doesn't work (be honest)

- **Idealist** — bot-blocked even via Playwright (Incapsula challenge).
- **ANIA** — no usable job-board URL pattern found.
- **iCIMS hospitals** — 32 live tenants identified, but their search page is hardened.
- **Hospital coverage** is capped around 100–150 jobs (Workday-direct + HIMSS + AHIMA).
