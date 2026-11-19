/**
 * Zotero OAuth 1.0a – request token and access token exchange.
 * See https://www.zotero.org/support/dev/web_api/v3/oauth
 */

import crypto from 'crypto';

const REQUEST_URL = 'https://www.zotero.org/oauth/request';
const ACCESS_URL = 'https://www.zotero.org/oauth/access';
const AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize';

function rfc3986(str) {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function buildSignatureBaseString(method, url, params) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
    .join('&');
  return `${method}&${rfc3986(url)}&${rfc3986(sorted)}`;
}

function sign(baseString, signingKey) {
  const hmac = crypto.createHmac('sha1', signingKey);
  hmac.update(baseString);
  return hmac.digest('base64');
}

/**
 * Step 1: Get a request token from Zotero. Returns { oauth_token, oauth_token_secret }.
 */
export async function getRequestToken(clientKey, clientSecret, callbackUrl) {
  const oauth_nonce = crypto.randomBytes(16).toString('hex');
  const oauth_timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    oauth_callback: callbackUrl,
    oauth_consumer_key: clientKey,
    oauth_nonce: oauth_nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauth_timestamp,
    oauth_version: '1.0',
  };
  const baseString = buildSignatureBaseString('POST', REQUEST_URL, params);
  const signingKey = `${rfc3986(clientSecret)}&`;
  const oauth_signature = sign(baseString, signingKey);
  params.oauth_signature = oauth_signature;

  const body = Object.keys(params)
    .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
    .join('&');

  const res = await fetch(REQUEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero request token failed: ${res.status} ${text}`);
  }
  const parsed = new URLSearchParams(text);
  const oauth_token = parsed.get('oauth_token');
  const oauth_token_secret = parsed.get('oauth_token_secret');
  if (!oauth_token || !oauth_token_secret) {
    throw new Error('Zotero did not return oauth_token or oauth_token_secret');
  }
  return { oauth_token, oauth_token_secret };
}

/**
 * Build the URL to send the user to for authorization.
 */
export function getAuthorizeUrl(oauthToken) {
  return `${AUTHORIZE_URL}?oauth_token=${encodeURIComponent(oauthToken)}`;
}

/**
 * Step 2: Exchange request token + verifier for access token (API key). Returns { oauth_token (API key), userID }.
 */
export async function getAccessToken(
  clientKey,
  clientSecret,
  oauthToken,
  oauthTokenSecret,
  oauthVerifier
) {
  const oauth_nonce = crypto.randomBytes(16).toString('hex');
  const oauth_timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    oauth_consumer_key: clientKey,
    oauth_nonce: oauth_nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: oauth_timestamp,
    oauth_token: oauthToken,
    oauth_verifier: oauthVerifier,
    oauth_version: '1.0',
  };
  const baseString = buildSignatureBaseString('POST', ACCESS_URL, params);
  const signingKey = `${rfc3986(clientSecret)}&${rfc3986(oauthTokenSecret)}`;
  const oauth_signature = sign(baseString, signingKey);
  params.oauth_signature = oauth_signature;

  const body = Object.keys(params)
    .map((k) => `${rfc3986(k)}=${rfc3986(String(params[k]))}`)
    .join('&');

  const res = await fetch(ACCESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero access token failed: ${res.status} ${text}`);
  }
  const parsed = new URLSearchParams(text);
  const accessToken = parsed.get('oauth_token');
  const userID = parsed.get('userID');
  if (!accessToken) {
    throw new Error('Zotero did not return access token');
  }
  return { apiKey: accessToken, userID: userID || null };
}
