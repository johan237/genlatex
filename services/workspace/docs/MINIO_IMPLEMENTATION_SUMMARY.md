# MinIO Implementation Summary

Summary of what was implemented and what you need to do on your side to use MinIO (or keep using local storage).

---

## What Was Implemented

### 1. Storage layer (genlatex)

- **`lib/storage/index.js`** – Chooses FS or MinIO based on `USE_MINIO` env.
- **`lib/storage/storage-fs.js`** – Local disk: `PROJECT_PATH`, same API as before.
- **`lib/storage/storage-minio.js`** – MinIO (S3-compatible): object keys `{projectId}/{relativePath}`, sync to/from local for compile and agent. **Bucket is auto-created on first write** if it doesn’t exist.

### 2. lib/files.js

- All project file APIs go through the storage layer.
- **`getProjectPath`**, **`ensureProjectDir`**, **`readTextFile`**, **`writeTextFile`**, **`deleteProjectFiles`** – Unchanged API, implemented via storage.
- **`readFile(projectId, relativePath, options)`**, **`writeFile(projectId, relativePath, content)`**, **`fileExists(projectId, relativePath)`**, **`listDir(projectId, subdir)`** – New async APIs for storage-agnostic access.
- **`atomicWriteFile(filePath, content, encoding)`** – When path is under `PROJECT_PATH/projectId` and MinIO is on, writes via storage; otherwise uses storage’s atomic write.
- **`syncProjectToLocal(projectId)`**, **`syncProjectFromLocal(projectId)`** – Used for Option A (shared dir): sync MinIO ↔ local before/after compile and agent. No-ops when using FS.
- **`isMinio()`** – Returns true when MinIO backend is active.

### 3. Sync (Option A – recommended)

- **Compile** – Before compile: sync project from MinIO to local; after compile: sync local back to MinIO (so PDFs are in MinIO).
- **Paper generation** – Before reading project/template: sync from MinIO to local; after PUT completion: sync from local to MinIO (so generated files are in MinIO).
- **Research upload** – After uploads (including ZIP extraction to local): sync from local to MinIO when MinIO is on.

### 4. Routes and libs updated to use storage

- **`app/api/files/[projectId]/route.js`** – GET/POST use `readFile` / `fileExists` / `atomicWriteFile` (storage).
- **`app/api/files/[projectId]/research/upload/route.js`** – Regular file upload via `writeFile(projectId, ...)`; sync after upload when MinIO.
- **`app/api/compile/[projectId]/route.js`** – Sync to local before compile, sync from local after.
- **`app/api/agent/documents/generate-with-project/route.js`** – Canonical route; sync to local before reading project; metadata read/write via `readFile`/`writeFile`; sync from local after PUT completion.
- **`lib/projects-storage.js`** – Create project and rename/update metadata via `readFile`/`writeFile` (project_metadata.json, main.tex/main.md, references.bib).
- **`lib/paper-project-integration.js`** – Metadata read/write in completion flow and `updateProjectMetadataWithFiles` via `readFile`/`writeFile`.

### 5. Backend (genlatex-agent)

- **No MinIO code** in genlatex-agent for Option A. It only needs **`GENLATEX_PROJECTS_PATH`** set to the **same path** as genlatex’s `PROJECT_PATH` (shared directory). Next.js syncs MinIO ↔ that dir.

### 6. Docs and env

- **`docs/MINIO_SETUP.md`** – Full step-by-step MinIO setup, env vars, Option A/B, migration, checklist.
- **`DEPLOYMENT.md`** – Storage section points to MinIO setup.
- **`genlatex/.env.production`** – Storage section documents `PROJECT_PATH` and commented MinIO vars.
- **`genlatex-agent/.env`** – Comment added for `GENLATEX_PROJECTS_PATH` (must match genlatex’s `PROJECT_PATH` when sharing storage).

---

## What You Need to Do

### If you keep using local storage only (default)

- **Nothing.** Do not set `USE_MINIO`. `PROJECT_PATH` (genlatex) and `GENLATEX_PROJECTS_PATH` (genlatex-agent) should point to the same directory as before.

### If you switch to MinIO

1. **Run MinIO**  
   - **Binary (no Docker):** Download from https://min.io/download, set `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD`, run e.g.  
     `minio server ./minio-data --console-address ":9001"`  
   - **Docker:** See `docs/MINIO_SETUP.md` §2.

2. **Create bucket and access key**  
   - Open MinIO Console (e.g. http://localhost:9001), create bucket (e.g. `genlatex-projects`) and an access key for the app.  
   - Or rely on **auto-creation**: the app creates the bucket on first write if it doesn’t exist.

3. **genlatex `.env` (or `.env.production`)**  
   Set:
   ```env
   USE_MINIO=true
   MINIO_ENDPOINT=localhost
   MINIO_PORT=9000
   MINIO_USE_SSL=false
   MINIO_ACCESS_KEY=your_access_key
   MINIO_SECRET_KEY=your_secret_key
   MINIO_BUCKET=genlatex-projects
   ```
   Keep **`PROJECT_PATH`** set to the **same path** you use for the shared dir (e.g. `./data/projects` or `/var/lib/genlatex/data/projects`). Next.js syncs MinIO ↔ that dir for compile and agent.

4. **genlatex-agent `.env`**  
   Set only:
   ```env
   GENLATEX_PROJECTS_PATH=/same/path/as/genlatex/PROJECT_PATH
   ```
   Example: `/var/lib/genlatex/data/projects` or `./data/projects`. **No** `USE_MINIO` or `MINIO_*` in genlatex-agent for Option A.

5. **Install dependency (if not already)**  
   In `genlatex`: `npm install` (minio is in package.json).

6. **Optional: migrate existing projects**  
   If you have data under `PROJECT_PATH` and want it in MinIO, use the migration steps in `docs/MINIO_SETUP.md` §6 (walk dirs, upload to MinIO with keys `{projectId}/{relativePath}`). Then set `USE_MINIO=true` and restart.

7. **Test**  
   Create a project, edit a file, compile, run paper generation. Check MinIO Console that objects appear under the bucket (e.g. `{projectId}/main.tex`, `{projectId}/output/main.pdf`).

---

## Quick reference

| You want to…              | Do this |
|---------------------------|--------|
| Keep local storage        | Don’t set `USE_MINIO`. Use same `PROJECT_PATH` / `GENLATEX_PROJECTS_PATH` as before. |
| Use MinIO                 | Set `USE_MINIO=true` and `MINIO_*` in genlatex only; set `GENLATEX_PROJECTS_PATH` in genlatex-agent to same path as `PROJECT_PATH`. |
| Run MinIO without Docker  | Use MinIO binary; see §2 Option B in `docs/MINIO_SETUP.md`. |
| Full step-by-step MinIO   | Follow `docs/MINIO_SETUP.md`. |
