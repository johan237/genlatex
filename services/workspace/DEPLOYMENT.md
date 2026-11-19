# GenLaTeX Frontend – Deployment Guide

Complete guide to deploy the GenLaTeX Next.js app (main editor + dashboard) to production. Focus is on app integration, configuration, and making everything work together.

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** database (local, Neon, Supabase, RDS, etc.)
- **GenLaTeX Agent** backend running and reachable (see `genlatex-agent/DEPLOYMENT.md`)
- **Tectonic** LaTeX compiler (for PDF compilation)
- **Tesseract OCR** (optional, for PDF research file extraction)

---

## 1. Clone and Install

```bash
cd genlatex
npm install
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
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://user:pass@host:5432/genlatex?sslmode=require` |
| `BETTER_AUTH_SECRET` | Min 32 chars; `openssl rand -base64 32` | |
| `BETTER_AUTH_URL` | Production app URL (no trailing slash) | `https://app.genlatex.ai` |
| `GENLATEX_AGENT_URL` | Backend API URL (must be reachable from this app) | `https://api.genlatex.ai` or `http://localhost:8000` |
| `OPENROUTER_API_KEY` | From openrouter.ai (chat + paper generation) | `sk-or-v1-...` |
| `NEXT_PUBLIC_BASE_URL` | Public app URL for links/redirects | `https://app.genlatex.ai` |
| `NEXT_PUBLIC_APP_URL` | Same as above | `https://app.genlatex.ai` |

