import { NextResponse } from 'next/server';
import { AIModelClient } from '@/lib/aimodel-client.js';
import { DEFAULT_DOCUMENT_TYPE, resolveDocumentConfig } from '@/lib/document-config.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

const MAX_MESSAGES = 16;
const MAX_TEXT_CHARS = 1800;
const ALLOWED_ROLES = new Set(['user', 'assistant']);

const DOCUMENT_KIND_MAP = {
  article: 'article',
  report: 'report',
  business: 'business',
  technical: 'technical',
  slides: 'slides',
  cv: 'cv',
  letter: 'letter',
  invoice: 'invoice',
  proposal: 'proposal'
};

function normalizeDocumentKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'presentation') return 'slides';
  if (normalized === 'resume') return 'cv';
  if (normalized === 'cover_letter') return 'letter';
  return DOCUMENT_KIND_MAP[normalized] ? normalized : null;
}

function inferDocumentKindFromText(text) {
  const input = String(text || '').toLowerCase();
  if (!input) return DEFAULT_DOCUMENT_TYPE;

  if (/\b(cv|resume|curriculum vitae)\b/.test(input)) return 'cv';
  if (/\b(cover letter|motivation letter|recommendation letter|letter)\b/.test(input)) return 'letter';
  if (/\b(invoice|quotation|billing statement|bill)\b/.test(input)) return 'invoice';
  if (/\b(proposal|project proposal|grant proposal|bid)\b/.test(input)) return 'proposal';
  if (/\b(powerpoint|pptx|ppt|slides|slide deck|deck|presentation|beamer)\b/.test(input)) return 'slides';
  if (/\b(business plan|business case|market analysis|executive brief|strategy)\b/.test(input)) return 'business';
  if (/\b(report|financial|technical report|business report|annual report|audit)\b/.test(input)) return 'report';
  if (/\b(technical document|specification|design doc|manual|architecture document|api spec)\b/.test(input)) return 'technical';
  return 'article';
}

