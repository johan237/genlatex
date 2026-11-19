// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { getUserProjects, createProject } from '@/lib/projects-storage.js';
import { getUserZotero, getUser } from '@/lib/db.js';
import { STORAGE_LIMITS, formatBytes } from '@/lib/storage-limits.js';
import { GitHubIntegration } from '@/lib/github-integration.js';
// FileContentProcessor and LaTeXGenerator moved to backend - now using API call
import { canCreateProject } from '@/lib/subscription-plans.js';
import { TemplateParser } from '@/lib/template-parser.js';
import { parseProjectMetadata } from '@/lib/json-recovery.js';
import { buildDocumentInstructionBlock, resolveDocumentConfig } from '@/lib/document-config.js';
import { fetchOnlineTemplateBundle, saveOnlineTemplateBundle } from '@/lib/online-template-fetcher.js';
import fs from 'fs/promises';
import path from 'path';
import { getProjectPath, isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import JSZip from 'jszip';

const execAsync = promisify(exec);

/**
 * Unwrap single root folder: if extractPath contains exactly one directory and no files,
 * move its contents up to extractPath to avoid project/zipname/zipname/ nesting and duplicates.
 */
async function unwrapSingleRootFolder(extractPath) {
  try {
    const entries = await fs.readdir(extractPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
    const files = entries.filter(e => e.isFile());
    if (dirs.length === 1 && files.length === 0) {
      const innerDir = path.join(extractPath, dirs[0].name);
      const innerEntries = await fs.readdir(innerDir, { withFileTypes: true });
      for (const entry of innerEntries) {
        const src = path.join(innerDir, entry.name);
        const dest = path.join(extractPath, entry.name);
        await fs.rename(src, dest);
      }
      await fs.rm(innerDir, { recursive: true, force: true });
      console.log(`📦 Unwrapped single root folder: ${dirs[0].name}`);
    }
  } catch (err) {
    console.warn('Could not unwrap single root folder:', err.message);
  }
}

// Helper function to find template files in a directory
async function findTemplateFiles(dir, extensions = ['.tex', '.sty', '.cls', '.bib']) {
  const files = [];
  const maxDepth = 3;
  
  const walkDir = async (currentPath, depth = 0) => {
    if (depth > maxDepth) return;
    
    try {
      const entries = await fs.readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          await walkDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not read directory ${currentPath}:`, error.message);
    }
  };
  
  await walkDir(dir);
  return files;
}

function buildSelectedReferencesGuide(selectedReferences) {
  if (!Array.isArray(selectedReferences) || selectedReferences.length === 0) {
    return '';
  }

  const referencesList = selectedReferences
    .slice(0, 30)
    .map((ref, index) => {
      const title = String(ref?.title || 'Untitled reference').trim();
      const year = ref?.year ? ` (${ref.year})` : '';
      return `${index + 1}. ${title}${year}`;
    });

  return [
    'SOURCE USAGE REQUIREMENTS:',
    `- Use the ${selectedReferences.length} selected sources as primary context for this document.`,
    '- Use source evidence only where relevant to the requested document type and user prompt.',
    '- Avoid introducing unrelated external references unless needed for minimal context.',
    '- Selected references:',
    ...referencesList
  ].join('\n');
}

// Helper function to process project content and generate LaTeX
async function processProjectContent(projectPath, projectData, metadata, templateData = null) {
  try {
    console.log('📊 Processing project content for LaTeX generation...');
    
    if (templateData) {
      console.log('📋 Using template for LaTeX generation');
    }
    
    // Call backend API for LaTeX generation from files
    const baseUrl = process.env.GENLATEX_AGENT_URL || process.env.NEXT_PUBLIC_GENLATEX_AGENT_URL || 'http://localhost:8000';
    
    const requestBody = {
      projectId: projectData.id,
      projectPath: projectPath,
      projectData: {
        id: projectData.id,
        name: projectData.name,
        description: projectData.description,
        type: projectData.type
      },
      metadata: {
        type: metadata.type || 'document',
        description: metadata.description
      },
      templateData: templateData ? {
        content: templateData.content,
        parsed: templateData.parsed,
        path: templateData.path
      } : null
    };
    
    console.log('📤 Calling backend API for LaTeX generation...');
    const agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    const response = await fetch(`${baseUrl}/api/generate-latex-from-files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(agentToken ? { 'Authorization': `Bearer ${agentToken}` } : {}),
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backend LaTeX generation failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.success) {
      console.log('✅ LaTeX generation successful');
      
      // Update project metadata
      const metadataPath = path.join(projectPath, 'project_metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
      
      existingMetadata.contentProcessed = true;
      existingMetadata.contentSummary = {
        totalFiles: result.contentSummary.totalFiles,
        processedFiles: result.contentSummary.processedFiles,
        fileTypes: result.contentSummary.fileTypes,
        references: result.contentSummary.references,
        keyFiles: result.contentSummary.keyFiles,
        wordCount: result.metadata.wordCount,
        sections: result.metadata.sections
      };
      existingMetadata.latexGenerated = true;
      existingMetadata.latexGeneratedAt = new Date().toISOString();
      existingMetadata.generationMetadata = result.metadata;
      
      await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
      
      return {
        success: true,
        contentSummary: result.contentSummary,
        latexResult: {
          success: true,
          latex: result.latex,
          metadata: result.metadata
        },
        message: result.message || 'Project content processed and LaTeX generated successfully'
      };
    } else {
      throw new Error(result.error || 'LaTeX generation failed');
    }
    
  } catch (error) {
    console.error('❌ Error processing project content:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to process project content'
    };
  }
}

// Helper function to process uploaded files
async function processUploadedFiles(projectPath, uploadedFiles, uploadedTemplate) {
  const processedFiles = [];

  // Ensure the local project directory exists (required for MinIO mode where local FS is used for temp extraction)
  await fs.mkdir(projectPath, { recursive: true });
  
  // Process uploaded files
  if (uploadedFiles && uploadedFiles.length > 0) {
    console.log('📁 Processing uploaded files:', uploadedFiles.length);
    console.log('📁 Uploaded files data:', uploadedFiles);
    
    for (const file of uploadedFiles) {
      // Check if file is a valid File object or has the necessary properties
      if (file && (file instanceof File || (file.name && file.size !== undefined))) {
        const fileName = file.name;
        const filePath = path.join(projectPath, fileName);
        
        // Handle ZIP files - extract them directly to project root (no nested folder)
        if (fileName.toLowerCase().endsWith('.zip')) {
          console.log('📦 Extracting ZIP file:', fileName);
          try {
            // Save ZIP file temporarily
            const zipPath = path.join(projectPath, fileName);
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(zipPath, buffer);
            
            // Extract ZIP file directly to project root (not a subfolder)
            const extractPath = projectPath;
            
            // Use unzip command to extract (with Windows compatibility)
            try {
              await execAsync(`unzip -q -o "${zipPath}" -d "${extractPath}"`);
            } catch (unzipError) {
              // Fallback: try PowerShell on Windows
              if (process.platform === 'win32') {
                try {
                  await execAsync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`);
                } catch (powershellError) {
                  // Final fallback: use JSZip
                  console.log('🔄 Using JSZip fallback for ZIP extraction');
                  const zip = new JSZip();
                  const zipContent = await fs.readFile(zipPath);
                  const zipData = await zip.loadAsync(zipContent);
                  
                  for (const [relativePath, zipFile] of Object.entries(zipData.files)) {
                    if (!zipFile.dir) {
                      // Zip-Slip mitigation: sanitize path
                      const normalized = path.normalize(relativePath).replace(/^\/+/, '');
                      if (normalized.includes('..') || path.isAbsolute(normalized)) continue;
                      const fullPath = path.join(extractPath, normalized);
                      if (!fullPath.startsWith(extractPath)) continue;
                      const parentDir = path.dirname(fullPath);
                      await fs.mkdir(parentDir, { recursive: true });
                      const content = await zipFile.async('nodebuffer');
                      await fs.writeFile(fullPath, content);
                    }
                  }
                }
              } else {
                throw unzipError;
              }
            }
            
            // Remove the ZIP file after extraction
            await fs.unlink(zipPath);

            // Unwrap single root folder if ZIP created one (move contents up)
            await unwrapSingleRootFolder(extractPath);
            
            console.log('✅ ZIP file extracted to:', extractPath);
            processedFiles.push({
              name: fileName,
              type: 'zip',
              extracted: true,
              path: extractPath
            });
          } catch (error) {
            console.error('❌ Failed to extract ZIP file:', error);
            // Fallback: save as regular file
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(filePath, buffer);
            processedFiles.push({
              name: fileName,
              type: 'file',
              path: filePath
            });
          }
        } else {
          // Regular file - save directly
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          await fs.writeFile(filePath, buffer);
          
          console.log('📄 Saved file:', fileName);
          processedFiles.push({
            name: fileName,
            type: 'file',
            path: filePath
          });
        }
      }
    }
  }
  
  // Process uploaded template files - save to template/ subfolder
  if (uploadedTemplate && uploadedTemplate.length > 0) {
    console.log('📁 Processing uploaded template files:', uploadedTemplate.length);
    
    // Create template subfolder
    const templatePath = path.join(projectPath, 'template');
    await fs.mkdir(templatePath, { recursive: true });
    console.log('📁 Created template folder:', templatePath);
    
    for (const file of uploadedTemplate) {
      if (file instanceof File) {
        const fileName = file.name;
        const filePath = path.join(templatePath, fileName);
        
        // Handle ZIP files in templates
        if (fileName.toLowerCase().endsWith('.zip')) {
          console.log('📦 Extracting template ZIP file:', fileName);
          try {
            // Save ZIP file temporarily in template folder
            const zipPath = path.join(templatePath, fileName);
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(zipPath, buffer);
            
            // Extract ZIP file DIRECTLY to template folder (not a subfolder)
            // This avoids template/zipname/ nesting - files go directly to template/
            const extractPath = templatePath;
            
            // Use unzip command to extract (with Windows compatibility)
            try {
              await execAsync(`unzip -q -o "${zipPath}" -d "${extractPath}"`);
            } catch (unzipError) {
              // Fallback: try PowerShell on Windows
              if (process.platform === 'win32') {
                try {
                  await execAsync(`powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`);
                } catch (powershellError) {
                  // Final fallback: use JSZip
                  console.log('🔄 Using JSZip fallback for ZIP extraction');
                  const zip = new JSZip();
                  const zipContent = await fs.readFile(zipPath);
                  const zipData = await zip.loadAsync(zipContent);
                  
                  for (const [relativePath, zipFile] of Object.entries(zipData.files)) {
                    if (!zipFile.dir) {
                      // Zip-Slip mitigation: sanitize path
                      const normalized = path.normalize(relativePath).replace(/^\/+/, '');
                      if (normalized.includes('..') || path.isAbsolute(normalized)) continue;
                      const fullPath = path.join(extractPath, normalized);
                      if (!fullPath.startsWith(extractPath)) continue;
                      const parentDir = path.dirname(fullPath);
                      await fs.mkdir(parentDir, { recursive: true });
                      const content = await zipFile.async('nodebuffer');
                      await fs.writeFile(fullPath, content);
                    }
                  }
                }
              } else {
                throw unzipError;
              }
            }
            
            // Unwrap single root folder: if ZIP created a single folder, move contents up
            await unwrapSingleRootFolder(extractPath);

            // Delete the ZIP file after extraction - no longer needed
            try {
              await fs.unlink(zipPath);
              console.log('🗑️ Deleted ZIP file after extraction:', fileName);
            } catch (deleteErr) {
              console.warn('⚠️ Could not delete ZIP file:', deleteErr.message);
            }
            
            console.log('✅ Template ZIP extracted to:', extractPath);
            processedFiles.push({
              name: fileName,
              type: 'template-zip',
              extracted: true,
              path: extractPath // Points directly to template/ folder
            });
          } catch (error) {
            console.error('❌ Failed to extract template ZIP file:', error);
            // Fallback: save as regular file in template folder
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            await fs.writeFile(filePath, buffer);
            processedFiles.push({
              name: fileName,
              type: 'template-file',
              path: filePath
            });
          }
        } else {
          // Regular template file - save directly to template folder
          const arrayBuffer = await file.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          await fs.writeFile(filePath, buffer);
          
          console.log('📄 Saved template file to template folder:', fileName);
          processedFiles.push({
            name: fileName,
            type: 'template-file',
            path: filePath
          });
        }
      }
    }
  }
  
  return processedFiles;
}

export async function GET() {
  try {
    console.log('🔍 GET /api/projects called');
    const session = await getSessionFromRequest();
    console.log('🍪 Session:', session ? 'exists' : 'missing');

    if (!session?.id) {
      console.log('❌ No session');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Fetch projects for user (owned + shared/collaborator projects)
    // Pass email for matching shared projects by email
    console.log('📁 Fetching projects for user:', session.id);
    const projects = await getUserProjects(session.id, session.email || null);
    console.log(`📋 Projects found: ${projects.length} (owned + shared)`);

    return NextResponse.json(projects);
  } catch (e) {
    console.error('❌ Projects GET error:', e);
    return new NextResponse('Error listing projects', { status: 500 });
  }
}

export async function POST(request) {
  try {
    console.log('🔍 POST /api/projects called');
    const session = await getSessionFromRequest();
    console.log('🍪 Session:', session ? 'exists' : 'missing');
    
    if (!session?.id) {
      console.log('❌ No session');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    // Check subscription limits and pro status (for fast_mode enforcement)
    let isProUser = false;
    try {
      const { canUserCreateProject } = await import('@/lib/user-subscription.js');
      const canCreate = await canUserCreateProject(session.id);
      isProUser = canCreate?.isPro ?? false;
      
      if (!canCreate.allowed) {
        return NextResponse.json({
          success: false,
          error: 'Project limit reached. Upgrade to Pro for unlimited projects.',
          subscription: {
            projectCount: canCreate.projectCount,
            maxProjects: canCreate.maxProjects,
            isPro: canCreate.isPro
          },
          upgradeRequired: true
        }, { status: 403 });
      }
    } catch (error) {
      console.error('Error checking subscription:', error);
      // Continue with project creation if subscription check fails
    }
    
    // Handle both JSON and FormData requests
    let body, name, projectType, metadata;
    
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle FormData
      const formData = await request.formData();
      console.log('📝 FormData received');
      
      name = (formData.get('name') || '').trim();
      projectType = formData.get('type') || 'document';
      
      // Extract metadata from form data
      const useAIGeneration = formData.get('useAIGeneration') === 'true';
      const specialInstructions = formData.get('specialInstructions');
      const workflowMode = formData.get('workflowMode') || (useAIGeneration ? 'ai_generate' : 'manual');
      const fastMode = formData.get('fast_mode') !== 'false';

      // Extract selected references for document generation
      const selectedReferencesRaw = formData.get('selectedReferences');
      let selectedReferences = null;
      if (selectedReferencesRaw) {
        try {
          const parsed = JSON.parse(String(selectedReferencesRaw));
          selectedReferences = Array.isArray(parsed) ? parsed : null;
          if (selectedReferences) {
            console.log(`📚 Selected references: ${selectedReferences.length} articles`);
          }
        } catch (error) {
          console.error('Failed to parse selectedReferences:', error);
          selectedReferences = null;
        }
      }

      const requestedDocumentType = String(formData.get('documentType') || '').trim() || null;
      const requestedDocumentTemplate = String(formData.get('documentTemplate') || '').trim() || null;
      const requestedDocumentSchemaId = String(formData.get('documentSchemaId') || '').trim() || null;
      const resolvedDocumentConfig = resolveDocumentConfig(
        requestedDocumentType || undefined,
        requestedDocumentTemplate
      );
      const resolvedDocumentType = resolvedDocumentConfig?.type?.id || requestedDocumentType || 'article';
      const resolvedDocumentTemplate = resolvedDocumentConfig?.template?.id || requestedDocumentTemplate || null;
      const resolvedDocumentSchemaId = requestedDocumentSchemaId || resolvedDocumentConfig?.schema?.id || null;
      const resolvedDocumentTypeLabel = resolvedDocumentConfig?.type?.label || 'Document';
      const resolvedDocumentTemplateLabel = resolvedDocumentConfig?.template?.label || 'Default template';

      metadata = {
        description: formData.get('description') || '',
        template: formData.get('template') || 'basic',
        githubLink: formData.get('githubLink') || '',
        githubToken: formData.get('githubToken') || '',
        editor: formData.get('editor') || 'latex',
        tempProjectId: formData.get('tempProjectId') || null,
        type: projectType, // Add project type to metadata
        useAIGeneration: useAIGeneration,
        workflowMode,
        selectedReferences,
        documentType: resolvedDocumentType,
        documentTemplate: resolvedDocumentTemplate,
        documentSchemaId: resolvedDocumentSchemaId,
        documentProfile: {
          typeLabel: resolvedDocumentTypeLabel,
          templateLabel: resolvedDocumentTemplateLabel
        },
        fast_mode: useAIGeneration ? fastMode : true,
        specialInstructions: specialInstructions && specialInstructions.trim() ? specialInstructions.trim() : null,
        zoteroLibraryId: formData.get('zoteroLibraryId') || null,
        zoteroCollectionKey: formData.get('zoteroCollectionKey') || null,
        zoteroLibraryType: formData.get('zoteroLibraryType') || 'user'
      };

      if (specialInstructions && specialInstructions.trim()) {
        console.log('📝 Special instructions provided:', specialInstructions.substring(0, 100) + '...');
      }
      
      // Extract uploaded files
      const uploadedFiles = formData.getAll('uploadedFiles');
      const uploadedTemplate = formData.getAll('uploadedTemplate');
      
      metadata.uploadedFiles = uploadedFiles.filter(file => file instanceof File);
      metadata.uploadedTemplate = uploadedTemplate.filter(file => file instanceof File);
      
      console.log('📁 Uploaded files:', metadata.uploadedFiles.length);
      console.log('📁 Uploaded templates:', metadata.uploadedTemplate.length);
      
    } else {
      // Handle JSON (fallback)
      body = await request.json();
      console.log('📝 Request body:', body);
      name = (body.name || '').trim();
      projectType = body.type || 'document';
      const requestedDocumentType = body?.metadata?.documentType || body?.documentType || 'article';
      const requestedDocumentTemplate = body?.metadata?.documentTemplate || body?.documentTemplate || null;
      const resolvedDocumentConfig = resolveDocumentConfig(requestedDocumentType, requestedDocumentTemplate);
      metadata = {
        ...body.metadata,
        type: projectType, // Ensure type is included in metadata
        documentType: resolvedDocumentConfig?.type?.id || requestedDocumentType || 'article',
        documentTemplate: resolvedDocumentConfig?.template?.id || requestedDocumentTemplate || null,
        documentSchemaId: body?.metadata?.documentSchemaId || resolvedDocumentConfig?.schema?.id || null,
        documentProfile: {
          typeLabel: resolvedDocumentConfig?.type?.label || 'Document',
          templateLabel: resolvedDocumentConfig?.template?.label || 'Default template'
        }
      };
    }
    
    if (!name) {
      console.log('❌ Missing project name');
      return NextResponse.json({
        success: false,
        error: 'Missing required field: name',
        field: 'name',
        message: 'Project name is required to create a new project'
      }, { status: 400 });
    }

    // Validate uploaded file sizes before creating project
    const uploadedFiles = metadata.uploadedFiles || [];
    const uploadedTemplate = metadata.uploadedTemplate || [];
    const allUploads = [...uploadedFiles, ...uploadedTemplate].filter(f => f instanceof File);
    if (allUploads.length > 0) {
      const totalUploadSize = allUploads.reduce((sum, f) => sum + (f.size || 0), 0);
      const user = await getUser(session.id);
      const limits = user?.is_pro ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;
      if (totalUploadSize > limits.maxProjectTotal) {
        return NextResponse.json({
          success: false,
          error: 'upload_exceeds_project_limit',
          message: `Total upload size exceeds project limit of ${formatBytes(limits.maxProjectTotal)}`
        }, { status: 413 });
      }
    }
    
    // Create project in file storage
    console.log('📁 Creating project for user:', session.id, 'with name:', name, 'type:', projectType);
    const project = await createProject(session.id, name, {
      type: projectType,
      metadata: metadata,
      createdAt: new Date().toISOString()
    });
    console.log(`📄 Created project: ${project.name} (ID: ${project.id})`);

    // MinIO: sync from object storage to local before any fs operations
    if (isMinio()) {
      await syncProjectToLocal(project.id).catch((err) =>
        console.warn('[projects] syncProjectToLocal before processing:', err?.message)
      );
    }

    // Process uploaded files immediately after project creation
    const projectPath = getProjectPath(session.id, project.id);
    const processedFiles = await processUploadedFiles(projectPath, metadata.uploadedFiles, metadata.uploadedTemplate);
    console.log('📁 Processed files:', processedFiles.length);

    // Auto-fetch online template when user did not upload one.
    const hasUserTemplateFiles = processedFiles.some((file) => file.type === 'template-file' || file.type === 'template-zip');
    const onlineTemplateFetchEnabled = String(process.env.GENLATEX_ENABLE_ONLINE_TEMPLATE_FETCH ?? 'true').toLowerCase() !== 'false';
    if (metadata.useAIGeneration && onlineTemplateFetchEnabled && !hasUserTemplateFiles) {
      try {
        const maxRepoCandidatesRaw = parseInt(process.env.GENLATEX_ONLINE_TEMPLATE_MAX_REPOS || '4', 10);
        const maxRepoCandidates = Number.isFinite(maxRepoCandidatesRaw) && maxRepoCandidatesRaw > 0
          ? Math.max(2, maxRepoCandidatesRaw)
          : 4;
        const promptForTemplate = [
          name,
          metadata.description || '',
          metadata.specialInstructions || '',
          metadata.documentTemplate || ''
        ]
          .filter((value) => typeof value === 'string' && value.trim())
          .join('\n');

        console.log(`🌐 Fetching online template for type=${metadata.documentType || 'article'}...`);
        const templateBundle = await fetchOnlineTemplateBundle({
          documentType: metadata.documentType || 'article',
          documentTemplate: metadata.documentTemplate || null,
          promptText: promptForTemplate,
          maxRepoCandidates
        });

        if (templateBundle?.success) {
          const saveResult = await saveOnlineTemplateBundle(projectPath, templateBundle, { replaceExisting: true });
          if (saveResult?.success) {
            const templateFolderPath = path.join(projectPath, 'template');
            processedFiles.push({
              name: 'online-template-bundle',
              type: 'template-zip',
              extracted: true,
              path: templateFolderPath
            });
            for (const saved of saveResult.savedFiles || []) {
              processedFiles.push({
                name: path.basename(saved.relativePath),
                type: 'template-file',
                path: saved.absolutePath,
                relativePath: saved.relativePath,
                source: 'online-template'
              });
            }

            metadata.onlineTemplate = {
              fetched: true,
              provider: saveResult.metadata?.provider || templateBundle.provider || 'unknown',
              repository: saveResult.metadata?.repository || templateBundle.repository || null,
              repositoryUrl: saveResult.metadata?.repository_url || templateBundle.repository_url || null,
              query: saveResult.metadata?.query || templateBundle.query || null,
              mainTemplatePath: saveResult.metadata?.main_template_path || templateBundle.main_template_path || null,
              fetchedFilesCount: saveResult.savedFiles?.length || 0,
              fetchedAt: new Date().toISOString()
            };
            try {
              const metadataPath = path.join(projectPath, 'project_metadata.json');
              const metadataContent = await fs.readFile(metadataPath, 'utf-8');
              const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
              existingMetadata.onlineTemplate = metadata.onlineTemplate;
              await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
            } catch (metaError) {
              console.warn('⚠️ Failed to persist online template metadata:', metaError?.message || metaError);
            }
            console.log(
              `✅ Online template fetched: ${metadata.onlineTemplate.repository || 'unknown repo'} (${metadata.onlineTemplate.fetchedFilesCount} files)`
            );
          } else {
            console.warn(`⚠️ Online template save failed: ${saveResult?.error || 'unknown error'}`);
          }
        } else {
          console.warn(`⚠️ No suitable online template found: ${templateBundle?.error || 'unknown reason'}`);
        }
      } catch (onlineTemplateError) {
        console.warn('⚠️ Online template fetch failed:', onlineTemplateError?.message || onlineTemplateError);
      }
    }

    // Research file upload / DB ingestion removed (GenLaTeX prompt-only mode).

    // Helper function to find main .tex file intelligently using scoring system
    async function findMainTexFile(processedFiles) {
      try {
        let candidateFiles = [];
        const templateParser = new TemplateParser();
        
        // Helper to search directory recursively for .tex files
        const findTexFiles = async (dirPath) => {
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const texFiles = [];
            
            for (const entry of entries) {
              try {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__')) {
                  texFiles.push(...await findTexFiles(fullPath));
                } else if (entry.name.endsWith('.tex')) {
                  const stats = await fs.stat(fullPath);
                  // Only read file if it's reasonably sized (< 5MB)
                  let content = '';
                  let hasDocumentBegin = false;
                  let score = 0;
                  
                  if (stats.size < 5 * 1024 * 1024) {
                    content = await fs.readFile(fullPath, 'utf-8');
                    hasDocumentBegin = content.includes('\\begin{document}');
                    // Use intelligent scoring
                    score = templateParser.scoreTemplateCandidate(content, entry.name);
                  }
                  
                  texFiles.push({
                    path: fullPath,
                    name: entry.name,
                    size: stats.size,
                    hasDocumentBegin,
                    content,
                    score
                  });
                }
              } catch (entryError) {
                console.warn(`Could not process entry ${entry.name}:`, entryError.message);
              }
            }
            return texFiles;
          } catch (dirError) {
            console.warn(`Could not read directory ${dirPath}:`, dirError.message);
            return [];
          }
        };
        
        // Search in direct template files
        for (const file of processedFiles) {
          if (file.type === 'template-file' && file.name.endsWith('.tex')) {
            try {
              const stats = await fs.stat(file.path);
              let content = '';
              let hasDocumentBegin = false;
              let score = 0;
              
              if (stats.size < 5 * 1024 * 1024) {
                content = await fs.readFile(file.path, 'utf-8');
                hasDocumentBegin = content.includes('\\begin{document}');
                score = templateParser.scoreTemplateCandidate(content, file.name);
              }
              
              candidateFiles.push({
                path: file.path,
                name: file.name,
                size: stats.size,
                hasDocumentBegin,
                content,
                score
              });
            } catch (fileError) {
              console.warn(`Could not process file ${file.name}:`, fileError.message);
            }
          }
        }
        
        // Search in extracted ZIPs (which now extract to template/ directly)
        for (const file of processedFiles) {
          if (file.type === 'template-zip' && file.extracted) {
            candidateFiles.push(...await findTexFiles(file.path));
          }
        }
        
        if (candidateFiles.length === 0) return null;
        
        // Filter to only files with \begin{document} (must be compilable)
        const validCandidates = candidateFiles.filter(f => f.hasDocumentBegin);
        
        if (validCandidates.length === 0) {
          console.warn('⚠️ No .tex files found with \\begin{document}');
          return null;
        }
        
        // Sort by score (highest first) and return the best candidate
        validCandidates.sort((a, b) => b.score - a.score);
        
        console.log('📋 Template candidates scored:');
        for (const candidate of validCandidates.slice(0, 5)) {
          console.log(`   ${candidate.name}: score=${candidate.score}`);
        }
        
        return validCandidates[0];
      } catch (error) {
        console.error('Error in findMainTexFile:', error);
        return null;
      }
    }
    
    // Template Detection, Parsing, and Replacement
    // Only check for templates if template files were uploaded (not research files)
    let templateData = null;
    const hasTemplateFiles = processedFiles.some(f => f.type === 'template-file' || f.type === 'template-zip');
    
    if (hasTemplateFiles) {
      try {
        console.log('🔍 Searching for best template .tex file...');
        
        // Use intelligent search to find main .tex file (only in template files, not research files)
        const templateFilesOnly = processedFiles.filter(f => f.type === 'template-file' || f.type === 'template-zip');
        const mainTexFile = await findMainTexFile(templateFilesOnly);
        let templateMainTexPath = null;
        let templateMainTexContent = null;
        
        if (mainTexFile) {
          templateMainTexPath = mainTexFile.path;
          console.log(`✅ Selected template: ${mainTexFile.name} (score: ${mainTexFile.score}, ${mainTexFile.size} bytes)`);
          if (mainTexFile.name !== 'main.tex') {
            console.log(`   ℹ️  Using ${mainTexFile.name} as main template`);
          }
          
          // Use content from scoring if available, otherwise read file
          templateMainTexContent = mainTexFile.content || await fs.readFile(templateMainTexPath, 'utf-8');
          
          // Parse and clean template using TemplateParser
          const templateParser = new TemplateParser();
          const parsedTemplate = templateParser.parseTemplate(templateMainTexContent);
          
          // Check if this is a documentation file and clean content if needed
          const isDocFile = templateParser.isDocumentationFile(templateMainTexContent, mainTexFile.name);
          if (isDocFile) {
            console.log('⚠️ Selected template appears to be documentation - cleaning content');
          }
          
          // Clean sample content from template (remove placeholder text, keep structure)
          const cleanedContent = templateParser.cleanTemplateContent(templateMainTexContent);
          
          if (parsedTemplate) {
            console.log('📋 Template parsed successfully:', {
              documentClass: parsedTemplate.documentClass,
              packagesCount: parsedTemplate.packages.length,
              bibliographyStyle: parsedTemplate.bibliographyStyle?.type || 'unknown',
              sectionsCount: parsedTemplate.structure?.length || 0
            });
            
            templateData = {
              content: templateMainTexContent,  // Original content for reference
              cleanedContent: cleanedContent,   // Cleaned version for use
              parsed: parsedTemplate,
              path: templateMainTexPath,
              originalFileName: mainTexFile.name
            };
            
            // Create/replace main.tex with CLEANED template content
            const defaultMainTexPath = path.join(projectPath, 'main.tex');
            await fs.writeFile(defaultMainTexPath, cleanedContent, 'utf-8');
            console.log('✅ Created main.tex from template (sample content cleaned)');
            
            // Save template metadata to project metadata file
            const metadataPath = path.join(projectPath, 'project_metadata.json');
            const metadataContent = await fs.readFile(metadataPath, 'utf-8');
            const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
            existingMetadata.template = {
              used: true,
              originalFile: mainTexFile.name,
              path: path.relative(projectPath, templateMainTexPath),
              parsedAt: new Date().toISOString(),
              documentClass: parsedTemplate.documentClass,
              packagesCount: parsedTemplate.packages.length,
              bibliographyStyle: parsedTemplate.bibliographyStyle,
              hasAbstract: parsedTemplate.metadata.hasAbstract,
              hasBibliography: parsedTemplate.metadata.hasBibliography,
              wasDocumentation: isDocFile,
              contentCleaned: true
            };
            await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
            console.log('📝 Template metadata saved to project metadata');
            
            // Copy support files (.cls, .sty, .bst, .bib) from template/ to project
            // while preserving relative folder layout (e.g. Style/foo.cls).
            // These are needed for LaTeX compilation
            // Also clean .bib files and exclude documentation files
            console.log('📋 Processing and copying template support files to project...');
            const supportExtensions = ['.cls', '.sty', '.bst', '.bib'];
            const copiedFiles = [];
            const excludedFiles = [];
            const templatePath = path.join(projectPath, 'template');
            
            try {
              // Find support files in the template folder
              const supportFilesInTemplate = await findTemplateFiles(templatePath, supportExtensions);
              
              for (const srcPath of supportFilesInTemplate) {
                const relativeSupportPath = path.relative(templatePath, srcPath).replace(/\\/g, '/');
                if (!relativeSupportPath || relativeSupportPath.startsWith('..')) {
                  continue;
                }
                const fileName = path.basename(relativeSupportPath);
                const destPath = path.resolve(projectPath, relativeSupportPath);
                if (!destPath.startsWith(path.resolve(projectPath))) {
                  continue;
                }
                
                // Check if file should be excluded (documentation, etc.)
                if (templateParser.shouldExcludeFile(fileName)) {
                  excludedFiles.push(relativeSupportPath);
                  console.log(`   🚫 Excluded ${relativeSupportPath} (documentation/unwanted file)`);
                  continue;
                }
                
                // Don't overwrite if already exists in project output tree.
                try {
                  await fs.access(destPath);
                  console.log(`   ⏭️  ${relativeSupportPath} already exists in project, skipping`);
                } catch {
                  await fs.mkdir(path.dirname(destPath), { recursive: true });
                  // For .cls/.sty: validate content is not a LaTeX document (prevents main.tex as IEEEtran.cls bug)
                  if (fileName.toLowerCase().endsWith('.cls') || fileName.toLowerCase().endsWith('.sty')) {
                    try {
                      const clsContent = await fs.readFile(srcPath, 'utf-8');
                      const lines = clsContent.slice(0, 4000).split('\n');
                      let hasDocumentContent = false;
                      for (const line of lines) {
                        const s = line.trim();
                        if (!s || s.startsWith('%')) continue;
                        if (s.includes('\\documentclass') || s.includes('\\begin{document}')) {
                          hasDocumentContent = true;
                          break;
                        }
                      }
                      if (hasDocumentContent) {
                        excludedFiles.push(relativeSupportPath);
                        console.log(`   🚫 Excluded ${relativeSupportPath} (contains document content, not a valid class/style file)`);
                        continue;
                      }
                    } catch (readErr) {
                      console.warn(`   ⚠️ Could not validate ${relativeSupportPath}:`, readErr.message);
                    }
                  }
                  // For .bib files, clean sample entries
                  if (fileName.endsWith('.bib')) {
                    const bibContent = await fs.readFile(srcPath, 'utf-8');
                    const cleanedBib = templateParser.cleanBibFile(bibContent);
                    await fs.writeFile(destPath, cleanedBib, 'utf-8');
                    copiedFiles.push(relativeSupportPath);
                    console.log(`   ✅ Copied and cleaned ${relativeSupportPath} to project`);
                  } else {
                    await fs.copyFile(srcPath, destPath);
                    copiedFiles.push(relativeSupportPath);
                    console.log(`   ✅ Copied ${relativeSupportPath} to project`);
                  }
                }
              }
              
              // Also create a clean references.bib if it doesn't exist
              const refBibPath = path.join(projectPath, 'references.bib');
              try {
                await fs.access(refBibPath);
              } catch {
                // Create clean references.bib
                const cleanBib = templateParser.cleanBibFile('');
                await fs.writeFile(refBibPath, cleanBib, 'utf-8');
                console.log('   ✅ Created clean references.bib');
              }
              
              // Update metadata with copied/excluded files
              existingMetadata.template.supportFiles = copiedFiles;
              existingMetadata.template.excludedFiles = excludedFiles;
              await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
              console.log(`📝 Tracked ${copiedFiles.length} support files, excluded ${excludedFiles.length} files`);
            } catch (copyError) {
              console.error('⚠️ Error copying support files:', copyError);
              // Continue - don't fail project creation
            }
            
            // Clean up template folder - remove excluded files (documentation, PDFs, etc.)
            try {
              console.log('🧹 Cleaning template folder...');
              const allTemplateFiles = await findTemplateFiles(templatePath, ['.tex', '.pdf', '.bib']);
              let cleanedCount = 0;
              
              for (const filePath of allTemplateFiles) {
                const fileName = path.basename(filePath);
                if (templateParser.shouldExcludeFile(fileName) || templateParser.isDocumentationFile(
                  fileName.endsWith('.tex') ? await fs.readFile(filePath, 'utf-8').catch(() => '') : '',
                  fileName
                )) {
                  await fs.unlink(filePath).catch(() => {});
                  cleanedCount++;
                  console.log(`   🗑️ Removed ${fileName} from template folder`);
                }
              }
              
              if (cleanedCount > 0) {
                console.log(`🧹 Cleaned ${cleanedCount} unnecessary files from template folder`);
              }
            } catch (cleanError) {
              console.warn('⚠️ Error cleaning template folder:', cleanError.message);
            }
          }
        } else {
          console.log('ℹ️ No suitable template .tex file found in uploaded files');
        }
      } catch (templateError) {
        console.error('⚠️ Template processing failed:', templateError);
        // Don't fail project creation if template processing fails
      }
    } else {
      // No template files uploaded - this is fine for research files only
      console.log('ℹ️ No template files uploaded (research files only - this is expected)');
    }
    
    // Handle AI generation if enabled
    let aiGenerationStatus = null;
    if (metadata.useAIGeneration) {
      try {
        console.log('🤖 Starting AI document generation...');
        
        // Check if templates were uploaded (files are now extracted to template/ folder)
        const hasTemplates = processedFiles.some(f => f.type === 'template-file' || f.type === 'template-zip');
        if (hasTemplates) {
          console.log('📋 Template files available in template/ folder - will be read by generate-with-project');
        }
        
        // Validate description before sending to Python backend
        const description = metadata.description || '';
        if (description.trim().length < 20) {
          throw new Error('Description must be at least 20 characters long. Please provide a more detailed description.');
        }
        
        // Zotero is only included when project has been explicitly linked (project metadata), not from creation form
        let zoteroConfig = null;
        try {
          const metadataPath = path.join(projectPath, 'project_metadata.json');
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const existingMeta = parseProjectMetadata(metadataContent, metadataPath);
          const zoteroIntegration = existingMeta?.zoteroIntegration;
          if (zoteroIntegration?.libraryId) {
            const userZotero = await getUserZotero(session.id);
            if (userZotero?.apiKey && String(userZotero.zoteroUserId) === String(zoteroIntegration.libraryId)) {
              zoteroConfig = {
                api_key: userZotero.apiKey,
                library_id: zoteroIntegration.libraryId,
                library_type: zoteroIntegration.libraryType || 'user',
                collection_key: zoteroIntegration.collectionKey ?? null
              };
              console.log('📚 Zotero config from project link', zoteroIntegration.collectionKey ? `(collection)` : '(My Library)');
            }
          }
        } catch (_) {
          // No project metadata or no Zotero link for this project
        }

        // Prepare request body - template files are now read from template/ folder by generate-with-project
        // Free users get fast_mode only; paid users can choose long mode
        const selectedReferencesGuideText = buildSelectedReferencesGuide(metadata.selectedReferences);
        const hasDocumentGuideAlready = typeof metadata.specialInstructions === 'string'
          && metadata.specialInstructions.includes('DOCUMENT REQUIREMENTS:');
        const documentGuideText = hasDocumentGuideAlready
          ? ''
          : buildDocumentInstructionBlock(
              metadata.documentType || 'article',
              metadata.documentTemplate || null,
              [metadata.description, metadata.specialInstructions].filter(Boolean).join('\n')
            );

        const mergedSpecialInstructions = [metadata.specialInstructions, documentGuideText, selectedReferencesGuideText]
          .filter((part) => typeof part === 'string' && part.trim())
          .join('\n\n');

        const requestBody = {
          topic: name,
          description: description,
          project_id: project.id,
          document_mode: true,
          template_source: hasTemplates ? 'project' : 'builtin',
          use_custom_template: hasTemplates,
          fast_mode: isProUser ? (metadata.fast_mode !== false) : true,
          flash_mode: isProUser ? (metadata.fast_mode !== false) : true,
          selected_references: metadata.selectedReferences || null,
          document_type: metadata.documentType || null,
          document_template: metadata.documentTemplate || null,
          document_schema_id: metadata.documentSchemaId || null,
          // templatePath removed - files are now read from template/ folder directly
          specialInstructions: mergedSpecialInstructions ? {
            text: mergedSpecialInstructions
          } : undefined,
          zotero_config: zoteroConfig
        };
        
        console.log('📤 Sending AI generation request to proxy endpoint');
        if (hasTemplates) {
          console.log('   📋 Template files will be loaded from template/ folder');
        } else {
          console.log('   ⚡ Using built-in backend template fast path');
        }
        if (metadata.specialInstructions) {
          console.log('   📝 Special instructions included:', metadata.specialInstructions.substring(0, 100) + '...');
        }
        
        // Internal call: in prod use BETTER_AUTH_URL (the canonical app URL); in dev use localhost
        const port = process.env.PORT || '3000';
        const baseUrl = process.env.NODE_ENV === 'development'
          ? `http://127.0.0.1:${port}`
          : process.env.BETTER_AUTH_URL;
        const aiResponse = await fetch(`${baseUrl}/api/agent/documents/generate-with-project`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || '' // Forward cookies for auth
          },
          body: JSON.stringify(requestBody),
        });
        
        console.log('📥 AI generation response status:', aiResponse.status);
        
        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const generationId = aiData.document_id ?? aiData.paper_id ?? aiData.id ?? null;
          console.log('✅ AI document generation started, generation_id:', generationId);
          
          aiGenerationStatus = {
            success: true,
            documentId: generationId,
            paperId: generationId,
            status: 'in_progress',
            startedAt: new Date().toISOString()
          };
          // Metadata is written by generate-with-project route via storage abstraction.
          // Avoid duplicate local-fs writes here to prevent cross-storage race conditions.
          console.log('📝 AI generation metadata acknowledged (written by proxy route)');
        } else {
          const errorText = await aiResponse.text();
          console.error('❌ AI document generation failed:', aiResponse.status, errorText);
          let parsedError = {};
          try {
            parsedError = JSON.parse(errorText);
          } catch {
            // ignore
          }
          aiGenerationStatus = {
            success: false,
            error: parsedError.error || `AI generation failed with status ${aiResponse.status}: ${errorText}`,
            message: parsedError.message,
            status: 'failed',
            ...(parsedError.error === 'paper_credits_exceeded' ? { limitType: 'paper' } : {})
          };
        }
      } catch (aiError) {
        console.error('❌ AI generation error:', aiError);
        aiGenerationStatus = {
          success: false,
          error: aiError.message || 'AI generation failed',
          status: 'failed'
        };
      }
    }
    
    // Process project content and generate LaTeX if files are uploaded or GitHub is linked
    // SKIP if AI generation is enabled (backend will handle LaTeX generation from AI document)
    if (!metadata.useAIGeneration && projectType && metadata && (metadata.uploadedFiles?.length > 0 || metadata.uploadedTemplate?.length > 0 || metadata.githubLink)) {
      try {
        console.log('📊 Processing project content for LaTeX generation...');
        
        const projectData = {
          id: project.id,
          name: name,
          description: metadata.description,
          type: projectType
        };
        
        const contentResult = await processProjectContent(projectPath, projectData, metadata, templateData);
        
        if (contentResult.success) {
          console.log('✅ Project content processed and LaTeX generated successfully');
        } else {
          console.log('⚠️ Project content processing completed with issues:', contentResult.message);
        }
        
      } catch (contentError) {
        console.error('⚠️ Project content processing failed:', contentError);
        // Don't fail the project creation if content processing fails
      }
    } else if (metadata.useAIGeneration) {
      console.log('ℹ️ Skipping frontend LaTeX generation - AI generation is enabled (backend will generate LaTeX from AI document)');
    } else {
      // No content to process, but still update metadata with processed files
      const metadataPath = path.join(projectPath, 'project_metadata.json');
      const metadataContent = await fs.readFile(metadataPath, 'utf-8');
      const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
      existingMetadata.processedFiles = processedFiles;
      existingMetadata.uploadedFilesCount = metadata.uploadedFiles ? metadata.uploadedFiles.length : 0;
      existingMetadata.uploadedTemplateCount = metadata.uploadedTemplate ? metadata.uploadedTemplate.length : 0;
      await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
    }
    
    // Handle GitHub integration if tempProjectId exists (outside AI generation block)
    let githubIntegrationResult = null;
    if (metadata.tempProjectId && metadata.githubLink) {
      try {
        console.log('🔗 Transferring GitHub link from temp project:', metadata.tempProjectId, 'to:', project.id);
        const githubIntegration = new GitHubIntegration();
        
        // Get the link info from the temporary project
        const tempLinkInfo = await githubIntegration.getLinkInfo(metadata.tempProjectId);
        if (tempLinkInfo) {
          // Transfer the repository to the actual project with token
          const githubIntegrationWithToken = new GitHubIntegration(metadata.githubToken);
          await githubIntegrationWithToken.linkRepository(project.id, metadata.githubLink, tempLinkInfo.branch);
          console.log('✅ GitHub repository successfully linked to project:', project.id);
          
          githubIntegrationResult = {
            success: true,
            repository: metadata.githubLink,
            branch: tempLinkInfo.branch
          };
          
          // Memory system removed - GitHub repository content not stored
          console.log('⚠️ Memory system removed - GitHub repository content not stored');
          
          // Clean up the temporary project
          await githubIntegration.unlinkRepository(metadata.tempProjectId);
          console.log('🧹 Cleaned up temporary project:', metadata.tempProjectId);
        }
      } catch (githubError) {
        console.error('⚠️ GitHub integration failed:', githubError);
        githubIntegrationResult = {
          success: false,
          error: githubError.message || 'GitHub integration failed'
        };
        
        // Store error in project metadata
        try {
          const metadataPath = path.join(projectPath, 'project_metadata.json');
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
          existingMetadata.githubIntegration = githubIntegrationResult;
          await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
        } catch {
          // Ignore metadata save errors
        }
      }
    }
    
    // Store Zotero only when user linked a specific collection (no generic "entire library")
    let zoteroIntegrationResult = null;
    if (metadata.zoteroLibraryId && metadata.zoteroCollectionKey) {
      try {
        const collectionKey = metadata.zoteroCollectionKey;
        const metadataPath = path.join(projectPath, 'project_metadata.json');
        const metadataContent = await fs.readFile(metadataPath, 'utf-8');
        const existingMetadata = parseProjectMetadata(metadataContent, metadataPath);
        existingMetadata.zoteroIntegration = {
          libraryId: metadata.zoteroLibraryId,
          libraryType: metadata.zoteroLibraryType || 'user',
          collectionKey,
          configuredAt: new Date().toISOString()
        };
        await fs.writeFile(metadataPath, JSON.stringify(existingMetadata, null, 2));
        zoteroIntegrationResult = { success: true, libraryId: metadata.zoteroLibraryId, collectionKey };
        console.log('✅ Zotero linked for project');
      } catch (zoteroError) {
        console.error('⚠️ Zotero config save failed:', zoteroError);
        zoteroIntegrationResult = { success: false, error: zoteroError.message };
      }
    }

    // Sync project files to MinIO if enabled
    if (isMinio()) {
      try {
        await syncProjectFromLocal(project.id);
        console.log('☁️ Project files synced to MinIO');
      } catch (syncError) {
        console.warn('⚠️ MinIO sync after project creation failed:', syncError.message);
        // Don't fail project creation if sync fails
      }
    }

    // Build comprehensive response
    const response = {
      ...project,
      template: templateData ? {
        used: true,
        documentClass: templateData.parsed?.documentClass,
        packagesCount: templateData.parsed?.packages.length
      } : null,
      aiGeneration: aiGenerationStatus,
      githubIntegration: githubIntegrationResult,
      zoteroIntegration: zoteroIntegrationResult
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error('❌ Projects POST error:', e);
    
    // Improved error response with details
    return NextResponse.json({
      success: false,
      error: 'Failed to create project',
      message: e.message || 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    }, { status: 500 });
  }
}
