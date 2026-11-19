/**
 * API proxy for downloading all document files as ZIP.
 * Forwards to Python backend GET /documents/{documentId}/download-all.
 */

import { NextResponse } from 'next/server';

const PYTHON_API_BASE = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const AGENT_API_KEY = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const { documentId } = await params;
    const headers = {};
    if (AGENT_API_KEY) {
      headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
    }
    const response = await fetch(`${PYTHON_API_BASE}/documents/${documentId}/download-all`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Python API error:', errorText);
      const isUnavailable = response.status === 502 || response.status === 503;
      const errorMessage = isUnavailable
        ? 'Document generation service is temporarily unavailable. Please try again shortly.'
        : 'Failed to download files';
      return NextResponse.json(
        { error: errorMessage, details: errorText },
        { status: response.status }
      );
    }

    const fileContent = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/zip';
    const contentDisposition = response.headers.get('content-disposition') || `attachment; filename="document_${documentId}_all_files.zip"`;

    return new NextResponse(fileContent, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
      },
    });
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Document generation service is temporarily unavailable. Please try again shortly.', details: error.message },
      { status: 502 }
    );
  }
}
