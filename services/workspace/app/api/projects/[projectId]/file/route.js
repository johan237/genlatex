import { NextResponse } from 'next/server';

async function proxyRequest(request, projectId, init = {}) {
  const origin = new URL(request.url).origin;
  const port = process.env.PORT || '3000';
  const baseUrl = process.env.NODE_ENV === 'development'
    ? `http://127.0.0.1:${port}`
    : (process.env.BETTER_AUTH_URL || origin);

  const response = await fetch(`${baseUrl}/api/files/${projectId}${init.query || ''}`, {
    method: init.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': request.headers.get('cookie') || ''
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: request.signal
  });

  const contentType = response.headers.get('content-type') || 'application/json';
  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: { 'content-type': contentType }
  });
}

export async function GET(request, { params }) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const requestedPath = url.searchParams.get('path') || url.searchParams.get('file') || 'main.tex';
    const query = `?file=${encodeURIComponent(requestedPath)}`;
    return await proxyRequest(request, projectId, { method: 'GET', query });
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to read file' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const payload = {
      file: body.path || body.file || 'main.tex',
      content: body.content ?? '',
      contentEncoding: body.contentEncoding || null,
      expectedVersion: body.expectedVersion || null
    };
    return await proxyRequest(request, projectId, { method: 'POST', body: payload });
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Failed to write file' }, { status: 500 });
  }
}
