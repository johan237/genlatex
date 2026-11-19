/**
 * Import ZIP as new project
 * Validates zip format, creates project, extracts to project root, returns project
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { createProject } from '@/lib/projects-storage.js';
import { extractPaperFilesToProject } from '@/lib/paper-project-integration.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';
import path from 'path';

// ZIP magic bytes: PK.. (0x50 0x4B 0x03 0x04) or empty zip (0x50 0x4B 0x05 0x06)
function isValidZipBuffer(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const view = new Uint8Array(buffer);
  return (
    view[0] === 0x50 &&
    view[1] === 0x4B &&
    ((view[2] === 0x03 && view[3] === 0x04) || (view[2] === 0x05 && view[3] === 0x06))
  );
}

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check subscription limits
    try {
      const { canUserCreateProject } = await import('@/lib/user-subscription.js');
      const canCreate = await canUserCreateProject(session.id);
      if (!canCreate.allowed) {
        return NextResponse.json({
          error: 'Project limit reached. Upgrade to Pro for unlimited projects.',
          upgradeRequired: true
        }, { status: 403 });
      }
    } catch (err) {
      console.warn('Subscription check failed:', err.message);
    }

    const formData = await request.formData();
    const file = formData.get('zip');
    const customName = (formData.get('name') || '').trim();

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No ZIP file provided' }, { status: 400 });
    }

    const fileName = file.name || '';
    if (!fileName.toLowerCase().endsWith('.zip')) {
      return NextResponse.json({ error: 'File must be a .zip file' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'ZIP file is empty' }, { status: 400 });
    }

    if (!isValidZipBuffer(arrayBuffer)) {
      return NextResponse.json({ error: 'Invalid ZIP file format' }, { status: 400 });
    }

    const projectName = customName || path.parse(fileName).name || 'Imported Project';
    console.log(`📦 Importing ZIP as project: ${projectName}`);

    const project = await createProject(session.id, projectName, {
      type: 'document',
      metadata: {
        description: `Imported from ${fileName}`,
        editor: 'latex',
        importedFromZip: true,
        sourceZipName: fileName
      }
    });

    // MinIO: sync from object storage to local before extraction (createProject writes to MinIO)
    if (isMinio()) {
      await syncProjectToLocal(project.id).catch((err) =>
        console.warn('[import-zip] syncProjectToLocal before extraction:', err?.message)
      );
    }

    let extractionResult;
    try {
      extractionResult = await extractPaperFilesToProject(project.id, arrayBuffer);
    } catch (extractError) {
      console.error('❌ ZIP extraction failed:', extractError);
      return NextResponse.json(
        { error: `Failed to extract ZIP: ${extractError.message}` },
        { status: 500 }
      );
    }

    if (extractionResult.filesExtracted === 0) {
      console.warn('⚠️ ZIP extraction produced no files; project created with no extracted content');
    } else if (extractionResult.success === false) {
      console.warn('⚠️ ZIP extraction had warnings:', extractionResult.errors);
    } else {
      console.log(`✅ Imported ${extractionResult.filesExtracted} files to project ${project.id}`);
    }

    // Sync to MinIO if enabled (extraction writes to local filesystem)
    if (isMinio()) {
      await syncProjectFromLocal(project.id).catch(err => 
        console.warn('MinIO sync after ZIP import:', err?.message)
      );
    }

    return NextResponse.json({
      success: true,
      project: {
        id: project.id,
        name: project.name,
        created_at: project.created_at
      }
    });
  } catch (error) {
    console.error('❌ Import ZIP error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to import ZIP' },
      { status: 500 }
    );
  }
}
