/**
 * API endpoint to check AI generation status and handle completion
 * 
 * When USE_MINIO=true, all file operations go through MinIO storage layer.
 * No local filesystem operations except for absolute necessities (compile).
 */

import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { isMinio, readFile, writeFile, fileExists, syncProjectFromLocal } from '@/lib/files.js';
import { ensureProjectMetadata } from '@/lib/projects-storage.js';
import { parseProjectMetadata } from '@/lib/json-recovery.js';
import { isValidUUID } from '@/lib/user-validation.js';

function normalizeGenerationErrorMessage(rawError) {
  const raw = String(rawError || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (
    lower.includes('insufficient credits') ||
    lower.includes('requires more credits') ||
    lower.includes('payment required') ||
    lower.includes('error code: 402') ||
    lower.includes('code: 402')
  ) {
    return 'Generation provider credits are insufficient. Add credits in your provider account or reduce generation size, then retry.';
  }

  if (lower.includes('paper_credits_exceeded')) {
    return 'No generation credits are available on your plan right now.';
  }

  const quotedMessageMatch = raw.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (quotedMessageMatch?.[1]) {
    return quotedMessageMatch[1].trim();
  }

  return raw;
}

function normalizeProgressMessage(phase, rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return 'Processing...';

  const normalizedPhase = String(phase || '').toLowerCase();
  if (normalizedPhase === 'research') {
    return 'Preparing context and document inputs...';
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('finding and analyzing sources') ||
    lower.includes('comprehensive initial search') ||
    lower.includes('research phase') ||
    lower.includes('pre-selected references')
  ) {
    return 'Preparing context and document inputs...';
  }

  return message;
}

/**
 * Read metadata from storage (MinIO or local filesystem based on config)
 */
async function readMetadata(projectId) {
  try {
    const content = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
    if (!content) {
      return null;
    }
    const str = typeof content === 'string' ? content : content.toString('utf8');
    if (!str || str.trim().length === 0) {
      return null;
    }
    return parseProjectMetadata(str, `project ${projectId}/project_metadata.json`);
  } catch (error) {
    console.warn(`⚠️ Failed to read project metadata for ${projectId}:`, error?.message || error);
    return null;
  }
}

/**
 * Write metadata to storage (MinIO or local filesystem based on config)
 */
async function writeMetadata(projectId, metadata) {
  const content = JSON.stringify(metadata, null, 2);
  await writeFile(projectId, 'project_metadata.json', content);
}

async function safeWriteMetadata(projectId, metadata, context = '') {
  try {
    await writeMetadata(projectId, metadata);
    return true;
  } catch (error) {
    const suffix = context ? ` (${context})` : '';
    console.warn(`⚠️ Failed to write project metadata for ${projectId}${suffix}:`, error?.message || error);
    return false;
  }
}

export async function GET(request, { params }) {
  try {
    const { projectId } = await params;
    const expectingAi = request.nextUrl.searchParams.get('expectingAi') === 'true';
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json(
        { hasAIGeneration: false, message: 'Invalid project id' },
        { status: 404 }
      );
    }

    let access;
    try {
      access = await requireProjectAccess(projectId);
    } catch (error) {
      console.error('⚠️ Project access check failed:', error);
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'error',
        message: 'Authorization check failed',
        error_message: error?.message || 'Authorization check failed'
      });
    }
    if (access instanceof NextResponse) return access;

    // For startup AI checks, avoid creating fallback metadata that may miss aiGeneration context.
    if (!expectingAi) {
      try {
        await ensureProjectMetadata(projectId);
      } catch (error) {
        console.warn(`⚠️ Failed to ensure project metadata for ${projectId}:`, error?.message || error);
      }
    }

    // Read metadata from storage (MinIO when enabled)
    let metadata = await readMetadata(projectId);
    
    if (!metadata && !expectingAi) {
      // Try to recreate from database
      console.warn(`⚠️ Metadata not found for ${projectId}, attempting to recreate`);
      try {
        await ensureProjectMetadata(projectId);
      } catch (error) {
        console.warn(`⚠️ Failed to recreate project metadata for ${projectId}:`, error?.message || error);
      }
      metadata = await readMetadata(projectId);
      
    if (!metadata) {
      if (expectingAi) {
        return NextResponse.json({
          hasAIGeneration: true,
          status: 'not_ready',
          retriable: true,
          message: 'Project metadata is still initializing'
        });
      }
      console.error(`❌ Could not read or create metadata for ${projectId}`);
      return NextResponse.json({
        hasAIGeneration: false,
        message: 'Project metadata not found'
      }, { status: 404 });
      }
    }
    
    if (!metadata.aiGeneration || typeof metadata.aiGeneration !== 'object' || Array.isArray(metadata.aiGeneration)) {
      if (expectingAi) {
        return NextResponse.json({
          hasAIGeneration: true,
          status: 'not_ready',
          retriable: true,
          message: 'AI generation metadata not yet available'
        });
      }
      return NextResponse.json({ 
        hasAIGeneration: false,
        message: 'No AI generation found for this project'
      });
    }
    
    const paperId = metadata.aiGeneration.documentId || metadata.aiGeneration.paperId;
    const status = metadata.aiGeneration.status;
    if (!paperId) {
      if (expectingAi) {
        return NextResponse.json({
          hasAIGeneration: true,
          status: 'not_ready',
          retriable: true,
          message: 'AI generation is initializing (document id pending)'
        });
      }
      delete metadata.aiGeneration;
      await safeWriteMetadata(projectId, metadata, 'clear empty paperId');
      return NextResponse.json({
        hasAIGeneration: false,
        message: 'No AI generation found for this project'
      });
    }
    const lastChecked = metadata.aiGeneration.lastChecked ? new Date(metadata.aiGeneration.lastChecked) : null;
    const startedAt = metadata.aiGeneration.startedAt ? new Date(metadata.aiGeneration.startedAt) : null;
    
    // Check generation status from Python API
    const genlatexAgentUrl = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    const agentHeaders = agentToken ? { 'Authorization': `Bearer ${agentToken}` } : {};
    let response;
    try {
      // Timeout 30s so we don't abort when backend is busy (e.g. humanization)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      try {
        response = await fetch(`${genlatexAgentUrl}/documents/${paperId}`, {
          signal: controller.signal,
          headers: agentHeaders
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (fetchError) {
      // Only clear generation ID when backend is definitely down (ECONNREFUSED)
      const backendDefinitelyDown =
        fetchError.code === 'ECONNREFUSED' ||
        fetchError.cause?.code === 'ECONNREFUSED';
      
      if (backendDefinitelyDown && !expectingAi) {
        console.warn(`⚠️ Backend not accessible at ${genlatexAgentUrl} (${fetchError.message || fetchError.code}) - clearing stale generation ID`);
        delete metadata.aiGeneration;
        await safeWriteMetadata(projectId, metadata, 'clear stale paperId (backend down)');
        return NextResponse.json({
          hasAIGeneration: false,
          message: 'Backend service unavailable - generation tracking cleared',
          cleared: true
        });
      }
      if (backendDefinitelyDown && expectingAi) {
        return NextResponse.json({
          hasAIGeneration: true,
          status: 'not_ready',
          retriable: true,
          message: 'Backend is starting up, retrying status check',
          paperId: paperId,
          documentId: paperId
        });
      }
      // Timeout or other transient error: keep generation ID and return error so UI can retry
      console.warn(`⚠️ Backend status check failed (${fetchError.name || fetchError.code}) - keeping generation ID for retry`);
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'in_progress',
        retriable: true,
        phase: metadata.aiGeneration?.phase || 'writing',
        progress: metadata.aiGeneration?.progress || 0,
        message: fetchError.name === 'AbortError'
          ? 'Backend is busy processing your document. Retrying status check...'
          : 'Temporary status check issue. Retrying...',
        error_message: null,
        paperId: paperId,
        documentId: paperId,
        filesExtracted: false
      });
    }
    
    if (!response.ok) {
      // If paper not found (404), check if we should clear it
      if (response.status === 404) {
        if (expectingAi && status === 'in_progress') {
          return NextResponse.json({
            hasAIGeneration: true,
            status: 'not_ready',
            retriable: true,
            message: 'AI generation status is warming up',
            paperId: paperId,
            documentId: paperId
          });
        }
        const now = new Date();
        const isCompletedOrFailed = status === 'completed' || status === 'failed' || status === 'error';
        const isOldInProgress = status === 'in_progress' && startedAt && (now - startedAt) > 60 * 60 * 1000; // 1 hour
        const hasBeenCheckedMultipleTimes = lastChecked && (now - lastChecked) > 5 * 60 * 1000; // 5 minutes since last check
        
        // Only clear if it's safe to do so
        if (isCompletedOrFailed || isOldInProgress || (hasBeenCheckedMultipleTimes && status === 'in_progress')) {
          console.log(`⚠️ Generation ${paperId} not found (404) - clearing stale generation ID from metadata (status: ${status})`);
          delete metadata.aiGeneration;
          await safeWriteMetadata(projectId, metadata, 'clear stale paperId (404)');
          return NextResponse.json({
            hasAIGeneration: false,
            message: 'Document generation no longer exists (backend may have been restarted)',
            cleared: true
          });
        } else {
          // Generation might be actively running - do not clear yet.
          console.log(`⚠️ Generation ${paperId} not found (404) but appears active - keeping metadata for now`);
          metadata.aiGeneration.lastChecked = new Date().toISOString();
          metadata.aiGeneration.retryCount = (metadata.aiGeneration.retryCount || 0) + 1;
          await safeWriteMetadata(projectId, metadata, 'mark retry (404)');
          
          // If we've retried many times, it's probably stale
          if (metadata.aiGeneration.retryCount > 10) {
            console.log(`⚠️ Generation ${paperId} has been checked 10+ times with 404 - clearing as stale`);
            delete metadata.aiGeneration;
            await safeWriteMetadata(projectId, metadata, 'clear stale paperId (retry limit)');
            return NextResponse.json({
              hasAIGeneration: false,
              message: 'Document generation no longer exists after multiple checks',
              cleared: true
            });
          }
          
          return NextResponse.json({
            hasAIGeneration: true,
            status: 'not_ready',
            retriable: true,
            message: 'Generation status is temporarily unavailable. Retrying...',
            paperId: paperId,
            documentId: paperId,
            retryCount: metadata.aiGeneration.retryCount
          });
        }
      }
      
      // For other errors, keep generation state retriable instead of failing hard.
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'in_progress',
        retriable: true,
        phase: metadata.aiGeneration?.phase || 'writing',
        progress: metadata.aiGeneration?.progress || 0,
        message: `Status endpoint returned ${response.status}. Retrying...`,
        error_message: null,
        paperId: paperId,
        documentId: paperId,
        filesExtracted: false
      });
    }
    
    // Reset retry count on successful fetch
    if (metadata.aiGeneration.retryCount) {
      metadata.aiGeneration.retryCount = 0;
    }
    
    const responseText = await response.text();
    let paperStatus;
    try {
      paperStatus = responseText ? JSON.parse(responseText) : null;
    } catch (parseError) {
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'in_progress',
        retriable: true,
        phase: metadata.aiGeneration?.phase || 'writing',
        progress: metadata.aiGeneration?.progress || 0,
        message: 'Received an incomplete status payload. Retrying...',
        error_message: null,
        paperId: paperId,
        documentId: paperId,
        filesExtracted: false
      });
    }
    
    if (!paperStatus || typeof paperStatus !== 'object') {
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'in_progress',
        retriable: true,
        phase: metadata.aiGeneration?.phase || 'writing',
        progress: metadata.aiGeneration?.progress || 0,
        message: 'Status payload was empty. Retrying...',
        error_message: null,
        paperId: paperId,
        documentId: paperId,
        filesExtracted: false
      });
    }
    
    const backendPaperId = paperStatus.document_id || paperStatus.paper_id || paperStatus.documentId || paperStatus.paperId || null;
    if (backendPaperId && backendPaperId !== paperId) {
      console.warn(`⚠️ Backend status paper id mismatch for project ${projectId}: metadata=${paperId}, backend=${backendPaperId}`);
      return NextResponse.json({
        hasAIGeneration: true,
        status: 'not_ready',
        retriable: true,
        message: 'AI generation cycle is synchronizing, retrying status check',
        paperId,
        documentId: paperId,
        filesExtracted: false,
        cycle: {
          paperId,
          documentId: paperId,
          status: 'not_ready',
          filesExtracted: false
        }
      });
    }

    // Update project metadata with current status
    metadata.aiGeneration.documentId = paperId;
    metadata.aiGeneration.status = paperStatus.status;
    metadata.aiGeneration.lastChecked = new Date().toISOString();
    
    if (paperStatus.phase) {
      metadata.aiGeneration.phase = paperStatus.phase;
    }
    
    if (paperStatus.progress) {
      metadata.aiGeneration.progress = paperStatus.progress;
    }
    
    const statusValue = String(paperStatus.status || '').toLowerCase();
    const errorMessage = paperStatus.error_message || paperStatus.error || null;
    const normalizedErrorMessage = normalizeGenerationErrorMessage(errorMessage);
    const extractedForPaperId =
      metadata.aiGeneration.extractedForDocumentId ||
      metadata.aiGeneration.extractedForPaperId ||
      null;
    const rawFilesExtracted = metadata.aiGeneration.filesExtracted || false;
    const filesExtractedForCurrentCycle = extractedForPaperId === paperId ? rawFilesExtracted : false;

    // Completed when status is 'completed', or progress 100% / phase complete (backend may lag)
    const progressAt100 = paperStatus.progress >= 99 || paperStatus.progress === 100;
    const phaseComplete = paperStatus.phase === 'complete';
    const statusComplete = statusValue === 'completed';
    const isActuallyCompleted = statusComplete || (progressAt100 && phaseComplete);
    
    await safeWriteMetadata(projectId, metadata, 'update status');

    const displayMessage = (errorMessage && ['failed', 'error'].includes(statusValue))
      ? (normalizedErrorMessage || errorMessage)
      : normalizeProgressMessage(
          paperStatus.phase,
          paperStatus.message || paperStatus.phase || 'Processing...'
        );
    
    return NextResponse.json({
      hasAIGeneration: true,
      status: paperStatus.status,
      phase: paperStatus.phase,
      progress: paperStatus.progress,
      message: displayMessage,
      error_message: normalizedErrorMessage || errorMessage,
      paperId: paperId,
      documentId: paperId,
      filesExtracted: filesExtractedForCurrentCycle,
      isActuallyCompleted: isActuallyCompleted,
      cycle: {
        paperId,
        documentId: paperId,
        status: paperStatus.status,
        filesExtracted: filesExtractedForCurrentCycle
      }
    });
    
  } catch (error) {
    console.error('Error checking AI status:', error);
    return NextResponse.json(
      {
        hasAIGeneration: true,
        status: 'error',
        message: 'Failed to check AI generation status',
        error_message: error?.message || 'Failed to check AI generation status'
      }
    );
  }
}

