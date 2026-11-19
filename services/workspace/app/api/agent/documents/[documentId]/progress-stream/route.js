/**
 * Proxy SSE progress stream from the Python backend.
 * Keeps the EventSource URL same-origin so browsers don't block it.
 */

import { getSessionFromRequest } from '@/lib/project-auth.js';

const PYTHON_API_BASE =
  process.env.GENLATEX_AGENT_URL ||
  process.env.NEXT_PUBLIC_GENLATEX_AGENT_URL ||
  'http://localhost:8000';

export async function GET(request, { params }) {
  const session = await getSessionFromRequest();
  if (!session) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: 'Unauthorized' })}\n\n`,
      {
        status: 401,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    );
  }

  const p = await params;
  const documentId = p?.documentId;

  if (!documentId) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({ error: 'Missing generation id' })}\n\n`,
      {
        status: 400,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    );
  }

  const abortController = new AbortController();
  const { signal } = abortController;

  if (request?.signal?.aborted) {
    abortController.abort();
  } else if (request?.signal) {
    request.signal.addEventListener('abort', () => abortController.abort());
  }

  const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
  const backendHeaders = {
    Accept: 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  };
  if (agentToken) {
    backendHeaders['Authorization'] = `Bearer ${agentToken}`;
  }
  try {
    const backendResponse = await fetch(
      `${PYTHON_API_BASE}/documents/${documentId}/progress-stream`,
      {
        method: 'GET',
        headers: backendHeaders,
        cache: 'no-store',
        signal,
      }
    );

    if (!backendResponse.ok || !backendResponse.body) {
      const errorBody = await backendResponse
        .text()
        .catch(() => backendResponse.statusText);
      const isUnavailable = backendResponse.status === 502 || backendResponse.status === 503;
      return new Response(
        `event: error\ndata: ${JSON.stringify({
          error: 'Failed to connect to backend progress stream',
          ...(isUnavailable && { userMessage: 'Backend temporarily unavailable. Please try again in a moment.' }),
          status: backendResponse.status,
          details: errorBody,
        })}\n\n`,
        {
          status: backendResponse.status,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        }
      );
    }

    const reader = backendResponse.body.getReader();

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        abortController.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({
        error: 'SSE proxy connection failed',
        userMessage: 'Backend temporarily unavailable. Please try again in a moment.',
        details: error.message,
      })}\n\n`,
      {
        status: 502,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      }
    );
  }
}
