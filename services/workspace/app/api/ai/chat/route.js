/**
 * AI Chat API Route - Thin Proxy to Python Backend
 * 
 * All AI logic is handled by the Python genlatex-agent backend.
 * This route simply forwards requests and streams responses.
 */

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess, getSessionFromRequest } from '@/lib/project-auth.js';
import { getProjectPath, readFile, listDir, syncProjectToLocal, syncProjectFromLocal, isMinio } from '@/lib/files.js';
import { getChatHistoryForContext, getUserZotero, getResearchFiles } from '@/lib/db.js';
import { getConversationHistory } from '@/lib/chat-context.js';
import { getDailyChatInfo, deductChatRequestAtomic } from '@/lib/user-subscription.js';
import { parseProjectMetadata } from '@/lib/json-recovery.js';

const PYTHON_API = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const CHAT_MAX_DOC_CHARS = parseInt(process.env.GENLATEX_CHAT_MAX_DOC_CHARS || '20000', 10);
const TAG_FILE_SNIPPET_MAX_CHARS = parseInt(process.env.GENLATEX_TAG_FILE_SNIPPET_MAX_CHARS || '3500', 10);
const TAG_FILE_MAX_ITEMS = parseInt(process.env.GENLATEX_TAG_FILE_MAX_ITEMS || '12', 10);
const TEXT_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.csv', '.tsv', '.json', '.yaml', '.yml', '.xml', '.tex', '.bib', '.log',
  '.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.c', '.cpp', '.h', '.go', '.rs', '.r',
  '.ipynb', '.sql'
]);

function budgetDocument(doc) {
  if (!doc) {
    return { content: doc, truncated: false, originalLength: 0 };
  }
  if (doc.length <= CHAT_MAX_DOC_CHARS) {
    return { content: doc, truncated: false, originalLength: doc.length };
  }
  const marker = '\n\n[...truncated...]\n\n';
  const markerLen = marker.length;
  const headChars = Math.max(0, Math.floor((CHAT_MAX_DOC_CHARS - markerLen) * 0.6));
  const tailChars = Math.max(0, CHAT_MAX_DOC_CHARS - markerLen - headChars);
  const head = doc.slice(0, headChars);
  const tail = tailChars > 0 ? doc.slice(-tailChars) : '';
  return {
    content: `${head}${marker}${tail}`,
    truncated: true,
    originalLength: doc.length
  };
}

function sanitizeRelativeFilePath(filePath) {
  const normalized = String(filePath || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  return normalized;
}

function extractTagReferences(message) {
  const text = String(message || '');
  const tags = new Set();
  const regex = /(^|[\s(])@([a-zA-Z0-9_-]{1,64})\b/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) tags.add(match[2].toLowerCase());
  }
  return [...tags];
}

function wantsAllUploadedFiles(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('use all uploaded files') ||
    text.includes('use all uploaded docs') ||
    text.includes('use all uploaded documents') ||
    text.includes('use all files')
  );
}

function normalizeComparablePath(value, projectPath) {
  if (!value) return null;
  const raw = String(value).replace(/\\/g, '/');
  if (!raw) return null;
  if (projectPath && path.isAbsolute(raw)) {
    const rel = path.relative(projectPath, raw).replace(/\\/g, '/');
    if (rel.startsWith('..')) return null;
    return rel.toLowerCase();
  }
  const sanitized = sanitizeRelativeFilePath(raw);
  return sanitized ? sanitized.toLowerCase() : null;
}

function buildTagSelection(projectManifest, requestedTags, useAllUploads) {
  const tags = Array.isArray(projectManifest?.tags) ? projectManifest.tags : [];
  const normalizedTagSet = new Set(requestedTags.map((tag) => String(tag || '').toLowerCase()));
  const selectedTagEntries = [];
  const selectedPaths = [];
  const selectedPathSet = new Set();
  const addPath = (relativePath) => {
    const normalized = sanitizeRelativeFilePath(relativePath);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (selectedPathSet.has(key)) return;
    selectedPathSet.add(key);
    selectedPaths.push(normalized);
  };

  for (const entry of tags) {
    const tag = String(entry?.tag || '').trim();
    if (!tag) continue;
    const isRequested = normalizedTagSet.has(tag.toLowerCase());
    if (!useAllUploads && !isRequested) continue;
    selectedTagEntries.push({
      tag,
      files: Array.isArray(entry?.files) ? entry.files : []
    });
    const files = Array.isArray(entry?.files) ? entry.files : [];
    for (const filePath of files) {
      addPath(filePath);
    }
  }

  return {
    selectedTagEntries,
    selectedPaths
  };
}

