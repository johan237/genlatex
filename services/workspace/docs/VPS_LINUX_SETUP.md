# VPS Linux Production Setup Guide

Step-by-step guide to deploy GenLaTeX (frontend + backend) on a **Linux VPS** with correct **production paths** and process management. Use this for a single-server deployment (e.g. Ubuntu 22.04 / Debian 12).

**See also:** [DEPLOYMENT.md](../DEPLOYMENT.md) (frontend), [genlatex-agent/DEPLOYMENT.md](../../genlatex-agent/DEPLOYMENT.md) (backend), [MINIO_SETUP.md](MINIO_SETUP.md) (optional S3 storage).

---

## 1. Prerequisites

- **VPS**: Ubuntu 22.04 LTS or Debian 12 (or similar)
- **Root or sudo** access
- **Domain(s)** pointed to the VPS (e.g. `app.example.com`, `api.example.com`)
- **PostgreSQL** (same server or managed, e.g. Neon/Supabase)

### Software to install

| Component        | Purpose                          |
|-----------------|-----------------------------------|
| Node.js 18+ LTS | Next.js frontend                  |
| Python 3.10+    | GenLaTeX Agent backend              |
| PostgreSQL      | Database (or use managed DB)      |
| pdflatex        | LaTeX → PDF (TeX Live or MiKTeX) |
| Nginx           | Reverse proxy + SSL               |
| (optional) Tesseract | OCR for PDF research files   |

---

## 2. Recommended Directory Layout

Use a **single, consistent layout** so frontend and backend share the same project data path.

```
/opt/genlatex/                    # App install (or /var/www/genlatex)
├── genlatex/                     # Next.js app
│   ├── .env                    # Production env (PROJECT_PATH = absolute)
│   └── ...
├── genlatex-agent/               # Python backend
│   ├── .env                    # Production env (GENLATEX_PROJECTS_PATH = same as PROJECT_PATH)
│   ├── venv/
│   └── ...
└── (optional: genlatex-website/  # Landing page)

/var/lib/genlatex/                 # Data (persistent, same path for both apps)
└── data/
    └── projects/               # Shared project files (LaTeX, PDFs, etc.)
```

**Critical:** Both apps must use the **exact same absolute path** for project storage:

- **Frontend (genlatex):** `PROJECT_PATH=/var/lib/genlatex/data/projects`
- **Backend (genlatex-agent):** `GENLATEX_PROJECTS_PATH=/var/lib/genlatex/data/projects`

Using relative paths (e.g. `./data/projects`) in production is error-prone because `process.cwd()` depends on how the process is started. **Always use absolute paths on the VPS.**

If genlatex-agent runs as a different user than the frontend (e.g. `www-data` vs `genlatex`), that user must have **write access** to the project directory or paper generation will fail with "Permission denied". Run both as the same user when possible, or see **genlatex-agent/DEPLOYMENT.md** for chown/chmod instructions.

---

## 3. System Setup

### 3.1 Create app user (optional but recommended)

```bash
sudo adduser --disabled-password --gecos "" genlatex
sudo mkdir -p /opt/genlatex /var/lib/genlatex/data/projects
sudo chown -R genlatex:genlatex /opt/genlatex /var/lib/genlatex
```

### 3.2 Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3.3 Install Python 3.10+ and venv

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip
```

### 3.4 Install LaTeX (pdflatex)

The app compiles LaTeX with **pdflatex** (see `genlatex/lib/compile.js`). Install TeX Live:

```bash
sudo apt-get install -y texlive-base texlive-latex-extra texlive-bibtex-extra texlive-fonts-recommended
# Or full TeX Live (larger):
# sudo apt-get install -y texlive-full
```

Verify:

```bash
pdflatex --version
```

### 3.5 Install PostgreSQL (if self-hosted)

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo -u postgres createuser -s genlatex
sudo -u postgres createdb -O genlatex genlatex
# Set password and use in DATABASE_URL
```

### 3.6 Install Nginx

```bash
sudo apt-get install -y nginx
```

### 3.7 (Optional) Tesseract for PDF research files

```bash
sudo apt-get install -y tesseract-ocr
```

---

## 4. Deploy the Code

### 4.1 Clone repository

```bash
sudo -u genlatex git clone https://github.com/your-org/genlatex.git /opt/genlatex/repo
# Or upload via rsync/scp; then:
sudo chown -R genlatex:genlatex /opt/genlatex/repo
```

### 4.2 Frontend (genlatex)

