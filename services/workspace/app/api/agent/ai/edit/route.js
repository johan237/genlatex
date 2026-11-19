// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const agentBase = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    const targetUrl = `${agentBase}/api/genlatex-agent/ai/edit`;

    const payload = await request.json();
    const headers = new Headers({ 'content-type': 'application/json' });

    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    if (agentToken) headers.set('authorization', `Bearer ${agentToken}`);

    const resp = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await resp.json();
      return NextResponse.json(data, { status: resp.status });
    }
    const buf = await resp.arrayBuffer();
    return new NextResponse(buf, { status: resp.status, headers: resp.headers });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Proxy error', message: String(e) }, { status: 502 });
  }
}


