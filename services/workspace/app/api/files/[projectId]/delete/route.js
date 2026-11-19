// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { normalizeProjectPath, resolveResearchFilePath } from '@/lib/project-path.js';
import { deleteFile, deleteFolder, listDir, fileExists as storageFileExists, getProjectPath } from '@/lib/files.js';
import { getResearchFiles, deleteResearchFile } from '@/lib/db.js';

function normalizeFsPath(filePath) {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export async function POST(req, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const { path: filePath } = await req.json();

    if (filePath == null || String(filePath).trim() === '') {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 });
    }

    const normalized = normalizeProjectPath(String(filePath).trim());
    if (!normalized) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    // Check if file/folder exists in storage
    const exists = await storageFileExists(projectId, normalized);
    if (!exists) {
      // For folders, check if any files exist under the prefix
      const entries = await listDir(projectId, normalized);
      if (entries.length === 0) {
        return NextResponse.json({ error: 'File/folder not found' }, { status: 404 });
      }
    }

    // Prevent deletion of the only .tex file in the project root (any name)
    if (normalized.toLowerCase().endsWith('.tex')) {
      const rootEntries = await listDir(projectId, '');
      const rootTex = rootEntries.filter(f => !f.isDirectory && f.name.toLowerCase().endsWith('.tex'));
      const deletingThisRootTex = rootTex.length === 1 && (rootTex[0].name === normalized || rootTex[0].name === path.basename(normalized));
      if (deletingThisRootTex) {
        return NextResponse.json({ error: 'Cannot delete the only .tex file in the project' }, { status: 400 });
      }
    }

    // Determine if this is a file or folder by checking if there are entries under it
    const subEntries = await listDir(projectId, normalized);
    const isFolder = subEntries.length > 0;

    // Collect matching research_files records for cleanup
    let researchFilesToDelete = [];
    try {
      const projectRoot = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));
      const absTarget = path.resolve(projectRoot, normalized);
      const targetNorm = normalizeFsPath(absTarget);

      const dbFiles = await getResearchFiles(projectId, { includeChunks: true });
      researchFilesToDelete = (dbFiles || []).filter((f) => {
        const storedPathRaw = f.file_path || f.filePath || '';
        if (!storedPathRaw) return false;
        const storedAbs = resolveResearchFilePath(projectRoot, storedPathRaw);
        const storedNorm = normalizeFsPath(storedAbs);
        if (isFolder) {
          return storedNorm === targetNorm || storedNorm.startsWith(targetNorm + '/');
        }
        return storedNorm === targetNorm;
      });
    } catch (dbErr) {
      console.warn('Research files delete sync failed:', dbErr?.message || dbErr);
    }

    if (isFolder) {
      // Delete folder and all contents
      await deleteFolder(projectId, normalized);
    } else {
      // Delete single file
      await deleteFile(projectId, normalized);
    }

    // Remove research_files records after successful deletion
    if (researchFilesToDelete.length > 0) {
      for (const f of researchFilesToDelete) {
        try {
          await deleteResearchFile(f.file_id);
        } catch (err) {
          console.warn('Failed to delete research file record:', err?.message || err);
        }
      }
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error deleting file/folder:', error);
    return NextResponse.json({ error: 'Failed to delete file/folder' }, { status: 500 });
  }
}
