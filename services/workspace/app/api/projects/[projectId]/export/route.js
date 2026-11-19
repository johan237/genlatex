import { NextResponse } from 'next/server';

/**
 * Export endpoint alias for /api/projects/:id/export.
 * Proxies to /api/files/:id/download.
 */
export async function GET(request, { params }) {
  try {
    const { projectId } = await params;
    const origin = new URL(request.url).origin;
    const port = process.env.PORT || '3000';
    const baseUrl = process.env.NODE_ENV === 'development'
      ? `http://127.0.0.1:${port}`
      : (process.env.BETTER_AUTH_URL || origin);

    const sourceUrl = new URL(request.url);
    const query = sourceUrl.search || '';
    const response = await fetch(`${baseUrl}/api/files/${projectId}/download${query}`, {
      headers: {
        'Cookie': request.headers.get('cookie') || ''
      },
      signal: request.signal
    });

    const headers = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);
    const disposition = response.headers.get('content-disposition');
    if (disposition) headers.set('content-disposition', disposition);

    return new NextResponse(response.body, {
      status: response.status,
      headers
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Export failed' },
      { status: 500 }
    );
  }
}
