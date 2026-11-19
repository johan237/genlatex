// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { getProjectPath, isMinio, syncProjectToLocal } from '@/lib/files.js';

export async function GET(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('target') || 'main.tex';
  const pdfName = target.replace(/\.tex$/i, '.pdf');
  
  console.log(`📄 PDF request for project ${projectId}, target: ${target}`);
  
  try {
    // Get project directory
    const projectPath = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));

    // Sync from MinIO to local if enabled (PDF was synced there after compilation)
    if (isMinio()) {
      await syncProjectToLocal(projectId);
    }

    const buildPdfPath = path.join(projectPath, 'build', pdfName);
    const rootPdfPath = path.join(projectPath, pdfName);
    let pdfPath = buildPdfPath;
    try {
      await fs.access(buildPdfPath);
    } catch {
      pdfPath = rootPdfPath;
    }
    
    // Stat PDF (404 if missing). DO NOT auto-compile; use /api/compile for that.
    let stat;
    try {
      stat = await fs.stat(pdfPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`📄 PDF not found: ${pdfPath}`);
        return new NextResponse('PDF not found. Please compile the document first.', { status: 404 });
      }
      throw err;
    }

    const etag = `W/"${stat.mtime.getTime()}-${stat.size}"`;
    const ifNoneMatch = req.headers.get('If-None-Match') || '';
    const normalize = (s) => (s || '').replace(/^W\//i, '').replace(/^"|"$/g, '').trim();
    const ourNorm = normalize(etag);
    const match = ifNoneMatch.split(',').some((v) => normalize(v) === ourNorm);
    if (match) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'Cache-Control': 'private, max-age=0, must-revalidate',
          'ETag': etag
        }
      });
    }

    console.log(`📄 Serving PDF: ${pdfPath}`);
    const pdfBuffer = await fs.readFile(pdfPath);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBuffer.length),
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'ETag': etag,
        'Content-Disposition': `inline; filename="${pdfName}"`
      }
    });
  } catch (error) {
    console.error(`❌ PDF serving error: ${error.message}`);
    return new NextResponse(`PDF serving error: ${error.message}`, { status: 500 });
  }
}