export async function POST(request, { params }) {
  const startTime = Date.now();

  try {
    const { projectId } = await params;
    if (!projectId || !isValidUUID(projectId)) {
      return NextResponse.json({ error: 'Invalid project id' }, { status: 404 });
    }
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📥 FILE EXTRACTION STARTED');
    console.log(`Project ID: ${projectId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Read metadata from storage (MinIO when enabled)
    const metadata = await readMetadata(projectId);
    
    if (!metadata) {
      console.error(`❌ Could not read metadata for ${projectId}`);
      return NextResponse.json({ error: 'Project metadata not found' }, { status: 404 });
    }

    const paperId = metadata.aiGeneration?.documentId || metadata.aiGeneration?.paperId;

    if (!paperId) {
      return NextResponse.json({ error: 'No AI generation found for this project' }, { status: 404 });
    }

    console.log(`📋 Generation ID: ${paperId}`);

    // Handle generation completion - extract files to existing project
    const genlatexAgentUrl = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    const agentHeaders = agentToken ? { 'Authorization': `Bearer ${agentToken}` } : {};
    try {
      console.log(`🔗 Fetching from: ${genlatexAgentUrl}/documents/${paperId}`);

      const response = await fetch(`${genlatexAgentUrl}/documents/${paperId}`, { headers: agentHeaders });

      if (!response.ok) {
        throw new Error(`Failed to get generation status: ${response.status}`);
      }

      const paperStatus = await response.json();
      console.log(`📊 Generation status: ${paperStatus.status}`);
      console.log(`📈 Progress: ${paperStatus.progress}%`);

      if (paperStatus.status === 'completed') {
        console.log('📦 Downloading ZIP file...');
        const zipUrl = `${genlatexAgentUrl}/documents/${paperId}/download-all`;
        console.log(`🔗 ZIP URL: ${zipUrl}`);

        const zipResponse = await fetch(zipUrl, { headers: agentHeaders });

        if (!zipResponse.ok) {
          throw new Error(`Failed to download generated files: ${zipResponse.status}`);
        }

        const zipBuffer = await zipResponse.arrayBuffer();
        console.log(`📦 ZIP downloaded: ${zipBuffer.byteLength} bytes`);

        // Validate ZIP
        if (zipBuffer.byteLength === 0) {
          console.error('❌ ZIP file is EMPTY (0 bytes)');
          throw new Error('Downloaded ZIP file is empty');
        }

        // Check ZIP magic bytes (50 4B 03 04)
        const zipView = new Uint8Array(zipBuffer);
        const isValidZip = (
          zipView[0] === 0x50 &&
          zipView[1] === 0x4B &&
          zipView[2] === 0x03 &&
          zipView[3] === 0x04
        );

        if (!isValidZip) {
          console.error('❌ Invalid ZIP magic bytes:', Array.from(zipView.slice(0, 4)));
          throw new Error('Downloaded file is not a valid ZIP');
        }

        console.log('✅ ZIP file is valid');

        console.log('📂 Extracting files to project...');
        const { extractPaperFilesToProject } = await import('@/lib/paper-project-integration.js');
        const extractionResult = await extractPaperFilesToProject(projectId, zipBuffer);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 EXTRACTION RESULTS');
        console.log(`Success: ${extractionResult.success}`);
        console.log(`Files extracted: ${extractionResult.filesExtracted}`);
        console.log(`main.tex found: ${extractionResult.mainTexFound}`);
        console.log(`Duration: ${Date.now() - startTime}ms`);
        if (extractionResult.files) {
          console.log('📄 Extracted files:');
          extractionResult.files.forEach(f => {
            console.log(`   - ${f.name} (${f.size} bytes)`);
          });
        }
        if (extractionResult.errors && extractionResult.errors.length > 0) {
          console.log('⚠️  Errors:');
          extractionResult.errors.forEach(e => console.log(`   - ${e}`));
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        if (!extractionResult.success) {
          throw new Error(extractionResult.error || 'Extraction failed');
        }

        // Sync extracted files to MinIO (extraction writes to local filesystem)
        if (isMinio()) {
          console.log('📤 Syncing extracted files to MinIO...');
          const syncResult = await syncProjectFromLocal(projectId);
          console.log(`📤 Sync complete: ${syncResult.synced} files uploaded to MinIO`);
        }

        // Update project metadata to mark AI generation as completed
        metadata.aiGeneration.status = 'completed';
        metadata.aiGeneration.completedAt = new Date().toISOString();
        metadata.aiGeneration.filesExtracted = extractionResult.filesExtracted;
        metadata.aiGeneration.documentId = paperId;
        metadata.aiGeneration.extractedForDocumentId = paperId;
        metadata.aiGeneration.extractedForPaperId = paperId;
        metadata.aiGeneration.extractionDuration = Date.now() - startTime;

        await writeMetadata(projectId, metadata);
        console.log('✅ Metadata updated in storage');

        return NextResponse.json({
          success: true,
          message: 'AI generation completed and files extracted',
          paperId,
          documentId: paperId,
          filesExtracted: extractionResult.filesExtracted,
          extractedForDocumentId: paperId,
          extractedForPaperId: paperId,
          mainTexFound: extractionResult.mainTexFound,
          files: extractionResult.files
        });
      } else {
        console.log('⏳ Generation not yet completed, skipping extraction');
        return NextResponse.json({
          success: false,
          error: 'Document generation not completed yet'
        });
      }
    } catch (error) {
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ FILE EXTRACTION FAILED');
      console.error(`Error: ${error.message}`);
      console.error(`Stack: ${error.stack}`);
      console.error(`Duration: ${Date.now() - startTime}ms`);
      console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return NextResponse.json({
        success: false,
        error: error.message,
        technicalDetails: error.stack
      }, { status: 500 });
    }

  } catch (error) {
    console.error('Error completing AI generation:', error);
    return NextResponse.json(
      { error: 'Failed to complete AI generation' },
      { status: 500 }
    );
  }
}
