/**
 * Zotero OAuth – callback. Zotero redirects here with oauth_token and oauth_verifier.
 * Exchanges for API key, links user, redirects to /zotero-connected.
 */

import { NextResponse } from 'next/server';
import { consumeZoteroOAuthPending, upsertUserZotero } from '@/lib/db.js';
import { getAccessToken } from '@/lib/zotero-oauth.js';
import { invalidateZoteroServerCache } from '@/lib/zotero-server-cache.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const oauth_token = searchParams.get('oauth_token');
  const oauth_verifier = searchParams.get('oauth_verifier');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const doneUrl = `${baseUrl}/zotero-connected`;

  if (!oauth_token || !oauth_verifier) {
    return NextResponse.redirect(`${doneUrl}?success=0&error=missing_params`);
  }

  try {
    const pending = await consumeZoteroOAuthPending(oauth_token);
    if (!pending) {
      return NextResponse.redirect(`${doneUrl}?success=0&error=expired_or_invalid`);
    }

    const clientKey = process.env.ZOTERO_OAUTH_CLIENT_KEY;
    const clientSecret = process.env.ZOTERO_OAUTH_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      return NextResponse.redirect(`${doneUrl}?success=0&error=config`);
    }

    const { apiKey, userID } = await getAccessToken(
      clientKey,
      clientSecret,
      oauth_token,
      pending.requestTokenSecret,
      oauth_verifier
    );
    if (!apiKey) {
      return NextResponse.redirect(`${doneUrl}?success=0&error=no_key`);
    }

    await upsertUserZotero(pending.userId, apiKey, userID || '');
    invalidateZoteroServerCache(pending.userId);

    return NextResponse.redirect(`${doneUrl}?success=1`);
  } catch (error) {
    console.error('Zotero OAuth callback error:', error);
    return NextResponse.redirect(`${doneUrl}?success=0&error=exchange`);
  }
}
