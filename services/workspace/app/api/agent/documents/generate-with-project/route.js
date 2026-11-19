/**
 * Canonical API endpoint for document generation with automatic project creation.
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { handlePaperGenerationCompletion, isValidSupportFileContent } from '@/lib/paper-project-integration.js';
import { getUser, getResearchFiles } from '@/lib/db.js';
import { canUserUsePaperGeneration, deductPaperCreditsAtomic, refundPaperCredits } from '@/lib/user-subscription.js';
import { STORAGE_LIMITS, formatBytes } from '@/lib/storage-limits.js';
import { getProjectPath, syncProjectToLocal, syncProjectFromLocal, isMinio, readFile, writeFile } from '@/lib/files.js';
import { parseProjectMetadata } from '@/lib/json-recovery.js';
import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import axios from 'axios';

const PYTHON_API_BASE = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const AGENT_API_KEY = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;

const TEMPLATE_IMPORT_ENABLED = String(process.env.GENLATEX_ENABLE_TEMPLATE_IMPORT ?? 'true').toLowerCase() !== 'false';
const TEMPLATE_TEXT_EXTENSIONS = new Set([
  '.tex', '.sty', '.cls', '.bib', '.bst', '.def', '.fd', '.cfg', '.txt', '.md'
]);
const TEMPLATE_BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.eps'
]);
const TEMPLATE_ALLOWED_EXTENSIONS = new Set([...TEMPLATE_TEXT_EXTENSIONS, ...TEMPLATE_BINARY_EXTENSIONS]);

function normalizeTemplatePath(rawPath) {
  const normalized = path.posix.normalize(
    String(rawPath || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .replace(/^\.\/+/, '')
  );
  if (!normalized || normalized === '.' || normalized.startsWith('..')) return null;
  return normalized;
}

function templateExtension(filePath) {
  return path.posix.extname(String(filePath || '')).toLowerCase();
}

function templateMimeType(ext) {
  switch (String(ext || '').toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    case '.eps':
      return 'application/postscript';
    default:
      return 'application/octet-stream';
  }
}

function appendIfTruthy(form, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    form.append(key, value);
  }
}

function appendUploadFiles(formData, pythonForm) {
  const uploadKeys = ['uploadedFiles', 'referenceFiles', 'reference_files'];
  const seen = new Set();

  for (const key of uploadKeys) {
    const files = formData.getAll(key);
    files
      .filter((file) => file instanceof File)
      .forEach((file) => {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified ?? 0}`;
        if (seen.has(fingerprint)) return;
        seen.add(fingerprint);
        pythonForm.append('reference_files', file, file.name || 'material');
      });
  }
}

function parseMetadataValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return {};
}

function isChunkMetadata(metadata) {
  const flag = metadata?.isChunk ?? metadata?.is_chunk;
  return flag === true || (typeof flag === 'string' && flag.toLowerCase() === 'true');
}

/**
 * Forward multipart request to Python backend
 * @param {FormData} formData - Original form data
 * @param {Object} diskTemplateFiles - Template files loaded from disk (optional)
 * @param {string} apiKey - API key for authentication (optional)
 * @param {string} userId - User ID for path resolution (optional)
 */