```bash
cd /opt/genlatex/repo/genlatex
sudo -u genlatex npm ci
sudo -u genlatex npm run build
# Symlink or copy so app runs from a stable path, e.g.:
# sudo cp -r /opt/genlatex/repo/genlatex /opt/genlatex/genlatex
# Or run from repo: cd /opt/genlatex/repo/genlatex
```

### 4.3 Backend (genlatex-agent)

```bash
cd /opt/genlatex/repo/genlatex-agent
sudo -u genlatex python3 -m venv venv
sudo -u genlatex ./venv/bin/pip install -r requirements.txt
# Optional: run production migrations
sudo -u genlatex ./venv/bin/python scripts/production-migrations.py
```

---

## 5. Environment and Production Paths

### 5.1 Frontend `.env` (genlatex)

Create or copy from `.env.production`:

```bash
cd /opt/genlatex/repo/genlatex   # or /opt/genlatex/genlatex
sudo -u genlatex cp .env.production .env
sudo -u genlatex nano .env
```

**Set these for production:**

| Variable              | Example / note |
|-----------------------|----------------|
| `NODE_ENV`            | `production` |
| `DATABASE_URL`        | `postgresql://user:pass@localhost:5432/genlatex` or your managed DB URL |
| `BETTER_AUTH_SECRET`  | Min 32 chars: `openssl rand -base64 32` |
| `BETTER_AUTH_URL`     | `https://app.example.com` (no trailing slash) |
| `NEXT_PUBLIC_BASE_URL`| `https://app.example.com` |
| `NEXT_PUBLIC_APP_URL` | `https://app.example.com` |
| `GENLATEX_AGENT_URL`    | `https://api.example.com` (or `http://127.0.0.1:8000` if same host) |
| `GENLATEX_AGENT_API_KEY`| Same value as `AGENT_API_TOKEN` on backend |
| **`PROJECT_PATH`**    | **`/var/lib/genlatex/data/projects`** (absolute path) |

Leave other vars (Google OAuth, Resend, Stripe, OpenRouter, etc.) as in `.env.production` and fill in real values.

### 5.2 Backend `.env` (genlatex-agent)

```bash
cd /opt/genlatex/repo/genlatex-agent
sudo -u genlatex cp .env.production .env
sudo -u genlatex nano .env
```

**Set these for production:**

| Variable                   | Example / note |
|----------------------------|----------------|
| `OPENROUTER_API_KEY`       | Your OpenRouter key |
| **`GENLATEX_PROJECTS_PATH`** | **`/var/lib/genlatex/data/projects`** (same as frontend `PROJECT_PATH`) |
| `AGENT_API_TOKEN`          | Same value as frontend `GENLATEX_AGENT_API_KEY` |
| `ALLOWED_ORIGINS` or `CORS_ORIGINS` | `https://app.example.com` |
| `TEMPLATE_DIR`             | `./template` or absolute `/opt/genlatex/repo/genlatex-agent/template` |
| `CHECKPOINT_DIR`           | `./data/checkpoints` or absolute path |
| `OUTPUT_DIR`               | `./data/output` or absolute path |

**Path rule:** `GENLATEX_PROJECTS_PATH` and frontend `PROJECT_PATH` must be the **exact same string** (e.g. `/var/lib/genlatex/data/projects`).

### 5.3 Ensure data directory exists and is writable

```bash
sudo mkdir -p /var/lib/genlatex/data/projects
sudo chown -R genlatex:genlatex /var/lib/genlatex
```

---

## 6. Database Migrations (Frontend)

From the genlatex directory:

```bash
cd /opt/genlatex/repo/genlatex
sudo -u genlatex npm run production-migrate
```

This runs DB migrations, Better Auth schema, and optionally Stripe product creation.

---

## 7. Process Management (systemd)

### 7.1 GenLaTeX frontend

Create `/etc/systemd/system/genlatex.service`:

```ini
[Unit]
Description=GenLaTeX Next.js App
After=network.target postgresql.service

[Service]
Type=simple
User=genlatex
Group=genlatex
WorkingDirectory=/opt/genlatex/repo/genlatex
Environment=NODE_ENV=production
EnvironmentFile=/opt/genlatex/repo/genlatex/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

If you use a copied app dir instead of repo, set `WorkingDirectory=/opt/genlatex/genlatex` and `EnvironmentFile=/opt/genlatex/genlatex/.env`.

### 7.2 GenLaTeX Agent backend

Create `/etc/systemd/system/genlatex-agent.service`:

```ini
[Unit]
Description=GenLaTeX Agent API
After=network.target

