# MinIO Production Audit

Deep audit of MinIO integration across genlatex and genlatex-agent. Last updated: 2025-02-03.

## Principle: USE_MINIO=true → MinIO is single source of truth

When `USE_MINIO=true`, all file reads/writes go through storage (MinIO). Local is only used as temp for operations that require a real filesystem (compile, git, agent). After such ops, sync back to MinIO.

## Summary

| Area | Status | Notes |
|------|--------|-------|
| File content API | ✅ | readFile/writeFile → MinIO directly |
| Apply-edits | ✅ | readFile/writeFile → MinIO directly |
| Chat (metadata) | ✅ | readFile for project_metadata.json |
| add-citation | ✅ | readFile/writeFile for references.bib |
| make-paper | ✅ | writeFile for main.tex, references.bib |
| zotero-collection | ✅ | readFile/writeFile for project_metadata.json |
| Plagiarism | ✅ | readFile for main.tex |
| Compile | ✅ | sync before (local temp), sync after |
| Git | ✅ | sync before, sync after |
| Research upload | ✅ | writeFile → MinIO; ZIP → local then sync |
| documents/generate-with-project | ✅ | sync before; inject after sync |
| Chat stream | ✅ | syncProjectFromLocal unless X-Agent-Synced-MinIO |

---

## Frontend (genlatex)

### Storage Layer
- **lib/storage/index.js**: Chooses FS or MinIO based on `USE_MINIO` env.
- **lib/storage/storage-minio.js**: Object keys `{projectId}/{relativePath}`. Same bucket as agent.
- **lib/storage/storage-fs.js**: Local PROJECT_PATH.

### Routes with MinIO sync

| Route | syncProjectToLocal | syncProjectFromLocal |
|-------|--------------------|----------------------|
| compile/[projectId] | ✅ Before compile | ✅ After compile |
| ai/chat | ✅ Before chat | ✅ After (stream end) |
| agent/documents/generate-with-project | ✅ Before | ✅ After completion |
| pdf/[projectId] | ✅ Before | - |
| synctex/[projectId] | ✅ Before | - |
| projects/[projectId]/files/diagnostic | ✅ Before | - |
| projects/[projectId]/zotero-collection | ✅ Before | ✅ After |
| git/control | ✅ Before | ✅ After (POST) |
| figures/generate | ✅ Before | ✅ After |
| export/formats | ✅ Before | ✅ After |
| latex/lint | ✅ Before | ✅ After |
| bibliography/advanced | ✅ Before | ✅ After |
| bibtex/manage | ✅ Before | ✅ After |
| search/semantic | ✅ Before | - |
| projects/route (POST create) | ✅ Before | ✅ After |
| import-zip | ✅ Before extraction | ✅ After |
| research/upload | - | ✅ After |
| research/[fileId] DELETE | - | ✅ After |
| genlatex-agent/add-citation | - | ✅ After |
| genlatex-agent/make-paper | - | ✅ After |
| projects/[projectId]/ai-status | - | ✅ After |

### Libs using storage (MinIO-safe)
- **lib/files.js**: readFile, writeFile, etc. delegate to storage.
- **lib/plagiarism-detector.js**: ✅ Uses readFile(projectId, 'main.tex') – works with MinIO.

### Libs using getProjectPath + fs (need sync)
- **lib/git-integration.js**: Uses fs + exec. Git needs real filesystem. ✅ Fixed: git/control route syncs before/after.
- **lib/plagiarism-detector.js**: ✅ Fixed: now uses readFile.
- **lib/paper-project-integration.js**: createProjectFromPaper ✅ uses writeFile for metadata. extractPaperFilesToProject uses fs (needs sync before – import-zip does sync).

---

## Backend (genlatex-agent)

### MinIO config
- **utils/minio_storage.py**: `is_minio_enabled()`, `resolve_project_path()`, `sync_project_from_minio()`, `sync_project_to_minio()`.
- Env: `USE_MINIO`, `MINIO_ENDPOINT` (or `MINIO_HOST`), `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `GENLATEX_PROJECTS_TEMP_PATH`.

### Endpoints using MinIO

| Endpoint | MinIO handling |
|----------|----------------|
| Chat (stream) | resolve_project_path |
| documents/generate | Uses paths from request; frontend syncs MinIO ↔ local, backend uses shared PROJECT_PATH or temp when needed. |

### Path extraction
- Handles Unix: `/app/data/projects/projectId/file.csv`
- Handles Windows: `C:\app\data\projects\projectId\file.csv` (normalized to `/`).
- Fallback: `os.path.basename(file_path)` when projectId not in path.

---

## Environment Variables

### Frontend (genlatex/.env)
```
USE_MINIO=true
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=genlatex-projects
PROJECT_PATH=./data/projects
```

### Backend (genlatex-agent/.env) – Option B
```
USE_MINIO=true
MINIO_ENDPOINT=...
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...
MINIO_BUCKET=genlatex-projects
GENLATEX_PROJECTS_TEMP_PATH=/tmp/genlatex-projects
```

---

## Known Limitations

1. **documents/generate** (agent): Does not use `resolve_project_path`. For Option B (different hosts), the agent creates a local project dir. Research files are passed in the request body with metadata (extracted_content). FileTools prefers extracted_content; disk read only when missing. For most files (PDF, CSV with extraction), this works. For text files without extraction, generate-with-project injects content before sending.

2. **compute-file-hashes** (agent): Not used by frontend. Would need projectId + path resolution if used with MinIO.

3. **FileModifier** (lib): Uses fs.writeFile with getProjectPath. Not imported from API routes; low risk.