async function forwardMultipartRequest(formData, diskTemplateFiles = null, apiKey = null, userId = null) {
  const pythonForm = new FormData();

  appendIfTruthy(pythonForm, 'topic', formData.get('topic'));
  appendIfTruthy(pythonForm, 'description', formData.get('description'));
  appendIfTruthy(pythonForm, 'project_id', formData.get('project_id'));
  // FIX: Include user_id for correct path resolution in backend
  appendIfTruthy(pythonForm, 'user_id', userId);
  appendIfTruthy(pythonForm, 'fast_mode', formData.get('fast_mode') ?? formData.get('fastMode'));
  appendIfTruthy(pythonForm, 'flash_mode', formData.get('flash_mode') ?? formData.get('flashMode'));
  appendIfTruthy(pythonForm, 'document_mode', formData.get('document_mode') ?? formData.get('documentMode') ?? 'true');
  appendIfTruthy(pythonForm, 'document_type', formData.get('documentType') ?? formData.get('document_type'));
  appendIfTruthy(pythonForm, 'document_template', formData.get('documentTemplate') ?? formData.get('document_template'));
  appendIfTruthy(pythonForm, 'document_schema_id', formData.get('documentSchemaId') ?? formData.get('document_schema_id'));

  const instructions = formData.get('specialInstructions');
  if (instructions) {
    pythonForm.append('special_instructions', instructions);
  }

  appendUploadFiles(formData, pythonForm);

  // First add template files from form upload.
  const templateUploads = TEMPLATE_IMPORT_ENABLED
    ? [...formData.getAll('templateFiles'), ...formData.getAll('template_files')]
    : [];
  const uploadedTemplateNames = new Set();
  templateUploads
    .filter((file) => file instanceof File)
    .forEach((file) => {
      const normalizedName = normalizeTemplatePath(file.name || 'template') || (file.name || 'template');
      pythonForm.append('template_files', file, normalizedName);
      uploadedTemplateNames.add(normalizedName);
    });

  // Then add template files from disk (if not already uploaded).
  if (TEMPLATE_IMPORT_ENABLED && diskTemplateFiles && typeof diskTemplateFiles === 'object') {
    for (const [filename, content] of Object.entries(diskTemplateFiles)) {
      const normalizedName = normalizeTemplatePath(filename);
      if (!normalizedName || uploadedTemplateNames.has(normalizedName)) continue;

      const ext = templateExtension(normalizedName);
      const contentType = templateMimeType(ext);
      let blob = null;

      if (
        content &&
        typeof content === 'object' &&
        !Array.isArray(content) &&
        String(content.__encoding || content.encoding || '').toLowerCase() === 'base64'
      ) {
        const base64 = String(content.data || content.content || '');
        const buffer = Buffer.from(base64, 'base64');
        blob = new Blob([buffer], { type: content.mime_type || contentType });
      } else {
        blob = new Blob([String(content ?? '')], { type: 'text/plain;charset=utf-8' });
      }

      pythonForm.append('template_files', blob, normalizedName);
      console.log(`   ✅ Added disk template to multipart: ${normalizedName}`);
    }
  }

  const headers = {};
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${PYTHON_API_BASE}/documents/generate`, {
    method: 'POST',
    headers,
    body: pythonForm,
  });

  return response;
}

export async function POST(request) {
  try {
    console.log('📝 Starting AI document generation with project creation...');

    // Check authentication
    const session = await getSessionFromRequest();
    if (!session?.id) {
      console.log('❌ No session (user not logged in)');
      return NextResponse.json(
        { error: 'Unauthorized', hint: 'Log in and try again. AI generation requires an active session.' },
        { status: 401 }
      );
    }

    // Detect content type and parse accordingly
    const contentType = request.headers.get('content-type') || '';
    let body;
    let isMultipart = false;

    if (contentType.includes('multipart/form-data')) {
      // Handle FormData (when files are uploaded)
      isMultipart = true;
      const formData = await request.formData();
      body = {
        topic: formData.get('topic'),
        description: formData.get('description'),
        project_id: formData.get('project_id'),
        specialInstructions: formData.get('specialInstructions'),
      };

      // Store formData for forwarding to Python backend
      body._formData = formData;
      console.log('📋 Parsed FormData request');
    } else {
      // Handle JSON request
      body = await request.json();
    }

    console.log('📋 Request body:', { ...body, _formData: body._formData ? '[FormData]' : undefined });
    console.log('👤 User ID:', session.id);

    // Early paper credit check (before file processing) - quick rejection without wasting resources
    // Actual atomic deduction happens later, right before calling Python API
    const fastMode = body.fast_mode ?? body.fastMode ?? true;
    const creditCheck = await canUserUsePaperGeneration(session.id, fastMode);
    if (!creditCheck.allowed) {
      return NextResponse.json(
        {
          error: 'paper_credits_exceeded',
          message: creditCheck.isLifetime ? 'No generation credits remaining. Upgrade to Pro for more credits.' : 'No generation credits remaining this month.',
          details: { remaining: creditCheck.remaining, cost: creditCheck.cost, resetDate: creditCheck.resetDate, isLifetime: creditCheck.isLifetime }
        },
        { status: 403 }
      );
    }

    const rawDocumentMode = body.document_mode ?? body.documentMode ?? true;
    const documentMode = typeof rawDocumentMode === 'string'
      ? !['false', '0', 'no', 'off'].includes(rawDocumentMode.toLowerCase())
      : Boolean(rawDocumentMode);

    // Normalize special instructions to canonical shape: string | null (API contract is special_instructions)
    let specialInstructions = null;
    const rawInstructions = body.specialInstructions ?? body.special_instructions;
    if (rawInstructions) {
      // Handle both string and object formats for backward compatibility
      const instructions = typeof rawInstructions === 'string'
        ? rawInstructions
        : rawInstructions?.text;
      
      if (instructions && instructions.trim()) {
        // Validate text length (max 5000 characters)
        if (instructions.length > 5000) {
          console.log('⚠️  Special instructions text too long, truncating to 5000 characters');
          specialInstructions = instructions.substring(0, 5000);
        } else {
          specialInstructions = instructions.trim();
          console.log('📝 Special instructions provided:', specialInstructions.substring(0, 100) + '...');
        }
      }
    }

    // ========== PHASE 6: DEFERRED PROCESSING LOGIC ==========
    // Check for pending research files and process them before generation.
    let citationGraph = null;
    const skipDeferredProcessing = documentMode && !['false', '0', 'no', 'off'].includes(
      String(process.env.GENLATEX_DOCUMENT_SKIP_DEFERRED_FILE_PROCESSING || 'true').toLowerCase()
    );

    // Collect template files from multiple sources.
    // Fast path: built-in templates should avoid project template folder scanning entirely.
    const formTemplateSource = isMultipart && body._formData
      ? (body._formData.get('template_source') ?? body._formData.get('templateSource'))
      : null;
    const formUseCustomTemplateRaw = isMultipart && body._formData
      ? (body._formData.get('use_custom_template') ?? body._formData.get('useCustomTemplate'))
      : null;
    const formUseCustomTemplate = typeof formUseCustomTemplateRaw === 'string'
      ? ['true', '1', 'yes', 'on'].includes(formUseCustomTemplateRaw.toLowerCase())
      : Boolean(formUseCustomTemplateRaw);
    const requestedTemplateSource = String(
      body.template_source ?? body.templateSource ?? formTemplateSource ?? ''
    ).toLowerCase();
    const hasInlineTemplateFiles = Array.isArray(body.templateFiles) && body.templateFiles.length > 0;
    const hasLegacyTemplateZip = Boolean(body.templatePath);
    const hasMultipartTemplateUploads = Boolean(
      isMultipart &&
      body._formData &&
      [...body._formData.getAll('templateFiles'), ...body._formData.getAll('template_files')]
        .some((entry) => entry instanceof File)
    );
    const customTemplateRequested = requestedTemplateSource === 'project'
      || body.use_custom_template === true
      || body.useCustomTemplate === true
      || formUseCustomTemplate === true
      || hasInlineTemplateFiles
      || hasLegacyTemplateZip
      || hasMultipartTemplateUploads;
    const forceTemplateScan = String(process.env.GENLATEX_ALWAYS_SCAN_PROJECT_TEMPLATE || 'false').toLowerCase() === 'true';
    const shouldLoadProjectTemplateFiles = TEMPLATE_IMPORT_ENABLED && (customTemplateRequested || forceTemplateScan);

    let templateFiles = shouldLoadProjectTemplateFiles ? {} : null;

    if (!shouldLoadProjectTemplateFiles) {
      console.log(
        `[TEMPLATE] Fast path enabled: using built-in backend template ` +
        `(type=${body.document_type || body.documentType || 'auto'}, template=${body.document_template || body.documentTemplate || 'default'})`
      );
    }

    // 1. Read template files from extracted template folder (if explicitly requested)
    if (body.project_id && shouldLoadProjectTemplateFiles) {
      try {
        if (isMinio()) {
          await syncProjectToLocal(body.project_id);
        }
        const projectPath = path.resolve(process.cwd(), getProjectPath(session.id, body.project_id));
        const templateFolderPath = path.join(projectPath, 'template');

        try {
          await fs.access(templateFolderPath);
          console.log('📋 Reading template files from folder:', templateFolderPath);

          const findTemplateFilesInDir = async (dirPath, maxDepth = 6, currentDepth = 0) => {
            if (currentDepth > maxDepth) return [];
            const files = [];
            try {
              const entries = await fs.readdir(dirPath, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__')) {
                  files.push(...await findTemplateFilesInDir(fullPath, maxDepth, currentDepth + 1));
                } else if (entry.isFile()) {
                  const relativePath = normalizeTemplatePath(path.relative(templateFolderPath, fullPath));
                  if (!relativePath) continue;
                  const ext = templateExtension(relativePath);
                  if (TEMPLATE_ALLOWED_EXTENSIONS.has(ext)) {
                    files.push({ fullPath, relativePath, ext });
                  }
                }
              }
            } catch (err) {
              console.warn(`Could not read directory ${dirPath}:`, err.message);
            }
            return files;
          };

          const templateFileEntries = await findTemplateFilesInDir(templateFolderPath);

          for (const entry of templateFileEntries) {
            const { fullPath, relativePath, ext } = entry;
            try {
              if (TEMPLATE_TEXT_EXTENSIONS.has(ext)) {
                const content = await fs.readFile(fullPath, 'utf-8');
                if ((ext === '.cls' || ext === '.sty') && !isValidSupportFileContent(relativePath, content)) {
                  console.log(`   ⚠️ Skipped ${relativePath} (contains document content, not a valid class/style file)`);
                  continue;
                }
                templateFiles[relativePath] = content;
              } else if (TEMPLATE_BINARY_EXTENSIONS.has(ext)) {
                const bytes = await fs.readFile(fullPath);
                templateFiles[relativePath] = {
                  __encoding: 'base64',
                  mime_type: templateMimeType(ext),
                  data: bytes.toString('base64')
                };
              }
              console.log(`   ✅ Loaded from template folder: ${relativePath}`);
            } catch (readError) {
              console.warn(`   ⚠️ Could not read ${relativePath}:`, readError.message);
            }
          }
          console.log(`📋 Loaded ${Object.keys(templateFiles).length} template files from folder`);
        } catch {
          console.log('ℹ️ No template folder found, checking for legacy ZIP...');
          if (body.templatePath) {
            try {
              console.log('📋 Reading template files from ZIP (legacy):', body.templatePath);
              const zipBuffer = await fs.readFile(body.templatePath);
              const zip = await JSZip.loadAsync(zipBuffer);

              for (const [zipPath, file] of Object.entries(zip.files)) {
                if (file.dir) continue;
                const relativePath = normalizeTemplatePath(zipPath);
                if (!relativePath) continue;
                const ext = templateExtension(relativePath);
                if (!TEMPLATE_ALLOWED_EXTENSIONS.has(ext)) continue;

                if (TEMPLATE_TEXT_EXTENSIONS.has(ext)) {
                  const content = await file.async('string');
                  if ((ext === '.cls' || ext === '.sty') && !isValidSupportFileContent(relativePath, content)) {
                    console.log(`   ⚠️ Skipped ${relativePath} from ZIP (contains document content, not a valid class/style file)`);
                    continue;
                  }
                  templateFiles[relativePath] = content;
                } else if (TEMPLATE_BINARY_EXTENSIONS.has(ext)) {
                  const bytes = await file.async('nodebuffer');
                  templateFiles[relativePath] = {
                    __encoding: 'base64',
                    mime_type: templateMimeType(ext),
                    data: bytes.toString('base64')
                  };
                }
                console.log(`   ✅ Loaded from ZIP: ${relativePath}`);
              }
              console.log(`📋 Loaded ${Object.keys(templateFiles).length} template files from ZIP`);
            } catch (error) {
              console.error('⚠️ Failed to load template files from ZIP:', error);
            }
          }
        }
      } catch (error) {
        console.error('⚠️ Error reading template files:', error);
      }
    }

    // 2. Add individual template files if provided (existing files take precedence)
    if (TEMPLATE_IMPORT_ENABLED && body.templateFiles && Array.isArray(body.templateFiles)) {
      console.log(`📄 Processing ${body.templateFiles.length} individual template files`);
      for (const templateFile of body.templateFiles) {
        const normalizedName = normalizeTemplatePath(templateFile?.name);
        if (!normalizedName) continue;
        if (templateFiles?.[normalizedName]) {
          console.log(`   ⏭️  Skipped ${normalizedName} (already loaded)`);
          continue;
        }

        const ext = templateExtension(normalizedName);
        const rawContent = templateFile?.content;
        if (rawContent == null || !TEMPLATE_ALLOWED_EXTENSIONS.has(ext)) continue;

        if (
          rawContent &&
          typeof rawContent === 'object' &&
          !Array.isArray(rawContent) &&
          String(rawContent.__encoding || rawContent.encoding || '').toLowerCase() === 'base64'
        ) {
          templateFiles[normalizedName] = {
            __encoding: 'base64',
            mime_type: rawContent.mime_type || templateMimeType(ext),
            data: String(rawContent.data || rawContent.content || '')
          };
          console.log(`   ✅ Added individual binary template file: ${normalizedName}`);
          continue;
        }

        const textContent = String(rawContent);
        if ((ext === '.cls' || ext === '.sty') && !isValidSupportFileContent(normalizedName, textContent)) {
          console.log(`   ⚠️ Skipped ${normalizedName} (contains document content, not a valid class/style file)`);
          continue;
        }
        templateFiles[normalizedName] = textContent;
        console.log(`   ✅ Added individual template file: ${normalizedName}`);
      }
    }

    if (templateFiles != null) {
      if (Object.keys(templateFiles).length === 0) {
        templateFiles = null;
      } else {
        console.log(`📋 Total template files collected: ${Object.keys(templateFiles).length}`, Object.keys(templateFiles));
      }
    }

    // Attach processed research files for the agent (file tools / context).
    let researchFilesPayload = [];
    if (body.project_id) {
      try {
        const rows = await getResearchFiles(body.project_id);
        researchFilesPayload = rows
          .filter((r) => r.processing_status === 'processed' || r.metadata)
          .map((r) => ({
            file_id: r.file_id,
            file_name: r.file_name ?? r.file_path?.split(/[/\\]/).pop() ?? 'file',
            file_type: r.file_type,
            metadata: r.metadata || {}
          }));
        if (researchFilesPayload.length) {
          console.log('📁 Sending research files to agent:', researchFilesPayload.length);
        }
      } catch (e) {
        console.warn('Could not load research files for project:', e?.message);
      }
    }

    // Modified request body to include template files, special instructions, citation graph, and research files
    const agentRequestBody = {
      ...body,
      user_id: session.id,
      document_mode: documentMode,
      template_files: TEMPLATE_IMPORT_ENABLED ? templateFiles : null,
      special_instructions: specialInstructions,
      citation_graph: citationGraph,
      research_files: researchFilesPayload
    };

    delete agentRequestBody.templatePath;
    delete agentRequestBody.specialInstructions;
    delete agentRequestBody._formData;
    delete agentRequestBody.selected_references;

    console.log('📤 Request body to Python API:', {
      topic: agentRequestBody.topic,
      description: agentRequestBody.description?.substring(0, 50) + '...',
      project_id: agentRequestBody.project_id,
      template_source: requestedTemplateSource || 'builtin',
      custom_template_requested: customTemplateRequested,
      template_files: templateFiles ? Object.keys(templateFiles) : null,
      special_instructions: specialInstructions ? specialInstructions.substring(0, 50) + '...' : null,
      document_mode: documentMode,
      has_zotero_config: !!agentRequestBody.zotero_config,
      research_files_count: (agentRequestBody.research_files || []).length
    });

    // ATOMIC credit deduction BEFORE calling Python API (prevents race conditions)
    const deductResult = await deductPaperCreditsAtomic(session.id, fastMode);
    if (!deductResult.success) {
      return NextResponse.json(
        {
          error: 'paper_credits_exceeded',
          message: 'No generation credits remaining. Upgrade to Pro for more credits.',
          details: { remaining: deductResult.remaining, cost: deductResult.cost }
        },
        { status: 403 }
      );
    }
    console.log(`💳 Deducted ${deductResult.cost} paper credits (${deductResult.remaining} remaining)`);

    // Start document generation
    console.log('🐍 Calling Python API at:', `${PYTHON_API_BASE}/documents/generate`);
    if (templateFiles) {
      console.log('📋 Sending template files to agent:', Object.keys(templateFiles));
    }

    // Timeout must allow backend to accept request and return document id (backend runs generation in background).
    // Nginx is 300s; use 120s so we don't abort before backend responds under load.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120 second timeout

    let response;
    try {
      // Check if we need to forward as multipart (when files were uploaded)
      if (isMultipart && body._formData) {
        console.log('📤 Forwarding as multipart/form-data request');
        // FIX: Pass disk-based template files, API key, and user_id to multipart request
        response = await forwardMultipartRequest(body._formData, templateFiles, AGENT_API_KEY, session.id);
      } else {
        // Prepare headers with authentication for JSON request
        const headers = {
          'Content-Type': 'application/json',
        };
        if (AGENT_API_KEY) {
          headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
        }

        response = await fetch(`${PYTHON_API_BASE}/documents/generate`, {
          method: 'POST',
          headers,
          body: JSON.stringify(agentRequestBody),
          signal: controller.signal
        });
      }
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);

      // REFUND credits on connection failure
      console.log('💳 Refunding paper credits due to connection failure');
      await refundPaperCredits(session.id, fastMode);

      // Handle connection errors (backend not running, network issues, etc.)
      const isConnectionError =
        fetchError.name === 'AbortError' ||
        fetchError.code === 'ECONNREFUSED' ||
        fetchError.message?.includes('fetch failed') ||
        fetchError.cause?.code === 'ECONNREFUSED';

      if (isConnectionError) {
        console.error(`❌ Backend not accessible at ${PYTHON_API_BASE} (${fetchError.message || fetchError.code})`);
        return NextResponse.json(
          {
            error: 'Backend service unavailable',
            message: 'The Python backend is not running or not accessible. Your credits have been refunded.',
            details: `Failed to connect to ${PYTHON_API_BASE}/documents/generate`,
            hint: 'Start the backend with: cd genlatex-agent && python run_api.py'
          },
          { status: 503 }
        );
      }

      // Re-throw other errors
      throw fetchError;
    }

    console.log('🐍 Python API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Python API error:', errorText);

      // REFUND credits on API error
      console.log('💳 Refunding paper credits due to API error');
      await refundPaperCredits(session.id, fastMode);

      // Provide clearer error message for 404 (backend not running or endpoint not found)
      if (response.status === 404) {
        return NextResponse.json(
          {
            error: 'document generation endpoint not found. Please ensure the Python backend is running on port 8000.',
            details: `Backend URL: ${PYTHON_API_BASE}/documents/generate`,
            hint: 'Start the backend with: cd genlatex-agent && python run_api.py',
            message: 'Your credits have been refunded.'
          },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to generate document', details: errorText, message: 'Your credits have been refunded.' },
        { status: response.status }
      );
    }

    const data = await response.json();
    const generationId = data.document_id || data.paper_id || data.id;
    console.log('✅ Document generation started, id:', generationId);

    // Credits already deducted before API call - no additional deduction needed
    console.log(`📝 document generation ${generationId} started, credits already deducted`);

    // Save document id to project metadata so the loading screen can detect it.
    // This write is mandatory: do NOT return success if state cannot be persisted.
    if (!body.project_id) {
      throw new Error('Missing project_id for AI generation metadata persistence');
    }
    try {
      let metadata = {};
      const metadataContent = await readFile(body.project_id, 'project_metadata.json', { encoding: 'utf8' });
      if (metadataContent != null) {
        const str = Buffer.isBuffer(metadataContent) ? metadataContent.toString('utf8') : metadataContent;
        // Use robust recovery to preserve existing metadata even if corrupted
        metadata = parseProjectMetadata(str, `project ${body.project_id}/project_metadata.json`);
      }
      metadata.aiGeneration = {
        documentId: generationId,
        paperId: generationId,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        filesExtracted: false,
        extractedForDocumentId: null,
        extractedForPaperId: null,
        completedAt: null,
        extractionDuration: null,
        retryCount: 0,
        progress: 0,
        phase: 'plan',
        lastChecked: null,
      };
      await writeFile(body.project_id, 'project_metadata.json', JSON.stringify(metadata, null, 2));
      console.log('📝 AI generation metadata saved to project:', body.project_id);
    } catch (error) {
      console.error('❌ Failed to save AI generation metadata:', error.message);
      throw new Error(`Failed to persist AI generation state for project ${body.project_id}: ${error.message}`);
    }
    
    // Return document id and user id for client-side polling (both names for compatibility)
    return NextResponse.json({
      document_id: generationId,
      paper_id: generationId,
      user_id: session.id,
      status: 'started'
    });

  } catch (error) {
    console.error('❌ Proxy error:', error);
    
    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'document generation service timeout - backend did not respond in time' },
        { status: 504 }
      );
    }
    
    if (error.code === 'ECONNREFUSED') {
      return NextResponse.json(
        { error: 'Cannot connect to document generation service - backend may be unavailable' },
        { status: 503 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to connect to document generation service', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * Handle document generation completion and project creation
 */
export async function PUT(request) {
  try {
    console.log('🔄 Handling document generation completion...');
    
    // Check authentication
    const session = await getSessionFromRequest();
    if (!session?.id) {
      console.log('❌ No session');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { documentId, paperId, projectId } = body;
    const generationId = documentId ?? paperId;
    if (!generationId || typeof generationId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid documentId in request body' },
        { status: 400 }
      );
    }
    console.log('📄 Document ID:', generationId);
    console.log('👤 User ID:', session.id);
    console.log('📋 Project ID (if provided):', projectId);
    
    // Try to get project_id from document metadata if not provided
    let finalProjectId = projectId;
    if (!finalProjectId) {
      try {
        const headers = {};
        if (AGENT_API_KEY) {
          headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
        }
        
        // Timeout 30s so we don't abort when backend is busy (same as ai-status)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        let paperStatusResponse = null;
        try {
          paperStatusResponse = await fetch(`${PYTHON_API_BASE}/documents/${generationId}`, { 
            headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          const isConnectionError =
            fetchError.name === 'AbortError' ||
            fetchError.code === 'ECONNREFUSED' ||
            fetchError.message?.includes('fetch failed') ||
            fetchError.cause?.code === 'ECONNREFUSED';
          if (isConnectionError) {
            console.warn(`⚠️ Backend not accessible when fetching document status: ${fetchError.message || fetchError.code}`);
            paperStatusResponse = null; // continue without projectId
          } else {
            throw fetchError;
          }
        }

        if (paperStatusResponse?.ok) {
          const paperStatus = await paperStatusResponse.json();
          if (paperStatus.paper_data?.project_id) {
            finalProjectId = paperStatus.paper_data.project_id;
            console.log('📋 Extracted project_id from paper metadata:', finalProjectId);
          }
        }
      } catch (error) {
        console.warn('⚠️ Could not fetch document status to extract project_id:', error.message);
        // Continue without projectId - this is not critical
      }
    }
    
    // Handle completion and update/create project
    console.log('🏗️ Handling project completion...');
    const result = await handlePaperGenerationCompletion(generationId, session.id, finalProjectId);
    
    if (result.success) {
      console.log('✅ Project handled successfully:', result.project.id);
      console.log('📁 Files extracted:', result.extractionResult.filesExtracted);
      // When using MinIO, push extracted/generated files from local back to MinIO
      if (isMinio() && result.project?.id) {
        await syncProjectFromLocal(result.project.id).catch((err) => console.warn('Sync from local to MinIO after completion:', err.message));
      }
      return NextResponse.json({
        success: true,
        project: result.project,
        extractionResult: result.extractionResult
      });
    } else {
      console.log('⚠️ Project handling failed:', result.message || result.error);
      return NextResponse.json({
        success: false,
        status: result.status,
        message: result.message,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Error handling paper completion:', error);
    return NextResponse.json(
      { error: 'Failed to handle paper completion', details: error.message },
      { status: 500 }
    );
  }
}






