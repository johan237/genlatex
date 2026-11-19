/**
 * API proxy for document status.
 * Forwards requests to Python FastAPI backend (GET /documents/{documentId}).
 */

import { NextResponse } from 'next/server';

const PYTHON_API_BASE = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const AGENT_API_KEY = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;

export async function GET(request, { params }) {
  try {
    const { documentId } = await params;
    const headers = { 'Content-Type': 'application/json' };
    if (AGENT_API_KEY) {
      headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
    }
    const response = await fetch(`${PYTHON_API_BASE}/documents/${documentId}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Python API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to get document status', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to document generation service', details: error.message },
      { status: 500 }
    );
  }
}
