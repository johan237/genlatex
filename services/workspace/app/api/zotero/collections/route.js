/**
 * Zotero Collections - List collections for linked user
 * GET: Requires session, uses stored API key. Cached server-side (2 min TTL).
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { getUserZotero } from '@/lib/db.js';
import { isUserPro } from '@/lib/user-subscription.js';
import { getCachedCollections, setCachedCollections } from '@/lib/zotero-server-cache.js';

const ZOTERO_API = 'https://api.zotero.org';

export async function GET() {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        {
          success: false,
          error: 'zotero_pro_only',
          message: 'Zotero integration requires a Pro subscription',
          upgradeUrl: '/dashboard?openUpgrade=1'
        },
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

    const cached = getCachedCollections(session.id);
    if (cached) {
      return NextResponse.json({ success: true, collections: cached });
    }

    const url = `${ZOTERO_API}/users/${zotero.zoteroUserId}/collections`;
    const response = await fetch(url, {
      headers: {
        'Zotero-API-Version': '3',
        'Authorization': `Bearer ${zotero.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: `Zotero API error: ${response.status}` },
        { status: 502 }
      );
    }

    const collections = await response.json();
    const mapped = collections.map(col => ({
      key: col.key,
      name: col.data.name,
      parent: col.data.parentCollection,
      itemCount: col.meta?.numItems ?? 0
    }));

    setCachedCollections(session.id, mapped);

    return NextResponse.json({
      success: true,
      collections: mapped
    });
  } catch (error) {
    console.error('Zotero collections error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch collections' },
      { status: 500 }
    );
  }
}
