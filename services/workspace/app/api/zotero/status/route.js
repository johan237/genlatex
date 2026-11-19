/**
 * Zotero Status - Check if user has Zotero linked
 * GET: Requires session
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { getUserZotero } from '@/lib/db.js';
import { isUserPro } from '@/lib/user-subscription.js';

export async function GET() {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ linked: false, error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        {
          linked: false,
          error: 'zotero_pro_only',
          message: 'Zotero integration requires a Pro subscription',
          upgradeUrl: '/dashboard?openUpgrade=1'
        },
        { status: 403 }
      );
    }

    const zotero = await getUserZotero(session.id);

    return NextResponse.json({
      linked: !!zotero,
      zoteroUserId: zotero?.zoteroUserId || null,
      defaultCollectionKey: zotero?.defaultCollectionKey ?? null
    });
  } catch (error) {
    console.error('Zotero status error:', error);
    return NextResponse.json(
      { linked: false, error: error.message },
      { status: 500 }
    );
  }
}