[Service]
Type=simple
User=genlatex
Group=genlatex
WorkingDirectory=/opt/genlatex/repo/genlatex-agent
Environment=PATH=/opt/genlatex/repo/genlatex-agent/venv/bin
EnvironmentFile=/opt/genlatex/repo/genlatex-agent/.env
ExecStart=/opt/genlatex/repo/genlatex-agent/venv/bin/python run_api.py --production
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 7.3 Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable genlatex genlatex-agent
sudo systemctl start genlatex genlatex-agent
sudo systemctl status genlatex genlatex-agent
```

---

## 8. Nginx Reverse Proxy and SSL

### 8.1 Frontend (app)

Create `/etc/nginx/sites-available/genlatex-app`:

```nginx
server {
    listen 80;
    server_name app.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    # Allow large uploads (ZIP import, project creation with files). Default is 1MB.
    client_max_body_size 50m;

    ssl_certificate     /etc/letsencrypt/live/app.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
    }
}
```

### 8.2 Backend (api)

Create `/etc/nginx/sites-available/genlatex-api`:

```nginx
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

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

### 8.3 SSL with Certbot

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d app.example.com -d api.example.com
sudo systemctl reload nginx
```

Enable the sites:

```bash
sudo ln -s /etc/nginx/sites-available/genlatex-app /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/genlatex-api /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. Checklist

### Paths

- [ ] `PROJECT_PATH` (genlatex) = **absolute** path, e.g. `/var/lib/genlatex/data/projects`
- [ ] `GENLATEX_PROJECTS_PATH` (genlatex-agent) = **same** absolute path
- [ ] `/var/lib/genlatex/data/projects` exists and is owned by `genlatex` (or the user running the apps)

### Integration

- [ ] Frontend can reach backend: `GENLATEX_AGENT_URL` (e.g. `https://api.example.com`)
- [ ] `GENLATEX_AGENT_API_KEY` = `AGENT_API_TOKEN`
- [ ] Backend `ALLOWED_ORIGINS` / `CORS_ORIGINS` includes `https://app.example.com`
- [ ] Database migrations and Better Auth schema applied
- [ ] Auth: Google OAuth callback `https://app.example.com/api/auth/callback/google`

### Services

- [ ] `systemctl status genlatex` and `genlatex-agent` show active
- [ ] `curl -s http://127.0.0.1:3000` and `curl -s http://127.0.0.1:8000/health` succeed
- [ ] Nginx serves app and api over HTTPS

---

## 10. Troubleshooting

### Project files not found / compile fails

- Confirm **both** `PROJECT_PATH` and `GENLATEX_PROJECTS_PATH` are the **exact same** absolute path.
- Check permissions: `ls -la /var/lib/genlatex/data/projects` (should be writable by the service user).
- From genlatex app dir, `node -e "console.log(process.env.PROJECT_PATH)"` should print that path (run as same user as systemd).

### Paper generation 502 / timeout

- Backend must be reachable from the Next.js server (use internal URL or `http://127.0.0.1:8000` if same host).
- Check agent logs: `sudo journalctl -u genlatex-agent -f`.
- Ensure `REQUEST_TIMEOUT` is sufficient (e.g. 300) in genlatex-agent `.env`.

### LaTeX compilation fails

- App uses **pdflatex** (not Tectonic). Install TeX Live: `apt-get install texlive-base texlive-latex-extra texlive-bibtex-extra`.
- Run `pdflatex --version` as the same user that runs the genlatex service.

### Import ZIP / upload returns 413 Payload Too Large

- **Cause**: nginx limits request body size. Default is 1MB.
- **Fix**: Add `client_max_body_size 50m;` to the app nginx server block (section 8.1). Then: `sudo nginx -t && sudo systemctl reload nginx`

### Relative path issues

- Never rely on `./data/projects` in production. Always set `PROJECT_PATH` and `GENLATEX_PROJECTS_PATH` to the **same absolute path** on the VPS.

---

## 11. Saving This Guide

This guide is stored in the repo at:

- **genlatex:** `genlatex/docs/VPS_LINUX_SETUP.md`
- **From repo root:** `docs/VPS_LINUX_SETUP.md` (if you consider genlatex the main app)

Commit and push so the team and future deploys use the same layout and path rules:

```bash
git add genlatex/docs/VPS_LINUX_SETUP.md
git commit -m "docs: add VPS Linux production setup guide with correct paths"
git push
```

---

## 12. Related Docs

- [DEPLOYMENT.md](../DEPLOYMENT.md) – Frontend deployment details
- [genlatex-agent/DEPLOYMENT.md](../../genlatex-agent/DEPLOYMENT.md) – Backend deployment
- [MINIO_SETUP.md](MINIO_SETUP.md) – Optional S3-compatible storage
- [.env.production](../.env.production) – Frontend env template (use absolute `PROJECT_PATH` in production)
