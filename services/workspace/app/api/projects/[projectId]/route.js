// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { deleteProject, updateProjectName } from '@/lib/projects-storage.js';
import { deleteProjectFiles } from '@/lib/files.js';

export async function DELETE(_request, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;
    if (access.permission !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    await deleteProject(access.userId, projectId);
    await deleteProjectFiles(access.userId, projectId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('❌ Delete project error:', e);
    return new NextResponse('Error deleting project', { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;
    if (access.permission !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();
    const { name } = body || {};
    const updated = await updateProjectName(access.userId, projectId, name);
    return NextResponse.json({ success: true, project: updated });
  } catch (e) {
    console.error('❌ Update project name error:', e);
    if (e?.message === 'Project not found') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return new NextResponse('Error updating project', { status: 500 });
  }
}
