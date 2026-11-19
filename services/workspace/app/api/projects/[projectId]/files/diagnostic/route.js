/**
 * Diagnostic API endpoint for file visibility debugging - INTERNAL DEBUG ENDPOINT
 * Feature 3: Main.tex File Visibility Fix
 * 
 * PROTECTED: Requires INTERNAL_API_KEY header or query param
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireInternalApiKey } from '@/lib/internal-api-auth.js';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { getProjectPath, isMinio, syncProjectToLocal, readFile } from '@/lib/files.js';
import { parseProjectMetadata } from '@/lib/json-recovery.js';

export async function GET(request, { params }) {
  // Require internal API key first
  const authError = await requireInternalApiKey(request);
  if (authError) return authError;

  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DIAGNOSTIC] Running diagnostics for project: ${projectId}`);
    }

    const projectPath = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));

    // Sync from MinIO to local if enabled (diagnostic needs to read local files)
    if (isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }

    const isDev = process.env.NODE_ENV === 'development';

    // Check project exists
    let projectExists = false;
    try {
      await fs.access(projectPath);
      projectExists = true;
      if (isDev) console.log('[DIAGNOSTIC] ✅ Project directory exists');
    } catch {
      projectExists = false;
      if (isDev) console.log('[DIAGNOSTIC] ❌ Project directory does NOT exist');
    }

    if (!projectExists) {
      return NextResponse.json({
        projectPath,
        projectExists: false,
        error: 'Project directory not found'
      });
    }

    // List all files recursively
    const allFiles = [];
    async function walkDir(dir, relativePath = '') {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.join(relativePath, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectories
          await walkDir(fullPath, relPath);
        } else {
          // Add file info
          const stats = await fs.stat(fullPath);
          allFiles.push({
            name: entry.name,
            path: relPath,
            size: stats.size,
            exists: true,
            modified: stats.mtime
          });
        }
      }
    }

    await walkDir(projectPath);

    if (isDev) console.log(`[DIAGNOSTIC] Found ${allFiles.length} files`);

    // Check main.tex specifically
    const mainTexPath = path.join(projectPath, 'main.tex');
    let mainTexExists = false;
    let mainTexSize = 0;
    let mainTexModified = null;

    try {
      const stats = await fs.stat(mainTexPath);
      mainTexExists = true;
      mainTexSize = stats.size;
      mainTexModified = stats.mtime;
      if (isDev) console.log(`[DIAGNOSTIC] ✅ main.tex exists: ${mainTexSize} bytes`);
    } catch {
      mainTexExists = false;
      if (isDev) console.log('[DIAGNOSTIC] ❌ main.tex does NOT exist');
    }

    // Check permissions
    let canRead = false;
    let canWrite = false;

    try {
      await fs.access(projectPath, fs.constants.R_OK);
      canRead = true;
    } catch {}

    try {
      await fs.access(projectPath, fs.constants.W_OK);
      canWrite = true;
    } catch {}

    if (isDev) console.log(`[DIAGNOSTIC] Permissions - Read: ${canRead}, Write: ${canWrite}`);

    // Check project metadata (use storage layer for MinIO)
    let metadataExists = false;
    let metadata = null;

    try {
      const metadataContent = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
      const str = metadataContent != null
        ? (typeof metadataContent === 'string' ? metadataContent : (Buffer.isBuffer(metadataContent) ? metadataContent.toString('utf8') : String(metadataContent)))
        : null;
      if (str) {
        metadata = parseProjectMetadata(str, `project ${projectId}/project_metadata.json`);
        metadataExists = Object.keys(metadata).length > 0;
        if (isDev) console.log('[DIAGNOSTIC] ✅ Project metadata found');
      }
    } catch (error) {
      if (isDev) console.log('[DIAGNOSTIC] ⚠️  No project metadata:', error.message);
    }

    return NextResponse.json({
      projectPath,
      projectId,
      projectExists: true,
      totalFiles: allFiles.length,
      files: allFiles,
      mainTexExists,
      mainTexSize,
      mainTexModified,
      permissions: {
        read: canRead,
        write: canWrite
      },
      metadataExists,
      aiGeneration: metadata?.aiGeneration || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[DIAGNOSTIC] Error:', error);
    }
    return NextResponse.json({
      error: error.message,
      // Only include stack trace in development
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    }, { status: 500 });
  }
}