function sanitizeMessages(inputMessages) {
  if (!Array.isArray(inputMessages)) return [];

  const normalized = [];
  for (const raw of inputMessages.slice(-MAX_MESSAGES)) {
    const role = ALLOWED_ROLES.has(raw?.role) ? raw.role : null;
    const text = String(raw?.text || raw?.content || '').trim();
    if (!role || !text) continue;
    normalized.push({
      role,
      text: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}...` : text
    });
  }

  return normalized;
}

function extractConversationText(messages) {
  return messages.map((msg) => `${msg.role}: ${msg.text}`).join('\n');
}

function extractJsonPayload(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;

    const candidate = text.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function collectHeuristicMissing(messages) {
  const text = extractConversationText(messages).toLowerCase();
  const missing = [];

  if (!/\b(audience|recipient|for|target|stakeholder|client|team|students|investors)\b/.test(text)) {
    missing.push('target audience or recipient');
  }
  if (!/\b(section|structure|outline|agenda|include|must have|chapter|slide)\b/.test(text)) {
    missing.push('required sections or structure');
  }
  if (!/\b(tone|formal|professional|style|modern|minimal|color|theme|layout)\b/.test(text)) {
    missing.push('style or tone preference');
  }
  if (!/\b(length|page|word|slide|deadline|time|duration)\b/.test(text)) {
    missing.push('length or size target');
  }

  return missing.slice(0, 4);
}

function createFallbackTurn(messages, inferredKind) {
  const missing = collectHeuristicMissing(messages);
  const firstMissing = missing[0];

  if (firstMissing === 'target audience or recipient') {
    return {
      assistantMessage: 'Who is this document for, and what outcome should it achieve?',
      readyToBuild: false,
      missing
    };
  }
  if (firstMissing === 'required sections or structure') {
    return {
      assistantMessage: 'What sections or slide flow do you want me to include?',
      readyToBuild: false,
      missing
    };
  }
  if (firstMissing === 'style or tone preference') {
    return {
      assistantMessage: 'What style do you want (formal, modern, minimal, corporate, creative), and any color/layout preference?',
      readyToBuild: false,
      missing
    };
  }
  if (firstMissing === 'length or size target') {
    return {
      assistantMessage: inferredKind === 'slides'
        ? 'How many slides should this deck have, and how deep should each slide be?'
        : 'How long should the document be (pages/words) and how concise should it read?',
      readyToBuild: false,
      missing
    };
  }

  return {
    assistantMessage: 'Great, I have enough context. If you have supporting files or images, upload them now, then click Build.',
    readyToBuild: true,
    missing: []
  };
}

function buildSystemPrompt(kindHint, inferredKind) {
  return `You are GenLaTeX's intake copilot.

Goal:
- Chat naturally like ChatGPT/Claude, but focused on preparing high-quality LaTeX document generation.
- Do NOT sound scripted.
- Ask only one concise follow-up question per turn when needed.
- If enough information is available, stop asking questions and mark ready_to_build=true.

Document context:
- Kind hint from UI: ${kindHint || 'none'}
- Inferred kind from conversation: ${inferredKind}

Quality rules:
- Keep responses practical and specific.
- Prefer short, high-signal questions.
- Never ask about "publication worthiness", "research gap analysis", or reviewer acceptance flow.
- Focus on content, structure, style, constraints, and assets/files.

Return STRICT JSON only:
{
  "assistant_message": "single assistant reply shown to the user",
  "ready_to_build": true or false,
  "document_kind": "article|report|business|technical|slides|cv|letter|invoice|proposal",
  "missing_requirements": ["short item", "..."]
}`;
}

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const messages = sanitizeMessages(body?.messages);

    if (!messages.length) {
      return NextResponse.json({ success: false, error: 'No chat messages provided.' }, { status: 400 });
    }

    const joinedText = extractConversationText(messages);
    const kindHint = normalizeDocumentKind(body?.documentKindHint) || null;
    const inferredKind = kindHint || inferDocumentKindFromText(joinedText);

    const ai = new AIModelClient();
    const chatMessages = [
      { role: 'system', content: buildSystemPrompt(kindHint, inferredKind) },
      ...messages.map((message) => ({
        role: message.role,
        content: message.text
      })),
      {
        role: 'user',
        content: 'Based on the full conversation so far, return the strict JSON object now.'
      }
    ];

    const aiResponse = await ai.chat(chatMessages, {
      temperature: 0.35,
      maxTokens: 700
    });

    let assistantMessage = '';
    let readyToBuild = false;
    let resolvedKind = inferredKind;
    let missingRequirements = [];

    const payload = aiResponse?.success ? extractJsonPayload(aiResponse.content) : null;
    if (payload) {
      assistantMessage = String(payload.assistant_message || '').trim();
      readyToBuild = Boolean(payload.ready_to_build);
      resolvedKind = normalizeDocumentKind(payload.document_kind) || resolvedKind;
      missingRequirements = uniqueStrings(Array.isArray(payload.missing_requirements) ? payload.missing_requirements : []);
    } else {
      const fallback = createFallbackTurn(messages, inferredKind);
      assistantMessage = fallback.assistantMessage;
      readyToBuild = fallback.readyToBuild;
      missingRequirements = fallback.missing;
    }

    if (!assistantMessage) {
      const fallback = createFallbackTurn(messages, inferredKind);
      assistantMessage = fallback.assistantMessage;
      readyToBuild = fallback.readyToBuild;
      missingRequirements = fallback.missing;
    }

    const resolved = resolveDocumentConfig(resolvedKind, null);

    return NextResponse.json({
      success: true,
      assistant_message: assistantMessage,
      ready_to_build: readyToBuild,
      document_kind: resolvedKind,
      document_type: resolved.type?.id || resolvedKind || DEFAULT_DOCUMENT_TYPE,
      document_template: resolved.template?.id || null,
      document_schema_id: resolved.schema?.id || null,
      missing_requirements: missingRequirements.slice(0, 6),
      llm_ok: Boolean(aiResponse?.success)
    });
  } catch (error) {
    console.error('Intake turn generation failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate intake response.'
      },
      { status: 500 }
    );
  }
}