async function readTaggedFileSnippet(projectId, relativePath, maxChars) {
  const ext = path.extname(relativePath).toLowerCase();
  if (!TEXT_UPLOAD_EXTENSIONS.has(ext)) return '';
  try {
    const raw = await readFile(projectId, relativePath, { encoding: 'utf8' });
    const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    if (!text.trim()) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) return compact;
    return `${compact.slice(0, maxChars)}...`;
  } catch {
    return '';
  }
}

async function buildTaggedUploadContext({
  projectId,
  projectPath,
  message
}) {
  const requestedTags = extractTagReferences(message);
  const useAllUploads = wantsAllUploadedFiles(message);
  const shouldGateUploads = useAllUploads || requestedTags.length > 0;

  let projectManifest = null;
  if (projectId) {
    try {
      const manifestRaw = await readFile(projectId, 'project.json', { encoding: 'utf8' });
      const parsed = JSON.parse(Buffer.isBuffer(manifestRaw) ? manifestRaw.toString('utf8') : String(manifestRaw || '{}'));
      if (parsed && typeof parsed === 'object') {
        projectManifest = parsed;
      }
    } catch {
      projectManifest = null;
    }
  }

  const { selectedTagEntries, selectedPaths } = buildTagSelection(projectManifest, requestedTags, useAllUploads);
  if (useAllUploads && selectedPaths.length === 0 && projectId) {
    const discovered = [];
    const walkUploads = async (prefix = 'uploads') => {
      let entries = [];
      try {
        entries = await listDir(projectId, prefix);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (discovered.length >= TAG_FILE_MAX_ITEMS * 3) return;
        const entryPath = `${prefix}/${entry.name}`.replace(/\\/g, '/');
        if (entry.isDirectory) {
          await walkUploads(entryPath);
        } else {
          const sanitized = sanitizeRelativeFilePath(entryPath);
          if (sanitized) discovered.push(sanitized);
        }
      }
    };
    await walkUploads();
    for (const filePath of discovered) {
      if (!selectedPaths.includes(filePath)) {
        selectedPaths.push(filePath);
      }
    }
  }

  const allowedPathSet = new Set(
    selectedPaths
      .map((filePath) => normalizeComparablePath(filePath, projectPath))
      .filter(Boolean)
  );

  const inlineSources = selectedTagEntries.length > 0
    ? selectedTagEntries
    : (useAllUploads && selectedPaths.length > 0
      ? [{ tag: 'all_uploads', files: selectedPaths }]
      : []);

  const inlineFiles = [];
  const seenInline = new Set();
  for (const tagEntry of inlineSources) {
    const fileList = Array.isArray(tagEntry.files) ? tagEntry.files : [];
    for (const rawPath of fileList) {
      if (inlineFiles.length >= TAG_FILE_MAX_ITEMS) break;
      const relativePath = sanitizeRelativeFilePath(rawPath);
      if (!relativePath) continue;
      const key = relativePath.toLowerCase();
      if (seenInline.has(key)) continue;
      seenInline.add(key);
      const snippet = await readTaggedFileSnippet(projectId, relativePath, TAG_FILE_SNIPPET_MAX_CHARS);
      inlineFiles.push({
        fileId: `tag:${tagEntry.tag}:${inlineFiles.length + 1}`,
        fileName: path.basename(relativePath),
        fileType: path.extname(relativePath).replace('.', '') || 'file',
        filePath: projectPath ? path.join(projectPath, relativePath) : relativePath,
        metadata: {
          tag: tagEntry.tag,
          source: 'project-tag',
          relativePath,
        },
        keywords: [tagEntry.tag],
        extracted_content: snippet || null
      });
    }
    if (inlineFiles.length >= TAG_FILE_MAX_ITEMS) break;
  }

  return {
    requestedTags,
    useAllUploads,
    shouldGateUploads,
    selectedTagEntries,
    selectedPaths,
    allowedPathSet,
    inlineFiles,
  };
}

/**
 * Wrap a ReadableStream to run syncProjectFromLocal when it finishes.
 * Ensures AI chat file edits are pushed to MinIO.
 * Skips when agent sent X-Agent-Synced-MinIO (agent already synced to MinIO).
 */
