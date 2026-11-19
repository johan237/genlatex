import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { AIModelClient } from '@/lib/aimodel-client.js';

function fallbackTitle(description, mode = 'build') {
  const text = String(description || '').trim();
  if (!text) return mode === 'iterate' ? 'Draft Document Plan' : 'New Document Project';
  const words = text
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 6)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`);
  if (!words.length) return mode === 'iterate' ? 'Draft Document Plan' : 'New Document Project';
  return words.join(' ');
}

function sanitizeTitle(title, mode, description) {
  const cleaned = String(title || '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallbackTitle(description, mode);
}

export async function POST(request) {
  let description = '';
  let mode = 'build';
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    description = String(body?.description || '').trim();
    mode = String(body?.mode || 'build').toLowerCase();
    if (description.length < 8) {
      return NextResponse.json({ success: false, error: 'Description is too short' }, { status: 400 });
    }

    const aiClient = new AIModelClient();
    const prompt = [
      `Mode: ${mode === 'iterate' ? 'Iterate' : 'Build'}`,
      `Description: ${description}`,
      'Return only one concise project title.',
      'Rules: 4 to 8 words, no punctuation at the end, title case, no quotes.'
    ].join('\n');

    const aiResult = await aiClient.chat(
      [
        {
          role: 'system',
          content: 'You write concise document project titles. Return plain text only.'
        },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.35, maxTokens: 24 }
    );

    if (aiResult?.success && aiResult?.content) {
      return NextResponse.json({
        success: true,
        title: sanitizeTitle(aiResult.content.split('\n')[0], mode, description),
        source: 'ai'
      });
    }

    return NextResponse.json({
      success: true,
      title: fallbackTitle(description, mode),
      source: 'fallback'
    });
  } catch (error) {
    console.error('suggest-title error:', error);
    return NextResponse.json({
      success: true,
      title: fallbackTitle(description, mode),
      source: 'fallback'
    });
  }
}
