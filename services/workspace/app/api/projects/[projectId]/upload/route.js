import { NextResponse } from 'next/server';

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const origin = new URL(request.url).origin;
    const port = process.env.PORT || '3000';
    const baseUrl = process.env.NODE_ENV === 'development'
      ? `http://127.0.0.1:${port}`
      : (process.env.BETTER_AUTH_URL || origin);

    const formData = await request.formData();
    const tag = String(formData.get('tag') || '').trim();
    const folder = formData.get('folder') || 'uploads';
    if (!formData.has('folder')) {
      formData.append('folder', folder);
    }

    const response = await fetch(`${baseUrl}/api/files/${projectId}/upload`, {
      method: 'POST',
      headers: {
        'Cookie': request.headers.get('cookie') || ''
      },
      body: formData,
      signal: request.signal
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const payloadText = await response.text();
    let payloadData = null;
    if (contentType.includes('application/json')) {
      try {
        payloadData = JSON.parse(payloadText);
      } catch {
        payloadData = null;
      }
    }

    if (response.ok && tag && payloadData?.success && Array.isArray(payloadData.files) && payloadData.files.length > 0) {
      const taggedPaths = payloadData.files
        .map((file) => String(file?.path || '').trim())
        .filter(Boolean);
      if (taggedPaths.length > 0) {
        await fetch(`${baseUrl}/api/projects/${projectId}/tag`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || ''
          },
          body: JSON.stringify({ tag, files: taggedPaths }),
          signal: request.signal
        }).catch(() => null);
        payloadData.tag = tag;
      }
    }

    const payload = payloadData ? JSON.stringify(payloadData) : payloadText;
    return new NextResponse(payload, {
      status: response.status,
      headers: { 'content-type': contentType }
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || 'Upload failed' }, { status: 500 });
  }
}
