// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { normalizeProjectPath, resolveResearchFilePath } from '@/lib/project-path.js';
import { renameFile, fileExists as storageFileExists, listDir, deleteFolder, getProjectPath } from '@/lib/files.js';
import { getResearchFiles, updateResearchFileRecord, deleteResearchFileChunksByParent } from '@/lib/db.js';

function normalizeFsPath(filePath) {
  const resolved = path.resolve(filePath);
  const normalized = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function toRelativePosix(projectRoot, absPath) {
  return path.relative(projectRoot, absPath).replace(/\\/g, '/');
}

function getMimeType(fileType) {
  const mimeTypes = {
    csv: 'text/csv',
    json: 'application/json',
    pdf: 'application/pdf',
    md: 'text/markdown',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    svg: 'image/svg+xml'
  };
  return mimeTypes[fileType] || 'application/octet-stream';
}

export async function POST(req, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const { oldPath, newName } = await req.json();

    if (!oldPath || !newName || typeof newName !== 'string' || !newName.trim()) {
      return NextResponse.json({ error: 'Old path and new name are required' }, { status: 400 });
    }

    const normalizedOldPath = normalizeProjectPath(oldPath);
    if (!normalizedOldPath) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    const trimmedNewName = newName.trim();
    if (!trimmedNewName) {
      return NextResponse.json({ error: 'New name is required' }, { status: 400 });
    }

    if (trimmedNewName.includes('..') || /[<>:"|?*]/.test(trimmedNewName)) {
      return NextResponse.json({ error: 'Invalid path or name' }, { status: 400 });
    }

    // Build new path
    const parentDir = path.dirname(normalizedOldPath);
    const newPath = parentDir === '.' ? trimmedNewName : `${parentDir}/${trimmedNewName}`;

    // Check if old file/folder exists
    const oldExists = await storageFileExists(projectId, normalizedOldPath);
    const oldEntries = await listDir(projectId, normalizedOldPath);
    const isFolder = oldEntries.length > 0;

    if (!oldExists && !isFolder) {
      return NextResponse.json({ error: 'File/folder not found' }, { status: 404 });
    }

    // Check if new name already exists
    const newExists = await storageFileExists(projectId, newPath);
    const newEntries = await listDir(projectId, newPath);
    if (newExists || newEntries.length > 0) {
      return NextResponse.json({ error: 'A file/folder with this name already exists' }, { status: 400 });
    }

    if (isFolder) {
      // For folders, we need to rename all files under the prefix
      // This is done by copying each file to the new path and deleting the old
      const allFiles = [];

      // Recursively collect all files under the old path
      const collectFiles = async (prefix) => {
        const entries = await listDir(projectId, prefix);
        for (const entry of entries) {
          const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isDirectory) {
            await collectFiles(entryPath);
          } else {
            allFiles.push(entryPath);
          }
        }
      };

      await collectFiles(normalizedOldPath);

      // Rename each file
      for (const filePath of allFiles) {
        const relativePath = filePath.slice(normalizedOldPath.length + 1);
        const newFilePath = `${newPath}/${relativePath}`;
        await renameFile(projectId, filePath, newFilePath);
      }

      // Delete old folder (should be empty now, but deleteFolder handles cleanup)
      await deleteFolder(projectId, normalizedOldPath);
    } else {
      // Simple file rename
      await renameFile(projectId, normalizedOldPath, newPath);
    }

    // Sync research_files metadata when renamed/moved
    try {
      const projectRoot = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));
      const oldAbsPath = path.resolve(projectRoot, normalizedOldPath);
      const newAbsPath = path.resolve(projectRoot, newPath);
      const oldAbsNorm = normalizeFsPath(oldAbsPath);

      const dbFiles = await getResearchFiles(projectId, { includeChunks: true });
      const parentsToReprocess = new Set();
      for (const f of dbFiles || []) {
        const storedPathRaw = f.file_path || f.filePath || '';
        if (!storedPathRaw) continue;

        const storedAbs = resolveResearchFilePath(projectRoot, storedPathRaw);
        const storedNorm = normalizeFsPath(storedAbs);

        let updatedPath = null;
        if (isFolder) {
          if (storedNorm === oldAbsNorm || storedNorm.startsWith(oldAbsNorm + '/')) {
            const rel = path.relative(oldAbsPath, storedAbs);
            updatedPath = path.resolve(newAbsPath, rel);
          }
        } else if (storedNorm === oldAbsNorm) {
          updatedPath = newAbsPath;
        }

        if (!updatedPath) continue;

        const newFileName = toRelativePosix(projectRoot, updatedPath);
        const newType = path.extname(updatedPath).toLowerCase().replace(/^\./, '');
        const oldType = String(f.file_type || '').toLowerCase().replace(/^\./, '');
        const typeChanged = newType && oldType && newType !== oldType;

        let metadata = f.metadata || {};
        if (typeof metadata === 'string') {
          try {
            metadata = JSON.parse(metadata);
          } catch {
            metadata = {};
          }
        }
        const isChunk = metadata?.isChunk === true || metadata?.isChunk === 'true' || metadata?.is_chunk === true || metadata?.is_chunk === 'true';
        const parentFileId = metadata?.parentFileId || metadata?.parent_file_id || null;
        const chunkIndex = metadata?.chunkIndex ?? metadata?.chunk_index ?? metadata?.chunkId ?? metadata?.chunk_id ?? null;
        const chunkSuffix = isChunk && chunkIndex ? ` (chunk ${chunkIndex})` : '';

        if (typeChanged && isChunk) {
          if (parentFileId) {
            parentsToReprocess.add(parentFileId);
          }
          continue;
        }

        const updates = {
          fileName: isChunk ? `${newFileName}${chunkSuffix}` : newFileName,
          filePath: newFileName,
        };

        if (newType) {
          updates.fileType = newType;
          updates.mimeType = getMimeType(newType);
        }

        if (isChunk) {
          updates.metadata = {
            ...metadata,
            parentFileName: newFileName,
            parentFileType: newType || metadata?.parentFileType || metadata?.parent_file_type,
            parentFilePath: newFileName
          };
        }

        if (typeChanged) {
          updates.processingStatus = 'pending';
          updates.processedAt = null;
          updates.processingError = null;
          updates.metadata = {};
          updates.keywords = [];
          updates.contentHash = null;
          parentsToReprocess.add(f.file_id);
        }

        await updateResearchFileRecord(f.file_id, updates);
      }

      for (const parentId of parentsToReprocess) {
        await deleteResearchFileChunksByParent(projectId, parentId);
      }
    } catch (dbErr) {
      console.warn('Research files rename sync failed:', dbErr?.message || dbErr);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error renaming file/folder:', error);
    return NextResponse.json({ error: 'Failed to rename file/folder' }, { status: 500 });
  }
}
