/**
 * Zotero Unlink - Remove user's Zotero connection
 * POST: Requires session, deletes stored API key
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { deleteUserZotero } from '@/lib/db.js';
import { invalidateZoteroServerCache } from '@/lib/zotero-server-cache.js';

export async function POST() {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await deleteUserZotero(session.id);
    invalidateZoteroServerCache(session.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Zotero unlink error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to unlink Zotero' },
      { status: 500 }
    );
  }
}
