# GenLaTeX – Setup Scripts and Environment Variables

## Production Deployment Guides

For complete deployment instructions (env setup, integration, process managers, troubleshooting):

- **[genlatex/DEPLOYMENT.md](DEPLOYMENT.md)** – Frontend (Next.js app)
- **[genlatex-agent/DEPLOYMENT.md](../genlatex-agent/DEPLOYMENT.md)** – Backend (AI agent API)

---

## Scripts to Run (in order)

### 1. Database (PostgreSQL)

- **Create DB**: Create a PostgreSQL database (e.g. `genlatex`) and note the connection URL.
- **Run migrations** (from `genlatex/`):
  ```bash
  cd genlatex
  npm install
  node run-migrations.js
  ```
  Requires `DATABASE_URL` in `genlatex/.env`.

### 2. Main app – Frontend (genlatex/)

| Script | Command | Purpose |
|--------|--------|--------|
| Install | `npm install` | Install dependencies |
| Dev | `npm run dev` | Start Next.js dev server (port 3000) |
| Build | `npm run build` | Production build |
| Start | `npm start` | Run production server |
| Migrate | `node run-migrations.js` | Run DB migrations (see above) |
| Stripe products | `node scripts/create-stripe-products.js` | Create Stripe Pro product/prices (optional) |

### 3. Backend – AI agent (genlatex-agent/)

| Script | Command | Purpose |
|--------|--------|--------|
| Install | `pip install -r requirements.txt` | Install Python deps (use a venv) |
| Run API | `python run_api.py` | Start FastAPI (port 8000) |
| Run API (reload) | `python run_api.py --reload` | Dev with auto-reload |
| Check env | `python run_api.py --check-env` | Validate .env |

Alternative: `uvicorn api.main:app --reload --port 8000`

### 4. Landing page (genlatex-website/)

| Script | Command | Purpose |
|--------|--------|--------|
| Install | `npm install` | Install dependencies |
| Dev | `npm run dev` | Start dev server |
| Build | `npm run build` | Production build |
| Lint | `npm run lint` | ESLint |

---

## Environment variables to add

### genlatex/.env (main app)

Copy from `genlatex/.env.example` and fill in values.

| Variable | Required | Description |
|----------|----------|-------------|
| **Database** | | |
| `DATABASE_URL` | Yes | PostgreSQL URL, e.g. `postgresql://user:pass@localhost:5432/genlatex` |
| **Auth (Better Auth)** | | |
| `BETTER_AUTH_SECRET` | Yes | Min 32 chars; e.g. `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | Yes | App URL, e.g. `http://localhost:3000` |
| `GOOGLE_CLIENT_ID` | For Google login | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | For Google login | From Google Cloud Console |
| **Email (Resend)** | | |
| `RESEND_API_KEY` | For verification/reset | From resend.com; omit = log links in dev |
| `EMAIL_FROM` | Optional | Sender, e.g. `GenLaTeX <onboarding@resend.dev>` |
| **Backend** | | |
| `GENLATEX_AGENT_URL` | Yes | e.g. `http://localhost:8000` |
| `GENLATEX_AGENT_API_KEY` | Optional | Same as backend `AGENT_API_TOKEN` if you secure the API |
| **AI / Chat** | | |
| `OPENROUTER_API_KEY` | Yes | From openrouter.ai (used by frontend for chat) |
| `AI_MODEL` | Yes | Primary AI model, e.g. `deepseek/deepseek-chat` |
| `AI_MODEL_FALLBACK` | Optional | Fallback if AI_MODEL not set, e.g. `deepseek/deepseek-r1:free` |
| **Stripe** | | |
| `STRIPE_SECRET_KEY` | For payments | Stripe secret key |
| `STRIPE_PUBLISHABLE_KEY` | For payments | Stripe publishable key |
| `STRIPE_WEBHOOK_SECRET` | For webhooks | Stripe webhook signing secret |
| `STRIPE_PRO_PRODUCT_ID` | After creating products | From Stripe dashboard or create-stripe-products |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | | |
| `STRIPE_PRO_YEARLY_PRICE_ID` | | |
| **App** | | |
| `NEXT_PUBLIC_BASE_URL` | Optional | e.g. `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | Optional | Same as above |
| **Zotero** | | |
| `ZOTERO_ENCRYPTION_KEY` | For Zotero link | 64-char hex; `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ZOTERO_OAUTH_CLIENT_KEY` | Optional | From zotero.org/oauth/apps |
| `ZOTERO_OAUTH_CLIENT_SECRET` | Optional | |
| **Storage** | | |
| `PROJECT_PATH` | Optional | Default `./data/projects`; where project files live |

---

### genlatex-agent/.env (Python backend)

Copy from `genlatex-agent/env_template` to `genlatex-agent/.env`.

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | From openrouter.ai |
| `OPENROUTER_BASE_URL` | Optional | Default `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | Optional | Default `deepseek/deepseek-r1:free` |
| `GENLATEX_APP_URL` | Optional | Base URL of the GenLaTeX web app for persisting ingested images (e.g. `http://localhost:3000`) |
| `TAVILY_API_KEY` | Optional | From tavily.com (web search) |
| `VISION_OCR_MODEL` | Optional | Vision OCR model for image text extraction (default `deepseek/deepseek-ocr`) |
| `VISION_CAPTION_MODEL` | Optional | Vision model for image captioning (default `deepseek/deepseek-ocr`) |
| `AGENT_API_TOKEN` | Optional | If set, frontend must send same value as `GENLATEX_AGENT_API_KEY` |
| `GENLATEX_PROJECTS_PATH` | Optional | Path to project dirs; must match frontend project storage (e.g. `./data/projects` when same machine) |
| `TEMPLATE_DIR` | Optional | Default `./template` |
| `CHECKPOINT_DIR` | Optional | Default `./checkpoints` |
| `OUTPUT_DIR` | Optional | Default `./output` |
| `DEBUG_MODE` | Optional | `true` / `false` |
| `FAST_MODE` | Optional | `true` = fewer research steps |
| `ALLOWED_ORIGINS` | Optional | Comma-separated; default includes localhost:3000 |

