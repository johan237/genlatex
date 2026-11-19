// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from './auth.js';
import { getProject, pool } from './db.js';

/**
 * Read session from Better Auth. Returns { id, email, name, emailVerified } or null.
 */
export async function getSessionFromRequest() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) return null;
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
      emailVerified: session.user.emailVerified ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Require authenticated user and project access. Returns either a NextResponse (401/403/404)
 * or an object { userId, project, permission: 'owner'|'edit'|'view' }.
 *
 * @param {string} projectId - Project UUID
 * @param {{ requireEdit?: boolean }} options - If requireEdit is true, returns 403 when user has only view permission
 */
export async function requireProjectAccess(projectId, options = {}) {
  const { requireEdit = false } = options;

  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  if (String(project.user_id) === String(session.id)) {
    return { userId: session.id, project, permission: 'owner' };
  }

  const shareResult = await pool.query(
    `SELECT permission FROM project_shares
     WHERE project_id = $1 AND (shared_with_user_id = $2 OR shared_with_email = $3)
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [projectId, session.id, session.email || '']
  );

  if (!shareResult.rows[0]) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const permission = shareResult.rows[0].permission; // 'view' or 'edit'
  if (requireEdit && permission === 'view') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return { userId: session.id, project, permission };
}
