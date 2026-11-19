/**
 * Zotero library/collection for the current project (per-project, not global default).
 * GET: return project's saved collectionKey (or null = My Library).
 * PATCH: body { collectionKey } – set this project's library/collection.
 */

import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { readFile, writeFile } from '@/lib/files.js';
import { getUserZotero } from '@/lib/db.js';
import { isUserPro } from '@/lib/user-subscription.js';

export async function GET(_request, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const isPro = await isUserPro(access.userId);
    if (!isPro) {
      return NextResponse.json(
        { error: 'zotero_pro_only', message: 'Zotero integration requires a Pro subscription' },
        { status: 403 }
      );
    }

    let collectionKey = null;
    try {
      const content = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
      if (content) {
        const metadata = JSON.parse(typeof content === 'string' ? content : content.toString('utf8'));
        collectionKey = metadata?.zoteroIntegration?.collectionKey ?? null;
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    return NextResponse.json({ collectionKey });
  } catch (e) {
    console.error('GET project zotero-collection error:', e);
    return NextResponse.json(
      { error: e.message || 'Failed to load project library' },
      { status: 500 }
    );
  }
}

export async function PATCH(request, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const isPro = await isUserPro(access.userId);
    if (!isPro) {
      return NextResponse.json(
        { success: false, error: 'zotero_pro_only', message: 'Zotero integration requires a Pro subscription' },
        { status: 403 }
      );
    }

    const userZotero = await getUserZotero(access.userId);
    if (!userZotero) {
      return NextResponse.json(
        { success: false, error: 'Zotero not linked. Connect your Zotero account first.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const collectionKey =
      body.collectionKey === '' || body.collectionKey === null || body.collectionKey === undefined
        ? null
        : String(body.collectionKey).trim() || null;

    let metadata = {};
    try {
      const content = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
      if (content) metadata = JSON.parse(typeof content === 'string' ? content : content.toString('utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }

    metadata.zoteroIntegration = {
      libraryId: userZotero.zoteroUserId,
      libraryType: 'user',
      collectionKey,
      configuredAt: new Date().toISOString()
    };
    await writeFile(projectId, 'project_metadata.json', JSON.stringify(metadata, null, 2));

    return NextResponse.json({ success: true, collectionKey });
  } catch (e) {
    console.error('PATCH project zotero-collection error:', e);
    return NextResponse.json(
      { success: false, error: e.message || 'Failed to save project library' },
      { status: 500 }
    );
  }
}
