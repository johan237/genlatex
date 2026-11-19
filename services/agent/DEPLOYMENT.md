# GenLaTeX Agent – Deployment Guide

Complete guide to deploy the GenLaTeX Python backend (AI paper generation, research, file processing) to production. Focus is on app integration, configuration, and making everything work with the frontend.

---

## Prerequisites

- **Python** 3.10+
- **OpenRouter API key** (openrouter.ai) – required for LLM
- **Tavily API key** (tavily.com) – optional but recommended for web search
- **GenLaTeX frontend** running and able to reach this API
- **Pandoc** (required for `word-to-latex` tool)
- **LaTeX compiler** (pdflatex/TeX Live required for `latex-to-pdf` tool)

---

## 1. Clone and Install

```bash
cd genlatex-agent
python -m venv venv
source venv/bin/activate   # Linux/macOS
# or: venv\Scripts\activate  # Windows

pip install -r requirements.txt
```

---

## 2. Environment Configuration

### Copy production template

```bash
cp .env.production .env
# Edit .env with your real values
```

### Required variables

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | From openrouter.ai | `sk-or-v1-...` |
| `OPENROUTER_BASE_URL` | Default `https://openrouter.ai/api/v1` | |
| `OPENROUTER_MODEL` | Model for paper generation and chat | `google/gemini-2.5-flash` or `deepseek/deepseek-r1-0528:free` |

In **production**, set `ENVIRONMENT=production`. When `ENVIRONMENT=production`, `AGENT_API_TOKEN` is required. The frontend (Next.js) must use the same value as `GENLATEX_AGENT_API_KEY` (or `AGENT_API_TOKEN`) when proxying requests to the backend so that the Bearer token matches.

### Optional but recommended

| Variable | Description |
|----------|-------------|
| `TAVILY_API_KEY` | Web search (tavily.com) – improves research quality |
| `AGENT_API_TOKEN` | If set, frontend must send same as `GENLATEX_AGENT_API_KEY` |

### Security

| Variable | Description |
|----------|-------------|
| `AGENT_API_TOKEN` | Bearer token; frontend sends as `GENLATEX_AGENT_API_KEY` |
| `ENABLE_API_AUTH` | `true` to require Bearer token |
| `ALLOWED_ORIGINS` | Comma-separated frontend URLs, e.g. `https://app.genlatex.ai` |
| `ENABLE_RATE_LIMITING` | `true` recommended |
| `RATE_LIMIT_PER_MINUTE` | Default 60 |

### Paths (critical for integration)

| Variable | Description | Same-machine deployment |
|----------|-------------|--------------------------|
| `GENLATEX_PROJECTS_PATH` | Where project files live | Use **same absolute path** as `PROJECT_PATH` on genlatex frontend, e.g. `/var/lib/genlatex/data/projects` |
| `TEMPLATE_DIR` | LaTeX template directory | `./template` |
| `CHECKPOINT_DIR` | Checkpoint storage | `./data/checkpoints` |
| `OUTPUT_DIR` | Generated output | `./data/output` |

**Critical**: When genlatex and genlatex-agent run on the same machine, `GENLATEX_PROJECTS_PATH` (backend) and `PROJECT_PATH` (frontend) must point to the **exact same directory**. The frontend creates projects there; the backend reads/writes generated documents there.

**Permission denied (project directory)**: If paper generation fails with `[Errno 13] Permission denied` on `rough_plan.json` (or similar), the user running genlatex-agent cannot write to the project directory. Fix on the server: give the genlatex-agent process user write access, e.g. `sudo chown -R <genlatex-agent-user> /var/www/genlatex/data/projects` or `sudo chmod -R g+w /var/www/genlatex/data/projects` and add the agent user to the frontend user’s group.

**MinIO (optional)**: When frontend and backend are on different hosts and the frontend uses MinIO, set `USE_MINIO=true` and the same `MINIO_*` env vars (and `GENLATEX_PROJECTS_TEMP_PATH`) in genlatex-agent. The agent will sync projects from MinIO to a temp dir for chat and generate-from-files, then sync back. See **genlatex/docs/MINIO_SETUP.md** (Option B).

### Server

| Variable | Description |
|----------|-------------|
| `SERVER_HOST` | `0.0.0.0` to accept external connections |
| `SERVER_PORT` | Default 8000 |
| `WORKERS` | 4 recommended for production |
| `REQUEST_TIMEOUT` | 300 for long document generation |
| `MAX_CONCURRENT_PAPERS` | Limit concurrent generations (default 5) |

### Paper generation tuning

| Variable | Description |
|----------|-------------|
| `DEBUG_MODE` | `false` in production |
| `FAST_MODE` | `true` = fewer research steps, faster |
| `ENABLE_CHECKPOINTING` | `true` for resume support |

### Storage cleanup (automatic, no cron)

| Variable | Description |
|----------|-------------|
| `STORAGE_CLEANUP_ENABLED` | `true` (default) |
| `STORAGE_CLEANUP_INTERVAL_SEC` | 900 (15 min) |
| `CHECKPOINT_RETENTION_DAYS` | 7 |
| `OUTPUT_RETENTION_DAYS` | 30 |
| `LOG_RETENTION_DAYS` | 14 |

