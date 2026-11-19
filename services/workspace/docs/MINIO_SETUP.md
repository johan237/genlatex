# MinIO Setup – Replacing Local File Storage

Step-by-step guide to replace GenLaTeX’s current **local filesystem** project storage with **MinIO** (S3-compatible object storage). Use this for scalable, multi-node, or cloud deployments.

**See also:** [MINIO_IMPLEMENTATION_SUMMARY.md](MINIO_IMPLEMENTATION_SUMMARY.md) for what was implemented and what you need to do on your side.

---

## Optimal choices (TL;DR)

| Decision | Optimal choice | Why |
|----------|----------------|-----|
| **Run MinIO** | **Option A: Docker** | Same setup everywhere, easy upgrades, no manual binary install. Use Option B (binary) only if you can’t run Docker. |
| **Backend (compile/agent)** | **Option A: Shared dir, Next.js syncs** | One place talks to MinIO (genlatex). Backend stays simple and unchanged. Use Option B only if genlatex and genlatex-agent run on **different machines** and can’t share a filesystem. |

So in practice: **Docker for MinIO** + **Option A for backend** (Next.js syncs from MinIO to a local/shared dir before compile and before calling the agent, then syncs results back). Option B (backend uses MinIO) is for when frontend and backend are on separate hosts and you don’t want to sync over the network from Next.js to the agent.

---

## 1. Current Storage (What You’re Replacing)

- **Location**: Project files live under `PROJECT_PATH` (default `./data/projects`).
- **Layout**: One directory per project: `{PROJECT_PATH}/{projectId}/` containing:
  - LaTeX sources (`.tex`), bibliography (`.bib`), images, `project_metadata.json`
  - `template/`, `research_files/`, `output/` (PDFs), etc.
- **Frontend**: `genlatex/lib/files.js` – `getProjectPath()`, `readTextFile()`, `writeTextFile()`, `atomicWriteFile()`, `deleteProjectFiles()` – and many API routes/lib files that use `fs` with paths from `getProjectPath()`.
- **Backend**: `genlatex-agent` expects a **real directory path** (e.g. for Tectonic compile and file processors). It receives `project_path` from the Next.js app.

MinIO will store the same logical tree as **objects** under a bucket (e.g. `projects/{projectId}/path/to/file`). The app will use a storage layer that can be either **local fs** or **MinIO**.

---

## 2. Install and Run MinIO

### Option A: Docker (recommended)

```bash
# Create a directory for MinIO data (or use a volume)
mkdir -p ./minio-data

# Run MinIO server (API on 9000, Console on 9001)
docker run -d \
  --name minio \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=genlatex_minio_admin \
  -e MINIO_ROOT_PASSWORD=your_secure_password \
  -v ./minio-data:/data \
  minio/minio server /data --console-address ":9001"
```

