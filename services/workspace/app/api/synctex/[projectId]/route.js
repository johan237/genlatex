// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { getProjectPath, isMinio, syncProjectToLocal } from '@/lib/files.js';

export async function GET(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if (access instanceof NextResponse) return access;
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('target') || 'main.tex';
  const synctexName = target.replace('.tex', '.synctex.gz');
  const synctexUncompressed = target.replace('.tex', '.synctex');

  console.log(`📍 SyncTeX request for project ${projectId}, target: ${target}`);

  try {
    // Get project directory
    const projectPath = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));
    const buildSynctexPathGz = path.join(projectPath, 'build', synctexName);
    const buildSynctexPath = path.join(projectPath, 'build', synctexUncompressed);
    const rootSynctexPathGz = path.join(projectPath, synctexName);
    const rootSynctexPath = path.join(projectPath, synctexUncompressed);

    // Sync from MinIO to local if enabled (synctex was synced there after compilation)
    if (isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }

    let synctexData;

    // Prefer build/ output first, then root fallback for backward compatibility
    if (fs.existsSync(buildSynctexPathGz)) {
      console.log(`📍 Reading compressed SyncTeX: ${buildSynctexPathGz}`);
      const compressedData = fs.readFileSync(buildSynctexPathGz);
      synctexData = zlib.gunzipSync(compressedData).toString('utf8');
    }
    else if (fs.existsSync(buildSynctexPath)) {
      console.log(`📍 Reading uncompressed SyncTeX: ${buildSynctexPath}`);
      synctexData = fs.readFileSync(buildSynctexPath, 'utf8');
    }
    else if (fs.existsSync(rootSynctexPathGz)) {
      console.log(`📍 Reading compressed SyncTeX: ${rootSynctexPathGz}`);
      const compressedData = fs.readFileSync(rootSynctexPathGz);
      synctexData = zlib.gunzipSync(compressedData).toString('utf8');
    }
    else if (fs.existsSync(rootSynctexPath)) {
      console.log(`📍 Reading uncompressed SyncTeX: ${rootSynctexPath}`);
      synctexData = fs.readFileSync(rootSynctexPath, 'utf8');
    }
    // SyncTeX file not found
    else {
      console.error(`❌ SyncTeX file not found for ${target}`);
      return NextResponse.json({
        ok: false,
        error: 'SyncTeX file not found. Make sure the document has been compiled.'
      }, { status: 404 });
    }

    console.log(`✅ SyncTeX data loaded successfully (${synctexData.length} bytes)`);

    // Return parsed SyncTeX data as JSON
    return NextResponse.json({
      ok: true,
      data: synctexData
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      }
    });

  } catch (error) {
    console.error(`❌ SyncTeX serving error: ${error.message}`);
    return NextResponse.json({
      ok: false,
      error: `SyncTeX serving error: ${error.message}`
    }, { status: 500 });
  }
}