function wrapStreamWithSync(stream, projectId, agentSyncedMinIO) {
  const reader = stream.getReader();
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!agentSyncedMinIO) {
            try {
              await syncProjectFromLocal(projectId);
            } catch (err) {
              console.warn('[chat] Sync from local to MinIO after stream:', err?.message);
            }
          }
          controller.close();
          return;
        }
        controller.enqueue(value);
        return;
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.message) {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400 }
      );
    }
    
    // Use actual file name when provided; otherwise leave null so Python discovers (main.tex, document.tex, paper.tex)
    const activeFile = 
      body.context?.activeFile ?? 
      body.context?.active_file ?? 
      body.currentFile ??
      body.activeFile ??
      null;
    
    // Get document content from various possible sources  
    const currentDocument = 
      body.currentDocument || 
      body.context?.current_document ||
      body.context?.currentDocument ||
      body.document ||
      null;
    const budgetedDocument = budgetDocument(currentDocument);
    const currentDocumentForContext = budgetedDocument.content;
    
    // Build selection if available (support both normalized {start,end,text} and Monaco {startLineNumber,endLineNumber})
    let selection = null;
    const hasSelectionText = body.context?.selection?.text || body.context?.selectedText || body.selection?.text || body.highlightedText || body.selectedRange;
    if (hasSelectionText) {
      selection = {
        start: body.selectedRange?.startLineNumber || body.selection?.range?.startLineNumber || body.context?.selection?.startLineNumber || body.context?.selection?.start || 1,
        end: body.selectedRange?.endLineNumber || body.selection?.range?.endLineNumber || body.context?.selection?.endLineNumber || body.context?.selection?.end || 1,
        text: body.selection?.text || body.context?.selectedText || body.highlightedText || body.context?.selection?.text || ''
      };
    }

    // Build cursor position if available (for insert-at-cursor functionality)
    let cursorPosition = null;
    if (body.cursorPosition || body.context?.cursor_position) {
      const cp = body.cursorPosition || body.context?.cursor_position;
      cursorPosition = {
        lineNumber: cp.lineNumber,
        column: cp.column,
        offset: cp.offset,
        lineContent: cp.lineContent || '',
        textBeforeCursor: cp.textBeforeCursor || '',
        textAfterCursor: cp.textAfterCursor || ''
      };
    }
    
    // Get project ID
    const projectId = body.projectId || body.project_id || '';

    // Resolve user for context: project access or session
    let userIdForContext = null;
    if (projectId) {
      const access = await requireProjectAccess(projectId);
      if (access instanceof NextResponse) return access;
      userIdForContext = access.userId;
    } else {
      const session = await getSessionFromRequest();
      userIdForContext = session?.id ?? null;
    }

    // Daily chat limit check and atomic deduction (only when user is known)
    // Free users: 5 chats/day, Pro users: unlimited
    // Use atomic deduction BEFORE API call to prevent race conditions
    if (userIdForContext) {
      const deductResult = await deductChatRequestAtomic(userIdForContext);
      if (!deductResult.success) {
        const chatInfo = await getDailyChatInfo(userIdForContext);
        return NextResponse.json(
          {
            error: 'daily_chat_limit',
            message: 'Daily chat limit reached',
            details: {
              remaining: deductResult.remaining,
              resetTime: chatInfo.resetTime
            }
          },
          { status: 429 }
        );
      }
    }
    
    // Calculate absolute project path for Python backend (uses storage layer / PROJECT_PATH)
    const projectPath = projectId
      ? path.resolve(process.cwd(), getProjectPath(userIdForContext ?? '', projectId))
      : null;

    const taggedUploadContext = await buildTaggedUploadContext({
      projectId,
      projectPath,
      message: body.message
    });
    
    let conversationHistory = body.chatHistory || body.context?.conversation_history || [];
    let researchFiles = [];
    if (projectId) {
      try {
        const rows = await getResearchFiles(projectId);
        researchFiles = rows
          .filter((r) => r.processing_status === 'processed' || r.metadata)
          .map((r) => ({
            file_id: r.file_id,
            file_name: r.file_name ?? r.file_path?.split(/[/\\]/).pop() ?? 'file',
            file_type: r.file_type,
            metadata: r.metadata || {}
          }));
      } catch (e) {
        console.warn('Could not load research files for chat:', e?.message);
      }
    }
    const highlightedFiles = 
      body.current_context?.highlighted_files ??
      body.context?.highlighted_files ??
      body.highlightedFiles ??
      body.mentionedFiles ??
      [];
    const taggedImportedFileIds = Array.isArray(body.taggedImportedFileIds)
      ? body.taggedImportedFileIds
      : Array.isArray(body.context?.taggedImportedFileIds)
        ? body.context.taggedImportedFileIds
        : Array.isArray(body.context?.tagged_imported_file_ids)
          ? body.context.tagged_imported_file_ids
          : [];
    const taggedImportedIdSet = new Set(taggedImportedFileIds.filter(Boolean));
    
    if (projectId && userIdForContext) {
      try {
        const dbMessages = await getChatHistoryForContext(projectId);
        const formattedHistory = getConversationHistory(dbMessages);
        if (formattedHistory.length > 0) {
          conversationHistory = formattedHistory;
          console.log(`Loaded ${formattedHistory.length} messages from database for context`);
        }

      } catch (historyError) {
        console.warn('⚠️ Failed to load chat history from database:', historyError.message);
      }
    }

    let zoteroConfig = null;
    if (projectId && userIdForContext) {
      try {
        // Use storage readFile so it works with MinIO (no sync needed)
        const metadataContent = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
        if (metadataContent) {
          const projectMetadata = parseProjectMetadata(metadataContent, 'project_metadata.json');
          const zoteroIntegration = projectMetadata?.zoteroIntegration;
          if (zoteroIntegration?.libraryId) {
            const userZotero = await getUserZotero(userIdForContext);
            if (userZotero) {
              const collectionKey = zoteroIntegration.collectionKey ?? null;
              zoteroConfig = {
                api_key: userZotero.apiKey,
                library_id: zoteroIntegration.libraryId,
                library_type: zoteroIntegration.libraryType || 'user',
                collection_key: collectionKey
              };
              console.log('📚 Zotero config loaded for chat');
            }
          }
        }
      } catch (zoteroErr) {
        console.warn('⚠️ Could not load Zotero config:', zoteroErr.message);
      }
    }
    
    // Build request for Python backend
    const chatRequest = {
      message: body.message,
      project_id: projectId,
      project_path: projectPath,  // Send absolute path so Python can find files
      context: {
        active_file: activeFile,
        selection: selection,
        cursor_position: cursorPosition,  // For insert-at-cursor functionality
        current_document: currentDocumentForContext,
        document_truncated: budgetedDocument.truncated,
        document_original_length: budgetedDocument.originalLength,
        mentioned_files: body.mentionedFiles || body.context?.mentioned_files || [],
        highlighted_files: highlightedFiles,
        research_files: researchFiles,
        tag_policy: {
          requested_tags: taggedUploadContext.requestedTags,
          use_all_uploaded_files: taggedUploadContext.useAllUploads,
          selected_tag_count: taggedUploadContext.selectedTagEntries.length,
          selected_file_count: taggedUploadContext.selectedPaths.length
        },
        tagged_imported_file_ids: taggedImportedFileIds,
        conversation_history: conversationHistory,
        zotero_config: zoteroConfig
      },
      stream: body.stream !== false  // Default to streaming
    };
    
    console.log('🚀 Forwarding chat request to Python backend:', {
      message: chatRequest.message.substring(0, 100),
      project_id: projectId,
      project_path: projectPath,
      active_file: activeFile,
      hasDocument: !!currentDocumentForContext,
      documentLength: currentDocumentForContext?.length || 0,
      documentTruncated: budgetedDocument.truncated,
      documentOriginalLength: budgetedDocument.originalLength,
      hasSelection: !!selection,
      hasCursorPosition: !!cursorPosition,
      cursorLine: cursorPosition?.lineNumber || null,
      historyLength: conversationHistory.length,
      requestedTags: taggedUploadContext.requestedTags,
      useAllUploadedFiles: taggedUploadContext.useAllUploads,
      highlightedFilesCount: highlightedFiles.length,
      stream: chatRequest.stream
    });

    // When MinIO is enabled: sync MinIO→local before chat so Python agent has latest files
    if (projectId && isMinio()) {
      try {
        await syncProjectToLocal(projectId);
      } catch (err) {
        console.warn('[chat] Sync MinIO to local before chat:', err?.message);
      }
    }
    
    // Forward to Python backend (send auth when configured, same as generate-with-project)
    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    const response = await fetch(`${PYTHON_API}/api/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(agentToken ? { 'Authorization': `Bearer ${agentToken}` } : {}),
      },
      body: JSON.stringify(chatRequest),
      signal: request.signal
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Python backend error:', response.status, errorText);
      // Sanitize error message for user - don't expose internal details
      const userFriendlyError = sanitizeErrorForUser(errorText, response.status);
      return NextResponse.json(
        { success: false, error: userFriendlyError },
        { status: response.status }
      );
    }

    // Note: Chat usage was already deducted atomically before the API call
    // This prevents race conditions where concurrent requests could exceed limits
    
    // Check if streaming response
    const contentType = response.headers.get('content-type');
    
    if (contentType?.includes('text/event-stream')) {
      // When MinIO: sync local→MinIO after stream unless agent already synced (X-Agent-Synced-MinIO header)
      const agentSyncedMinIO = response.headers.get('X-Agent-Synced-MinIO') === 'true';
      const body = projectId && isMinio()
        ? wrapStreamWithSync(response.body, projectId, agentSyncedMinIO)
        : response.body;
      console.log('📡 Streaming SSE response to client');
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }
    
    // Non-streaming response
    const data = await response.json();
    console.log('✅ Received non-streaming response:', {
      success: data.success,
      hasCode: !!data.code,
      responseLength: data.response?.length || 0
    });
    
    return NextResponse.json({
      success: data.success ?? true,
      response: data.response || '',
      code: data.code || null,
      intent: data.intent || 'local_ai',
      agent: 'python-backend',
      files_modified: data.files_modified || [],
      context: {
        hadSelection: !!chatRequest.context.selection,
        selectedText: chatRequest.context.selection?.text || null
      }
    });
    
  } catch (error) {
    if (error?.name === 'AbortError') {
      return new NextResponse(null, { status: 499 });
    }
    console.error('❌ Chat proxy error:', error);

    // Check if Python backend is unreachable
    if (error.cause?.code === 'ECONNREFUSED') {
      return NextResponse.json(
        {
          success: false,
          error: 'The AI assistant is temporarily unavailable. Please try again in a moment.',
          response: 'The AI service is not responding. Please try again shortly.'
        },
        { status: 503 }
      );
    }

    // Sanitize all other errors
    const userFriendlyError = sanitizeErrorForUser(error.message, 500);
    return NextResponse.json(
      { success: false, error: userFriendlyError },
      { status: 500 }
    );
  }
}

/**
 * Sanitize error messages before sending to users.
 * Removes sensitive information and makes errors user-friendly.
 */
function sanitizeErrorForUser(errorMsg, statusCode) {
  if (!errorMsg) {
    return 'An unexpected error occurred. Please try again.';
  }

  const errorLower = errorMsg.toLowerCase();

  // Map status codes to user-friendly messages
  if (statusCode === 429) {
    return 'You\'ve made too many requests. Please wait a moment before trying again.';
  }
  if (statusCode === 401 || statusCode === 403) {
    return 'There was an authentication issue. Please try refreshing the page.';
  }
  if (statusCode === 404) {
    return 'The requested resource was not found.';
  }

  // Map technical errors to user-friendly messages
  const errorMappings = [
    // API/Connection errors
    [['connection refused', 'econnrefused', 'connection reset', 'fetch failed'],
     'The AI service is temporarily unavailable. Please try again in a moment.'],
    [['timeout', 'timed out', 'deadline exceeded', 'aborted'],
     'The request took too long. Please try a simpler request or try again.'],
    [['rate limit', 'too many requests'],
     'You\'ve made too many requests. Please wait a moment before trying again.'],

    // Model/AI errors
    [['context length', 'token limit', 'context window', 'too long'],
     'The content is too long for processing. Try selecting a smaller section.'],
    [['model not found', 'invalid model'],
     'There was an issue with the AI model. Please try again.'],

    // JSON/Parsing errors
    [['json', 'parse error', 'invalid syntax', 'unexpected token'],
     'There was an issue processing the response. Please try again.'],

    // Generic server errors
    [['internal server error', '500', 'internal error'],
     'Something went wrong on our end. Please try again.'],
  ];

  for (const [keywords, friendlyMessage] of errorMappings) {
    if (keywords.some(keyword => errorLower.includes(keyword))) {
      return friendlyMessage;
    }
  }

  // If error looks like JSON with a message field, try to extract it
  try {
    const parsed = JSON.parse(errorMsg);
    if (parsed.message && typeof parsed.message === 'string') {
      // Recursively sanitize the message
      return sanitizeErrorForUser(parsed.message, statusCode);
    }
    if (parsed.error && typeof parsed.error === 'string') {
      return sanitizeErrorForUser(parsed.error, statusCode);
    }
  } catch {
    // Not JSON, continue
  }

  // If the error is very long or looks technical, simplify
  if (errorMsg.length > 150 || errorMsg.includes('\\') || errorMsg.includes('::')) {
    return 'An error occurred while processing your request. Please try again.';
  }

  // For short, simple error messages, return them (but cap length)
  return errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
}