- **API**: `http://localhost:9000`
- **Web Console**: `http://localhost:9001` (login with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`)

### Option B: Binary (Windows / Linux / macOS)

1. Download: <https://min.io/download> (e.g. `minio.exe` on Windows, `minio` on Linux/macOS).
2. Run:

```bash
# Set credentials via env (or use default minioadmin/minioadmin)
set MINIO_ROOT_USER=genlatex_minio_admin
set MINIO_ROOT_PASSWORD=your_secure_password

# Windows
minio.exe server .\minio-data --console-address ":9001"

# Linux/macOS
./minio server ./minio-data --console-address ":9001"
```

Again: API on port **9000**, Console on **9001**.

---

## 3. Create Bucket and Access Keys

### 3.1 Create bucket

1. Open **http://localhost:9001** and log in with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`.
2. **Buckets** → **Create Bucket**.
3. Name: e.g. `genlatex-projects`. Region can stay default (e.g. `us-east-1`). Create.

### 3.2 Create access key for the app (recommended)

Using the root user for the app is possible but not ideal. Prefer a dedicated key:

1. **Access Keys** (or Identity → Service Accounts) → **Create access key**.
2. Name e.g. `genlatex-app`. Note the **Access Key** and **Secret Key** (secret shown once).

If your MinIO version only has root credentials, use `MINIO_ROOT_USER` as access key and `MINIO_ROOT_PASSWORD` as secret key.

You should have:

- **Endpoint**: `localhost` (or your server hostname)
- **Port**: `9000`
- **Bucket**: `genlatex-projects`
- **Access Key**: e.g. `genlatex_app_key_xxx`
- **Secret Key**: e.g. `...`

---

## 4. Environment Variables

### 4.1 Frontend (genlatex)

In `genlatex/.env` (or `.env.production`):

```env
# --- MinIO (optional; omit to keep using local PROJECT_PATH) ---
USE_MINIO=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=genlatex_app_key_xxx
MINIO_SECRET_KEY=your_secret_key_here
MINIO_BUCKET=genlatex-projects

# If MinIO is disabled, local storage is used:
# PROJECT_PATH=./data/projects
```

- If `USE_MINIO` is unset or `false`, existing behavior stays: `PROJECT_PATH` is used and `lib/files.js` talks only to the local filesystem.

### 4.2 Backend (genlatex-agent)

The backend needs a **local directory** when running Tectonic and file processors. Two approaches:

**Option A – Shared directory (recommended)**  
Keep using a shared `PROJECT_PATH` / `GENLATEX_PROJECTS_PATH`. Next.js syncs from MinIO **to** that directory when needed (e.g. before compile, before calling the agent) and syncs results back to MinIO. No MinIO config or code in genlatex-agent. **Best when** genlatex and genlatex-agent run on the same machine (or share a filesystem).

**Option B – Backend uses MinIO**  
Backend has its own MinIO config and a **temp directory**. When it receives a “project path”, it treats it as project ID, syncs that project from MinIO into a temp dir, runs compile/generation there, then uploads outputs back to MinIO. Implemented in genlatex-agent: chat and generate-from-files use MinIO when USE_MINIO is set (sync from bucket to temp, run, sync back).

**Use when** frontend and backend are on different hosts and you don't want Next.js to push project data to the agent over the network.

**genlatex-agent .env for Option A (recommended)**  
You do **not** add any MinIO variables to genlatex-agent. Only set the shared project path so it matches the frontend:

```env
# genlatex-agent/.env – REQUIRED when genlatex and genlatex-agent share project files (with or without MinIO)
# Must be the same absolute path as genlatex's PROJECT_PATH (Next.js syncs MinIO ↔ this dir)
GENLATEX_PROJECTS_PATH=/var/lib/genlatex/data/projects
```

- **Same machine**: Use the same path as `PROJECT_PATH` in genlatex (e.g. `/var/lib/genlatex/data/projects` or `C:\genlatex\data\projects` on Windows).
- **Different machine with shared mount**: Point both to the same mounted path (e.g. `/mnt/genlatex/projects`).

Example for **Option B** (backend has MinIO and temp dir). Use the **same bucket and credentials** as the frontend:

```env
USE_MINIO=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=genlatex-projects
GENLATEX_PROJECTS_TEMP_PATH=/tmp/genlatex-projects
```

Install the MinIO Python client in genlatex-agent: `pip install minio`.

---

## 5. Code Changes – Storage Abstraction

The goal is a single abstraction used everywhere instead of direct `fs` + `getProjectPath()`.

### 5.1 Install MinIO client (frontend)

```bash
cd genlatex
npm install minio
```

### 5.2 Add storage interface and implementations

Introduce a small storage layer that supports both **local** and **MinIO**:

- **Path convention in MinIO**: object key = `{projectId}/{relativePath}` (e.g. `abc-123/main.tex`, `abc-123/research_files/data.csv`).
- **API** (same as current usage pattern):
  - `getProjectPath(userId, projectId)` → logical “prefix” (for local: dir path; for MinIO: prefix string).
  - `readFile(projectId, relativePath)` → buffer or string.
  - `writeFile(projectId, relativePath, content)`.
  - `listFiles(projectId, prefix?)` → list of relative paths (or keys).
  - `deleteProject(projectId)`.
  - `exists(projectId, relativePath)`.

Suggested layout:

- `genlatex/lib/storage/index.js` – factory: reads `USE_MINIO` and env, returns either:
  - `storage-fs.js` – current behavior using `PROJECT_PATH` and `fs`.
  - `storage-minio.js` – MinIO client, same interface using bucket + `projectId/` prefix.

Then:

- **`lib/files.js`**: Change to use the chosen storage implementation (from `lib/storage/index.js`) instead of raw `fs` and `basePath`. Keep the same exported API (`getProjectPath`, `readTextFile`, `writeTextFile`, `atomicWriteFile`, `deleteProjectFiles`, etc.) so callers do not need to change.
- **API routes and other libs**: Keep using `lib/files.js` only; no need to switch to MinIO directly.

Details to implement in `storage-minio.js`:

- Use `minio` package; create client from `MINIO_*` env.
- `readFile`: `getObject(bucket, projectId + '/' + relativePath)`.
- `writeFile`: `putObject(bucket, projectId + '/' + relativePath, content, size)`.
- `listFiles`: `listObjectsV2` with prefix `projectId/`, then strip prefix to get relative paths.
- `deleteProject`: list all objects with prefix `projectId/` and remove them (or use removeObjects in a loop).
- `atomicWriteFile`: MinIO has no rename; either write to final key (overwrite) or write to a temp key then copy/delete; for text files, single `putObject` is usually enough.

### 5.3 Compilation and backend (Option A)

- **Compile**: Today compile runs on the Next.js server and expects a real project dir. So:
  - When using MinIO, **before** calling compile: sync the project from MinIO to a **local temp directory** (e.g. `os.tmpdir()/genlatex-compile/{projectId}-{random}`).
  - Point compile at that temp dir; after compile, read the produced PDF (and any outputs) from the temp dir, then **upload** them back to MinIO under the same project prefix (e.g. `output/main.pdf`).
  - Optionally delete the temp dir after upload.
- **Paper generation (agent)**:
  - Before calling genlatex-agent, sync the project from MinIO to the same shared directory (or to a temp dir and pass that path as `project_path`).
  - After generation, sync new/changed files from that directory back to MinIO.

So the flow is: **MinIO → (sync) → local dir → compile/agent → (sync) → MinIO**.

### 5.4 Backend (Option B) – implemented

- In genlatex-agent, `utils/minio_storage.py` provides `resolve_project_path(project_path, project_id)`: when `USE_MINIO` is set and the given path does not exist on this host, it syncs the project from MinIO into `GENLATEX_PROJECTS_TEMP_PATH/{projectId}/` and returns that path plus a cleanup that syncs back to MinIO.
- The **chat** and **api/generate-latex-from-files** endpoints use this: they resolve the project path, run against the (possibly temp) dir, and call cleanup when the request finishes so results are synced back to MinIO.
- Object key layout matches the frontend: `{projectId}/{relativePath}`.

---

## 6. Migration – Existing Data to MinIO

A migration script uploads all projects from local `PROJECT_PATH` to MinIO using the same object key layout as the app: `{projectId}/{relativePath}`.

### Run the migration script

From the **genlatex** directory, with MinIO running and `.env` containing `MINIO_*` (and optionally `USE_MINIO=true`):

```bash
cd genlatex
npm run migrate-to-minio
```

- **Dry run** (list files only, no upload):  
  `npm run migrate-to-minio:dry-run`
- The script creates the bucket if it does not exist, then uploads every file under `PROJECT_PATH/{projectId}/` to MinIO with key `{projectId}/{relativePath}`.
- A report is written to `scripts/migrate-to-minio-report.json` (projects migrated, file counts, errors, timestamps).

### After migration

1. Check MinIO Console (e.g. http://localhost:9001) that objects appear under the bucket (e.g. `genlatex-projects`).
2. Ensure `USE_MINIO=true` and `MINIO_*` are set in `genlatex/.env`.
3. Restart the genlatex app; it will read/write from MinIO and sync to local for compile/agent.
4. Optionally archive or clear the old `PROJECT_PATH` dir after verifying the app works with MinIO.

---

## 7. Checklist Summary

| Step | Action |
|------|--------|
| 1 | Install/run MinIO (Docker or binary). |
| 2 | Create bucket (e.g. `genlatex-projects`) in MinIO Console **or** rely on auto-creation (bucket is created on first write if missing). Create access key for the app. |
| 3 | Add `USE_MINIO=true` and `MINIO_*` to `genlatex/.env` (see §4.1). |
| 4 | `npm install minio` in genlatex (already in package.json). |
| 5 | Set `GENLATEX_PROJECTS_PATH` in `genlatex-agent/.env` to the **same path** as genlatex’s `PROJECT_PATH` (see §4.2). No MinIO vars in genlatex-agent for Option A. |
| 6 | Migrate existing projects to MinIO if needed (see §6). |
| 7 | Test: create project, edit file, compile, run paper generation; verify objects in MinIO Console. |

**Implementation status**: Storage layer (`lib/storage/`), `lib/files.js` refactor, sync in compile/agent/research-upload, project creation/rename/metadata via storage, and bucket auto-creation on first write are implemented. Use this checklist for your environment and migration.
