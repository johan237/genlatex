/**
 * Zotero API Key Validation
 * POST: Validate API key via Zotero API keys endpoint, return user ID (Pro only)
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { isUserPro } from '@/lib/user-subscription.js';

const ZOTERO_API = 'https://api.zotero.org';

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ valid: false, error: 'Unauthorized' }, { status: 401 });
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.json(
        {
          valid: false,
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
        { valid: false, error: 'API key is required' },
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
      if (response.status === 403) {
        return NextResponse.json(
          { valid: false, error: 'Invalid or expired API key' },
          { status: 200 }
        );
      }
      const errorText = await response.text();
      return NextResponse.json(
        { valid: false, error: `Zotero API error: ${response.status}` },
        { status: 200 }
      );
    }

    const keyInfo = await response.json();
    const userId = keyInfo.userID ? String(keyInfo.userID) : null;

    if (!userId) {
      return NextResponse.json(
        { valid: false, error: 'Could not retrieve user ID from API key' },
        { status: 200 }
      );
    }

    return NextResponse.json({
      valid: true,
      userId,
      username: keyInfo.username || null
    });
  } catch (error) {
    console.error('Zotero validate error:', error);
    return NextResponse.json(
      { valid: false, error: error.message || 'Validation failed' },
      { status: 500 }
    );
  }
}
