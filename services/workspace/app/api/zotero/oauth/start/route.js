/**
 * Zotero OAuth – start flow. Redirects user to Zotero to authorize.
 * GET: Requires session, Pro. Creates request token, stores in DB, redirects to Zotero.
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { isUserPro } from '@/lib/user-subscription.js';
import { saveZoteroOAuthPending } from '@/lib/db.js';
import { getRequestToken, getAuthorizeUrl } from '@/lib/zotero-oauth.js';

export async function GET(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.redirect(new URL('/?zotero=unauthorized', request.url));
    }
    const isPro = await isUserPro(session.id);
    if (!isPro) {
      return NextResponse.redirect(new URL('/dashboard?zotero=pro_required', request.url));
    }

    const clientKey = process.env.ZOTERO_OAUTH_CLIENT_KEY;
    const clientSecret = process.env.ZOTERO_OAUTH_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      console.error('Zotero OAuth: ZOTERO_OAUTH_CLIENT_KEY or ZOTERO_OAUTH_CLIENT_SECRET not set');
      return NextResponse.redirect(new URL('/dashboard?zotero=config_error', request.url));
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const callbackUrl = `${baseUrl}/api/zotero/oauth/callback`;

    const { oauth_token, oauth_token_secret } = await getRequestToken(
      clientKey,
      clientSecret,
      callbackUrl
    );
    const saved = await saveZoteroOAuthPending(oauth_token, oauth_token_secret, session.id);
    if (!saved) {
      return NextResponse.redirect(new URL('/dashboard?zotero=error&message=db_save', request.url));
    }

    const authorizeUrl = getAuthorizeUrl(oauth_token);
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    console.error('Zotero OAuth start error:', error);
    const baseUrl = new URL(request.url).origin;
    return NextResponse.redirect(new URL(`/dashboard?zotero=error&message=${encodeURIComponent(error.message || '')}`, baseUrl));
  }
}
