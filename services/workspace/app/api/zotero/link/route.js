/**
 * Zotero Link - Save user's Zotero API key (encrypted)
 * POST: Requires session, validates key, stores encrypted
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { upsertUserZotero } from '@/lib/db.js';
import { isUserPro } from '@/lib/user-subscription.js';
import { invalidateZoteroServerCache } from '@/lib/zotero-server-cache.js';

const ZOTERO_API = 'https://api.zotero.org';

export async function POST(request) {
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

    const { apiKey } = await request.json();

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      return NextResponse.json(
        { success: false, error: 'API key is required' },
        { status: 400 }
      );
    }

    const key = apiKey.trim();

    const response = await fetch(`${ZOTERO_API}/keys/${key}`, {
      method: 'GET',
      headers: {
        'Zotero-API-Version': '3',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired API key' },
        { status: 400 }
      );
    }

    const keyInfo = await response.json();
    const zoteroUserId = keyInfo.userID ? String(keyInfo.userID) : null;

    if (!zoteroUserId) {
      return NextResponse.json(
        { success: false, error: 'Could not retrieve user ID from API key' },
        { status: 400 }
      );
    }

    await upsertUserZotero(session.id, key, zoteroUserId);
    invalidateZoteroServerCache(session.id);

    return NextResponse.json({
      success: true,
      zoteroUserId,
      username: keyInfo.username || null
    });
  } catch (error) {
    if (error.message?.includes('ZOTERO_ENCRYPTION_KEY')) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error: Zotero encryption not configured' },
        { status: 500 }
      );
    }
    console.error('Zotero link error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to link Zotero' },
      { status: 500 }
    );
  }
}
