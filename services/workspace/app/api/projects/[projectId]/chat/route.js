import { NextResponse } from 'next/server';

/**
 * Chat endpoint alias for /api/projects/:id/chat.
 * Proxies to /api/ai/chat while injecting projectId in payload.
 */
export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const body = await request.json().catch(() => ({}));
    const payload = {
      ...body,
      projectId,
      project_id: projectId
    };

    const origin = new URL(request.url).origin;
    const port = process.env.PORT || '3000';
    const baseUrl = process.env.NODE_ENV === 'development'
      ? `http://127.0.0.1:${port}`
      : (process.env.BETTER_AUTH_URL || origin);

    const response = await fetch(`${baseUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || ''
      },
      body: JSON.stringify(payload),
      signal: request.signal
    });

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const cacheControl = response.headers.get('cache-control');
    if (cacheControl) headers.set('cache-control', cacheControl);

    return new NextResponse(response.body, {
      status: response.status,
      headers
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Chat request failed' },
      { status: 500 }
    );
  }
}
