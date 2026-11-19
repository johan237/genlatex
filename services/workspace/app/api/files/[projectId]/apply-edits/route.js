// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { normalizeProjectPath, resolveResearchFilePath } from '@/lib/project-path.js';
import { readFile, writeFile, getProjectPath } from '@/lib/files.js';
import { getResearchFiles, updateResearchFileMetadata } from '@/lib/db.js';

function hashContent(content) {
  return createHash('sha256').update(content || '', 'utf8').digest('hex');
}

export async function POST(req, { params }) {
  const requestId = req.headers.get('x-request-id') || randomUUID();

  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const body = await req.json();
    const edits = Array.isArray(body?.edits) ? body.edits : [];
    if (edits.length === 0) {
      const res = NextResponse.json({ success: false, error: 'No edits provided', requestId }, { status: 400 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    const versions = {};

    for (const edit of edits) {
      const filePathRel = edit.filePath || '';

      const normalized = normalizeProjectPath(filePathRel);
      if (!normalized) {
        return NextResponse.json({ success: false, error: 'Invalid file path' }, { status: 400 });
      }

      // Read current content from storage (MinIO or FS)
      let content = '';
      const data = await readFile(projectId, normalized, { encoding: 'utf8' });
      if (data !== null) {
        content = typeof data === 'string' ? data : data.toString('utf8');
      }

      const currentVersion = hashContent(content);
      const expectedVersion = edit.expectedVersion || body.expectedVersions?.[filePathRel];

      // Version conflict check (skip if no expectedVersion - force write from AI)
      if (expectedVersion && expectedVersion !== currentVersion) {
        const res = NextResponse.json({
          success: false,
          error: 'Conflict',
          message: 'File has changed on the server. Reload and try again.',
          file: normalized,
          currentVersion,
          requestId
        }, { status: 409 });
        res.headers.set('x-request-id', requestId);
        return res;
      }

      // Apply patches sorted by start ascending; ensure non-overlapping or apply sequentially
      const patches = Array.isArray(edit.patches) ? edit.patches.slice() : [];
      patches.sort((a, b) => a.start - b.start);

      // Validate ranges
      for (const p of patches) {
        if (typeof p.start !== 'number' || typeof p.end !== 'number' || p.start < 0 || p.end < p.start) {
          return NextResponse.json({ success: false, error: 'Invalid patch ranges' }, { status: 400 });
        }
      }

      // Apply sequentially with offset tracking
      let offset = 0;
      let result = content;
      for (let i = 0; i < patches.length; i++) {
        const p = patches[i];
        const s = p.start + offset;
        const e = p.end + offset;
        if (s > result.length || e > result.length) {
          const res = NextResponse.json({
            success: false,
            error: 'Patch out of bounds',
            details: `Patch at index ${i} exceeds file length (file: ${result.length}, patch end: ${e})`,
            file: normalized,
            requestId
          }, { status: 400 });
          res.headers.set('x-request-id', requestId);
          return res;
        }
        result = result.slice(0, s) + (p.newText ?? '') + result.slice(e);
        offset += (p.newText?.length || 0) - (e - s);
      }

      // Write result directly to storage (MinIO or FS)
      await writeFile(projectId, normalized, result);
      versions[normalized] = hashContent(result);
    }

    // Mark research files that were edited for re-processing
    try {
      const projectRoot = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));
      const normalizeFsPath = (p) => {
        const resolved = path.resolve(p);
        const n = resolved.replace(/\\/g, '/');
        return process.platform === 'win32' ? n.toLowerCase() : n;
      };
      const dbFiles = await getResearchFiles(projectId);
      for (const editedPath of Object.keys(versions)) {
        const absEdited = path.resolve(projectRoot, editedPath);
        const editedNorm = normalizeFsPath(absEdited);
        for (const row of dbFiles || []) {
          const storedPath = row.file_path || row.filePath || '';
          if (!storedPath) continue;
          const absStored = resolveResearchFilePath(projectRoot, storedPath);
          if (normalizeFsPath(absStored) === editedNorm) {
            await updateResearchFileMetadata(row.file_id, { contentHash: null, processingStatus: 'pending' });
            break;
          }
        }
      }
    } catch (err) {
      console.warn('Research files re-process sync failed:', err?.message || err);
    }

    const res = NextResponse.json({ success: true, versions, requestId });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (e) {
    console.error(`❌ Failed to apply edits [${requestId}]:`, e);
    const res = NextResponse.json({
      success: false,
      error: 'Failed to apply edits',
      requestId
    }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}
