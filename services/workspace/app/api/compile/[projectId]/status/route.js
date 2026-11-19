/**
 * Lightweight compile status: PDF exists and is up to date (no lock, no compilation).
 */

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { getProjectPath, syncProjectToLocal, isMinio } from '@/lib/files.js';
import { getCompileStatus } from '@/lib/compile-status.js';

export async function GET(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(req.url);
  const target = searchParams.get('target') || 'main.tex';

  try {
    if (isMinio()) {
      await syncProjectToLocal(projectId);
    }

    const projectDir = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));
    const { pdfExists, upToDate } = await getCompileStatus(projectDir, target);

    return NextResponse.json({ pdfExists, upToDate });
  } catch (error) {
    console.warn('Compile status error:', error.message);
    return NextResponse.json({ pdfExists: false, upToDate: false });
  }
}