### Auth (Better Auth)

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth (from Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `RESEND_API_KEY` | From resend.com (verification + password reset) |
| `EMAIL_FROM` | Sender, e.g. `GenLaTeX <noreply@yourdomain.com>` |

### Backend integration

| Variable | Description |
|----------|-------------|
| `GENLATEX_AGENT_API_KEY` | Must match `AGENT_API_TOKEN` on genlatex-agent if you secure the API |

### Stripe (payments)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Use `sk_live_` for production |
| `STRIPE_PUBLISHABLE_KEY` | Use `pk_live_` for production |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret |
| `STRIPE_PRO_PRODUCT_ID` | Created by migration script or Stripe Dashboard |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | |
| `STRIPE_PRO_YEARLY_PRICE_ID` | |

### Storage (project files)

| Variable | Description | Same-machine deployment |
|----------|-------------|-------------------------|
| `PROJECT_PATH` | Where project files live | Use **same absolute path** as `GENLATEX_PROJECTS_PATH` on genlatex-agent, e.g. `/var/lib/genlatex/data/projects` |

**Critical**: When genlatex and genlatex-agent run on the same machine, `PROJECT_PATH` (frontend) and `GENLATEX_PROJECTS_PATH` (backend) must point to the **exact same directory**. Both read/write project files there.

**MinIO (optional)**: To use S3-compatible object storage instead of local disk, see **[docs/MINIO_SETUP.md](docs/MINIO_SETUP.md)** for step-by-step setup and **[docs/MINIO_IMPLEMENTATION_SUMMARY.md](docs/MINIO_IMPLEMENTATION_SUMMARY.md)** for implementation summary and what you need to do.

---

## 3. Database Setup

### Create database

Create a PostgreSQL database (e.g. `genlatex`) and set `DATABASE_URL` in `.env`.

### Run migrations

```bash
npm run production-migrate
```

This runs (in order):

1. **Database migrations** – users, sessions, projects, project_shares, research_files, chat_messages, etc.
2. **Better Auth schema** – `npx @better-auth/cli migrate`
3. **Stripe products** – creates Pro product/prices (uses `STRIPE_SECRET_KEY`; live keys = live products)

If Stripe keys are placeholders, the script skips product creation. Run manually later:

```bash
node scripts/create-stripe-products.js
```

---

## 4. Build and Run

### Build

```bash
npm run build
```

### Start production server

```bash
npm start
```

Default port: **3000**. Use a process manager (PM2, systemd) for production.

### Example: PM2

```bash
pm2 start npm --name "genlatex" -- start
pm2 save
pm2 startup
```

---

## 5. Integration Checklist

### Frontend ↔ Backend

- [ ] `GENLATEX_AGENT_URL` is reachable from the Next.js server (not just the browser)
- [ ] If `AGENT_API_TOKEN` is set on genlatex-agent, set `GENLATEX_AGENT_API_KEY` to the same value
- [ ] CORS: Add your frontend URL to `ALLOWED_ORIGINS` on genlatex-agent

### Tools Proxy (Marketing site ↔ App ↔ Agent)

- [ ] `NEXT_PUBLIC_APP_URL` on the marketing site points to this app domain
- [ ] `MARKETING_SITE_ORIGIN` or `TOOLS_CORS_ORIGIN` set to the marketing site origin
- [ ] `/api/tools/<toolId>` proxy is reachable from the marketing site
- [ ] Agent `/tools/<toolId>` endpoints are up and reachable from this app

### Frontend ↔ Database

- [ ] `DATABASE_URL` connects successfully
- [ ] Migrations completed without errors
- [ ] Better Auth schema applied

### Frontend ↔ Storage

- [ ] `PROJECT_PATH` directory exists and is writable
- [ ] Same path as `GENLATEX_PROJECTS_PATH` when on same machine

### Stripe

- [ ] Webhook endpoint: `https://app.genlatex.ai/api/webhooks/stripe`
- [ ] Webhook events: `checkout.session.completed`, `customer.subscription.updated`, `invoice.payment_succeeded`
- [ ] `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard

### Auth

- [ ] Google OAuth redirect: `https://app.genlatex.ai/api/auth/callback/google`
- [ ] Resend domain verified (if using email)

---

## 6. Process Manager (systemd example)

```ini
# /etc/systemd/system/genlatex.service
[Unit]
Description=GenLaTeX Next.js App
After=network.target postgresql.service

[Service]
Type=simple
User=genlatex
WorkingDirectory=/opt/genlatex/genlatex
Environment=NODE_ENV=production
EnvironmentFile=/opt/genlatex/genlatex/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable genlatex
sudo systemctl start genlatex
sudo systemctl status genlatex
```

---

## 7. Reverse Proxy (nginx example)

```nginx
server {
    listen 443 ssl http2;
    server_name app.genlatex.ai;

    # Allow large uploads (ZIP import, project creation with files). Default is 1MB.
    client_max_body_size 50m;

    ssl_certificate     /etc/letsencrypt/live/app.genlatex.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.genlatex.ai/privkey.pem;

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

### Optional: Rate limit tools traffic

For small concurrency on a VPS, rate-limit the tools proxy to prevent abuse:

```nginx
limit_req_zone $binary_remote_addr zone=tools_zone:10m rate=20r/m;

server {
    # ...
    location /api/tools/ {
        limit_req zone=tools_zone burst=10 nodelay;
        proxy_pass http://127.0.0.1:3000;
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

## 8. Tools load test (small concurrency)

Run a lightweight test against the tools proxy to validate stability:

```bash
# Requires k6 (https://k6.io)
k6 run -e BASE_URL="https://app.genlatex.ai" -e TOOL_ID="image-to-latex" scripts/load-test-tools.js
```

If you prefer a quick smoke test without load:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://app.genlatex.ai/api/tools/doi-to-bibtex
```

## 9. Monitoring for tools

- Watch `genlatex` logs for `/api/tools/*` 502/500 responses.
- Watch `genlatex-agent` logs for tool failures and timeouts.
- If you add nginx rate limits, monitor `429` responses to tune limits.

---

## 8. Troubleshooting

### Database connection fails

- Check `DATABASE_URL` format and SSL mode
- Ensure PostgreSQL allows connections from your server
- For managed DB (Neon, Supabase): use `?sslmode=require`

### Paper generation fails / 502

- Verify `GENLATEX_AGENT_URL` is correct and reachable from the Next.js process
- Check genlatex-agent logs
- Ensure `GENLATEX_AGENT_API_KEY` matches `AGENT_API_TOKEN` if auth is enabled

### Project files not found

- `PROJECT_PATH` must match `GENLATEX_PROJECTS_PATH` on genlatex-agent
- Use absolute paths in production: `/var/lib/genlatex/data/projects`
- Ensure directory exists and app user has read/write

### Stripe webhooks not firing

- Confirm webhook URL and secret in Stripe Dashboard
- Check firewall allows Stripe IPs
- Test with Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

### Import ZIP / upload returns 413 Payload Too Large

- **Cause**: nginx (or your reverse proxy) limits request body size. Default is 1MB.
- **Fix**: Add `client_max_body_size 50m;` to your nginx `server` block (see section 7). Then reload: `sudo nginx -t && sudo systemctl reload nginx`

### Build errors

- `rm -rf .next node_modules && npm install && npm run build`
- Node 18+ required

---

## 9. Related Docs

- **docs/VPS_LINUX_SETUP.md** – Full VPS Linux production guide (paths, systemd, nginx)
- **genlatex-agent/DEPLOYMENT.md** – Backend deployment (run first or in parallel)
- **SETUP_SCRIPTS_AND_ENV.md** – Full env var reference and quick start
- **STRIPE_SETUP.md** – Stripe configuration details
- **docs/AUTH_SETUP.md** – Auth setup details
