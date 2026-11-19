/**
 * Proxy to genlatex-agent /tools/{toolId} for marketing site tools.
 * No auth; rate limiting is on the agent. CORS may be set if website is on different origin.
 */

import { NextResponse } from 'next/server';

const ALLOWED_TOOL_IDS = new Set([
  'abstract-generator',
  'thesis-statement-generator',
  'equation-to-latex',
  'doi-to-bibtex',
  'table-to-latex',
  'pdf-equation-extractor',
  'word-to-latex',
  'arxiv-to-latex',
]);

export async function POST(request, { params }) {
  try {
    const { toolId } = await params;
    if (!toolId || !ALLOWED_TOOL_IDS.has(toolId)) {
      return NextResponse.json(
        { error: 'invalid_tool', message: 'Unknown or disallowed tool ID' },
        { status: 400 }
      );
    }

    const agentUrl = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    const url = `${agentUrl}/tools/${toolId}`;

    const contentType = request.headers.get('content-type') || '';
    const isMultipart = contentType.includes('multipart/form-data');

    let body;
    let headers = {};

    if (isMultipart) {
      body = await request.arrayBuffer();
      headers['Content-Type'] = contentType;
    } else {
      try {
        body = await request.json();
      } catch {
        return NextResponse.json(
          { error: 'invalid_body', message: 'Request body must be JSON' },
          { status: 400 }
        );
      }
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json().catch(() => ({}));

    // In development, reflect the request Origin so tools work from any URL (localhost, 192.168.x.x, etc.)
    const requestOrigin = request.headers.get('origin') || '';
    const corsOrigin = process.env.NODE_ENV === 'development' && requestOrigin
      ? requestOrigin
      : (process.env.TOOLS_CORS_ORIGIN || process.env.MARKETING_SITE_ORIGIN || '');
    const responseHeaders = {};
    if (corsOrigin) {
      responseHeaders['Access-Control-Allow-Origin'] = corsOrigin;
      responseHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          error: data.error || 'tool_failed',
          message: data.message || data.detail || res.statusText,
        },
        { status: res.status, headers: responseHeaders }
      );
    }

    return NextResponse.json(data, { headers: responseHeaders });
  } catch (err) {
    console.error('[api/tools] proxy error:', err);
    const requestOrigin = request.headers.get('origin') || '';
    const corsOrigin = process.env.NODE_ENV === 'development' && requestOrigin
      ? requestOrigin
      : (process.env.TOOLS_CORS_ORIGIN || process.env.MARKETING_SITE_ORIGIN || '');
    const responseHeaders = corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {};
    return NextResponse.json(
      {
        error: 'proxy_error',
        message: err?.message || 'Failed to reach tools service',
      },
      { status: 502, headers: responseHeaders }
    );
  }
}

export async function OPTIONS(request) {
  const requestOrigin = request.headers.get('origin') || '';
  const corsOrigin = process.env.NODE_ENV === 'development' && requestOrigin
    ? requestOrigin
    : (process.env.TOOLS_CORS_ORIGIN || process.env.MARKETING_SITE_ORIGIN || '*');
  const headers = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
  return new NextResponse(null, { status: 204, headers });
}
