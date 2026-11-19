// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import path from 'path';
import { randomUUID } from 'crypto';
import { pool, getUser } from '@/lib/db.js';
import { writeFile, fileExists as storageFileExists } from '@/lib/files.js';
import { checkStorageQuota, getUserTotalStorageUsed, STORAGE_LIMITS, formatBytes } from '@/lib/storage-limits.js';

export async function POST(req, { params }) {
  const requestId = req.headers.get('x-request-id') || randomUUID();

  try {
    const { projectId } = await params;
    const session = await getSessionFromRequest();
    if (!session?.id) {
      const res = NextResponse.json({ success: false, error: 'Unauthorized', requestId }, { status: 401 });
      res.headers.set('x-request-id', requestId);
      return res;
    }
    const userId = session.id;
    const { searchParams } = new URL(req.url);
    const targetPath = searchParams.get('target') || '';
    const formData = await req.formData();
    const files = formData.getAll('files');
    const folder = formData.get('folder') || '';

    // Security audit logging
    console.log(`[UPLOAD] User ${userId} uploading ${files.length} files to project ${projectId} [${requestId}]`);

    if (!files || files.length === 0) {
      const res = NextResponse.json({ success: false, error: 'No files provided', requestId }, { status: 400 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    // Get project info and verify ownership
    const result = await pool.query('SELECT user_id FROM projects WHERE id=$1', [projectId]);
    if (!result.rows[0]) {
      const res = NextResponse.json({ success: false, error: 'Project not found', requestId }, { status: 404 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    if (result.rows[0].user_id !== userId) {
      const res = NextResponse.json({ success: false, error: 'Forbidden', requestId }, { status: 403 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    // Determine upload directory path (relative to project root)
    let uploadDir = 'uploads';
    if (targetPath) {
      uploadDir = targetPath;
    } else if (folder) {
      uploadDir = folder;
    }

    // Validate path (no directory traversal)
    const normalizedDir = path.normalize(uploadDir).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (normalizedDir.startsWith('..') || normalizedDir.includes('../')) {
      const res = NextResponse.json({
        success: false,
        error: 'Invalid path: directory traversal detected',
        requestId
      }, { status: 400 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    const uploadedFiles = [];

    const user = await getUser(userId);
    const limits = user?.is_pro ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;
    const totalUsed = await getUserTotalStorageUsed(userId);

    for (const file of files) {
      if (file instanceof File) {
        // Check total storage across all projects
        if (totalUsed + file.size > limits.maxTotalStorage) {
          const res = NextResponse.json({
            success: false,
            error: 'total_storage_exceeded',
            message: `Total storage limit exceeded. You have ${formatBytes(limits.maxTotalStorage - totalUsed)} remaining.`,
            upgradeUrl: '/dashboard?openUpgrade=1'
          }, { status: 413 });
          res.headers.set('x-request-id', requestId);
          return res;
        }

        // Check per-project and per-file quota
        try {
          await checkStorageQuota(userId, projectId, file.size);
        } catch (quotaError) {
          const res = NextResponse.json({
            success: false,
            error: quotaError.message
          }, { status: 413 });
          res.headers.set('x-request-id', requestId);
          return res;
        }

        const fileName = file.name;

        // Build relative path within project
        let relativePath = normalizedDir ? `${normalizedDir}/${fileName}` : fileName;

        // Handle duplicate files by adding a number suffix
        let finalPath = relativePath;
        let counter = 1;
        while (await storageFileExists(projectId, finalPath)) {
          const ext = path.extname(fileName);
          const name = path.basename(fileName, ext);
          finalPath = normalizedDir ? `${normalizedDir}/${name}_${counter}${ext}` : `${name}_${counter}${ext}`;
          counter++;
        }

        // Write file directly to storage (MinIO or FS)
        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(projectId, finalPath, buffer);

        uploadedFiles.push({
          name: path.basename(finalPath),
          path: finalPath,
          size: buffer.length
        });
      }
    }

    const res = NextResponse.json({
      success: true,
      files: uploadedFiles,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
      requestId
    });
    res.headers.set('x-request-id', requestId);
    return res;

  } catch (error) {
    console.error(`❌ Error uploading files [${requestId}]:`, error);
    const res = NextResponse.json({
      success: false,
      error: 'Failed to upload files',
      requestId,
      details: error.message
    }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}
