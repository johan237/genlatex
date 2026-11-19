// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';

// Helper to forward request to agent backend
async function forwardRequest(method, request, { params }) {
  try {
    const p = await params;
    let slug = Array.isArray(p?.slug) ? [...p.slug] : [];
    const agentBase = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    // Forward papers/* to documents/* so only documents API is used
    if (slug[0] === 'papers') slug[0] = 'documents';
    const targetUrl = `${agentBase}/${slug.join('/')}`;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('content-length');

    // JSON→FormData conversion for POST /api/agent/documents/generate (supports proxy or legacy clients that send JSON).
    const isGenerate = slug.length >= 2 && slug[0] === 'documents' && slug[1] === 'generate';

    let fetchInit = { method, headers };

    if (method === 'GET' || method === 'HEAD') {
      // No body
    } else if (isGenerate) {
      // Accept JSON body from frontend and convert to FormData for FastAPI
      let payload = {};
      try {
        payload = await request.json();
      } catch {
        payload = {};
      }

      const form = new FormData();
      if (payload.topic) form.append('topic', String(payload.topic));
      if (payload.description) form.append('description', String(payload.description));
      if (payload.output_dir) form.append('output_dir', String(payload.output_dir));
      if (payload.resume_from) form.append('resume_from', String(payload.resume_from));
      // Project context if provided
      if (payload.project_id) form.append('project_id', String(payload.project_id));

      // Files (optional): payload.attached_files as {name, content(Base64)}[]
      if (Array.isArray(payload.attached_files)) {
        for (const file of payload.attached_files) {
          try {
            const { name, content, type } = file || {};
            if (name && content) {
              const binary = Buffer.from(content, 'base64');
              const blob = new Blob([binary], { type: type || 'application/octet-stream' });
              form.append('attached_files', blob, name);
            }
          } catch {}
        }
      }

      fetchInit.body = form;
      // Let fetch set the correct content-type boundary
      headers.delete('content-type');
    } else {
      // Pass-through other requests
      const contentType = request.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await request.json();
        fetchInit.body = JSON.stringify(json);
      } else if (contentType.includes('multipart/form-data')) {
        const form = await request.formData();
        fetchInit.body = form;
        headers.delete('content-type');
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        fetchInit.body = text;
      } else {
        // Fallback raw body
        const arrayBuffer = await request.arrayBuffer();
        fetchInit.body = arrayBuffer;
      }
    }

    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    if (agentToken) {
      headers.set('authorization', `Bearer ${agentToken}`);
    }

    const resp = await fetch(targetUrl, fetchInit);

    // Stream through response with original status and headers
    const respHeaders = new Headers(resp.headers);

    // CORS: use request (not req) for origin so proxy works correctly
    const allowedOrigins = [
      'https://app.genlatex.com',
      'https://genlatex.com',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001'
    ];

    const origin = request.headers.get('origin');
    if (origin && allowedOrigins.includes(origin)) {
      respHeaders.set('Access-Control-Allow-Origin', origin);
      respHeaders.set('Access-Control-Allow-Credentials', 'true');
    }

    // Try to proxy as-is (JSON or binary)
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      return NextResponse.json(data, { status: resp.status, headers: respHeaders });
    } else {
      const blob = await resp.arrayBuffer();
      return new NextResponse(blob, { status: resp.status, headers: respHeaders });
    }
  } catch (e) {
    return NextResponse.json({ error: 'Proxy error', message: String(e) }, { status: 502 });
  }
}

// Handle CORS preflight requests
export async function OPTIONS(request) {
  const allowedOrigins = [
    'https://app.genlatex.com',
    'https://genlatex.com',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
  ];

  const origin = request.headers.get('origin');
  const headers = new Headers();

  if (origin && allowedOrigins.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
  }

  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
  headers.set('Access-Control-Max-Age', '86400'); // 24 hours

  return new NextResponse(null, { status: 204, headers });
}

export async function GET(request, ctx) {
  return forwardRequest('GET', request, ctx);
}

export async function POST(request, ctx) {
  return forwardRequest('POST', request, ctx);
}

export async function PUT(request, ctx) {
  return forwardRequest('PUT', request, ctx);
}

export async function DELETE(request, ctx) {
  return forwardRequest('DELETE', request, ctx);
}

export async function PATCH(request, ctx) {
  return forwardRequest('PATCH', request, ctx);
}