---

## 3. Production Migrations

Run before first start:

```bash
python scripts/production-migrations.py
```

This:

1. Loads `.env.production` (and `.env` overrides)
2. Creates directories: `template/`, `data/checkpoints/`, `data/output/`, `data/logs/`, `data/projects/`
3. Validates required env vars

---

## 4. Start the API

### Development

```bash
python run_api.py --reload
```

### Production

```bash
python run_api.py --production
```

Uses 4 workers by default. Port 8000.

### Verify

```bash
curl http://localhost:8000/health
```

---

## 5. Integration Checklist

### Backend ↔ Frontend

- [ ] `GENLATEX_AGENT_URL` on frontend points to this API (e.g. `https://api.genlatex.ai`)
- [ ] `AGENT_API_TOKEN` (here) = `GENLATEX_AGENT_API_KEY` (frontend) if auth enabled
- [ ] `ALLOWED_ORIGINS` includes frontend URL(s)

### Tools API readiness

- [ ] `/tools/<toolId>` endpoints enabled and reachable from the GenLaTeX app proxy
- [ ] `ENABLE_RATE_LIMITING=true` and `RATE_LIMIT_PER_MINUTE` set for VPS safety
- [ ] `WORKERS` sized for expected concurrency (2–4 for small VPS)
- [ ] `MAX_REQUEST_SIZE` large enough for tool uploads (images, PDFs, DOCX)

### Tools endpoints and limits

These are the public tool endpoints exposed by the agent:

- `POST /tools/abstract-generator` (max 5 MB upload)
- `POST /tools/thesis-statement-generator` (max 2 MB upload)
- `POST /tools/equation-to-latex` (JSON only)
- `POST /tools/doi-to-bibtex` (max 1 MB upload)
- `POST /tools/table-to-latex` (max 2 MB upload)
- `POST /tools/image-to-latex` (max 4 MB upload)
- `POST /tools/latex-to-pdf` (max 2 MB upload; requires pdflatex)
- `POST /tools/pdf-equation-extractor` (max 10 MB upload)
- `POST /tools/word-to-latex` (max 15 MB upload; requires pandoc)
- `POST /tools/arxiv-to-latex` (max 15 MB upload)

### Backend ↔ Storage

- [ ] `GENLATEX_PROJECTS_PATH` = same path as frontend `PROJECT_PATH`
- [ ] Directory exists and is writable by the process user
- [ ] When on same machine: use absolute path, e.g. `/var/lib/genlatex/data/projects`

### API keys

- [ ] `OPENROUTER_API_KEY` valid and has credits
- [ ] `TAVILY_API_KEY` set for web search (optional)

---

## 6. Process Manager (systemd example)

```ini
# /etc/systemd/system/genlatex-agent.service
[Unit]
Description=GenLaTeX Agent API
After=network.target

[Service]
Type=simple
User=genlatex
WorkingDirectory=/opt/genlatex/genlatex-agent
Environment=PATH=/opt/genlatex/genlatex-agent/venv/bin
EnvironmentFile=/opt/genlatex/genlatex-agent/.env
ExecStart=/opt/genlatex/genlatex-agent/venv/bin/python run_api.py --production
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable genlatex-agent
sudo systemctl start genlatex-agent
sudo systemctl status genlatex-agent
```

---

## 7. Reverse Proxy (nginx example)

```nginx
server {
    listen 443 ssl http2;
    server_name api.genlatex.ai;

    ssl_certificate     /etc/letsencrypt/live/api.genlatex.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.genlatex.ai/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

---

## 8. Storage Cleanup

**Automatic**: When the API runs, old checkpoints, output, and logs are deleted every 15 minutes. No cron needed. Cleanup runs in a thread pool so it does not block requests.

**Manual** (dry run or one-off):

```bash
python scripts/cleanup-storage.py       # Dry run
python scripts/cleanup-storage.py --run # Actually delete
```

---

## 9. Troubleshooting

### Paper generation fails / 500

- Check `OPENROUTER_API_KEY` is valid
- Check logs: `./data/logs/api.log` or systemd journal
- Increase `REQUEST_TIMEOUT` if document generation times out

### Project files not found

- `GENLATEX_PROJECTS_PATH` must match frontend `PROJECT_PATH`
- Use absolute path: `/var/lib/genlatex/data/projects`
- Ensure directory exists and is writable

### CORS errors

- Add frontend URL to `ALLOWED_ORIGINS`
- Format: `https://app.genlatex.ai,https://genlatex.ai` (no trailing slash)

### Rate limiting

- Adjust `RATE_LIMIT_PER_MINUTE` if needed
- Check `_rate_limit_ok` in api/main.py for implementation

### Import errors

- Activate venv: `source venv/bin/activate`
- Reinstall: `pip install -r requirements.txt`

---

## 10. Related Docs

- **genlatex/DEPLOYMENT.md** – Frontend deployment (deploy together)
- **SETUP_SCRIPTS_AND_ENV.md** (in genlatex/) – Full env reference
- **env_template** – All available env vars with descriptions