---

### genlatex-website/.env (landing page)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_APP_URL` | Yes | Main app URL, e.g. `http://localhost:3000` or production URL |

---

## Quick start (local dev)

1. **PostgreSQL**: Create DB, set `DATABASE_URL` in `genlatex/.env`.
2. **genlatex**: Copy `genlatex/.env.example` → `genlatex/.env`, set at least `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `OPENROUTER_API_KEY`, `GENLATEX_AGENT_URL`.
3. **genlatex**: `cd genlatex && npm install && node run-migrations.js && npm run dev`
4. **genlatex-agent**: Copy `genlatex-agent/env_template` → `genlatex-agent/.env`, set `OPENROUTER_API_KEY` (and optionally `TAVILY_API_KEY`). `cd genlatex-agent && pip install -r requirements.txt && python run_api.py`
5. **genlatex-website** (optional): `cd genlatex-website && npm install && npm run dev`

Open `http://localhost:3000` for the app; backend at `http://localhost:8000`.

---

## Production deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** and **[genlatex-agent/DEPLOYMENT.md](../genlatex-agent/DEPLOYMENT.md)** for full guides.

### genlatex – Production migrations

```bash
cd genlatex
cp .env.production .env   # Edit with real values
npm run production-migrate
```

Runs: DB migrations → Better Auth schema → Stripe products.

### genlatex-agent – Production migrations

```bash
cd genlatex-agent
cp .env.production .env   # Edit with real values
python scripts/production-migrations.py
```

Creates directories and validates env. Then: `python run_api.py --production`.

### genlatex-agent – Storage cleanup

**Automatic**: When the API runs, old checkpoints, output, and logs are deleted automatically every 15 minutes (no cron needed). Cleanup runs in a thread pool so it does not block API requests.

Retention and behavior (env vars in `.env.production`):
- `CHECKPOINT_RETENTION_DAYS=7` – checkpoint JSON files
- `OUTPUT_RETENTION_DAYS=30` – generated output files
- `LOG_RETENTION_DAYS=14` – rotated log backups
- `STORAGE_CLEANUP_INTERVAL_SEC=900` – how often to run (default 15 min)
- `STORAGE_CLEANUP_ENABLED=true` – set to `false` to disable (e.g. when using MinIO/external cleanup)
- `STORAGE_CLEANUP_TIMEOUT_SEC=300` – max time per run (default 5 min)

**Manual** (dry run or one-off):
```bash
cd genlatex-agent
python scripts/cleanup-storage.py       # Dry run (shows what would be deleted)
python scripts/cleanup-storage.py --run # Actually delete
```
