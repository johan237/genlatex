/**
 * API proxy for document file downloads.
 * Forwards to Python backend GET /documents/{documentId}/download/{fileType}.
 */

import { NextResponse } from 'next/server';

const PYTHON_API_BASE = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const AGENT_API_KEY = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;

function getFileExtension(fileType) {
  const extensions = {
    latex: 'tex',
    pdf: 'pdf',
    docx: 'docx',
    html: 'html',
    txt: 'txt',
  };
  return extensions[fileType] || 'txt';
}

export async function GET(request, { params }) {
  try {
    const { documentId, fileType } = await params;
    const headers = {};
    if (AGENT_API_KEY) {
      headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
    }
    const response = await fetch(`${PYTHON_API_BASE}/documents/${documentId}/download/${fileType}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Python API error:', errorText);
      const isUnavailable = response.status === 502 || response.status === 503;
      const errorMessage = isUnavailable
        ? 'Document generation service is temporarily unavailable. Please try again shortly.'
        : 'Failed to download file';
      return NextResponse.json(
        { error: errorMessage, details: errorText },
        { status: response.status }
      );
    }

    const fileContent = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = response.headers.get('content-disposition') || `attachment; filename="${fileType}.${getFileExtension(fileType)}"`;

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
