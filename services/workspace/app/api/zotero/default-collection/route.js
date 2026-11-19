/**
 * Zotero default collection – set user's default library/collection
 * PATCH: body { collectionKey: string | null } – null or '' = My Library
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { updateUserZoteroDefaultCollection, getUserZotero } from '@/lib/db.js';
import { isUserPro } from '@/lib/user-subscription.js';

export async function PATCH(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        { success: false, error: 'zotero_pro_only', message: 'Zotero requires a Pro subscription' },
        { status: 403 }
      );
    }
    const zotero = await getUserZotero(session.id);
    if (!zotero) {
      return NextResponse.json(
        { success: false, error: 'Zotero not linked. Connect your Zotero account first.' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const collectionKey = body.collectionKey === '' || body.collectionKey === null || body.collectionKey === undefined
      ? null
      : String(body.collectionKey).trim() || null;

    await updateUserZoteroDefaultCollection(session.id, collectionKey);

    return NextResponse.json({
      success: true,
      defaultCollectionKey: collectionKey
    });
  } catch (error) {
    console.error('Zotero default collection error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save default collection' },
      { status: 500 }
    );
  }
}
