/**
 * Paper Generation Project Integration
 * Handles integration between AI generation and project storage
 */

import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { getProjectPath, readFile, writeFile, isMinio, syncProjectToLocal } from './files.js';
import { createProject, getProjectById } from './projects-storage.js';
import { ProjectTemplatesManager } from './project-templates.js';

const GENLATEX_AGENT_URL = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
const AGENT_API_KEY = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;

/**
 * Validate that .cls/.sty content is not a LaTeX document (prevents main.tex as IEEEtran.cls bug).
 * Only rejects if \\documentclass or \\begin{document} appears on a non-comment line.
 * @param {string} fileName - File name (e.g. IEEEtran.cls)
 * @param {string|Buffer} content - File content
 * @returns {boolean} - false if content appears to be document mislabeled as class/style
 */
function isValidSupportFileContent(fileName, content) {
  if (!fileName || content == null) return true;
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== '.cls' && ext !== '.sty') return true;
  const str = typeof content === 'string' ? content : (Buffer.isBuffer(content) ? content.toString('utf-8') : String(content || ''));
  const lines = str.slice(0, 4000).split('\n');
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;
    if (stripped.startsWith('%')) continue; // skip comment lines
    if (stripped.includes('\\documentclass') || stripped.includes('\\begin{document}')) return false;
  }
  return true;
}

export { isValidSupportFileContent };

/**
 * Create a project from AI generation output
 * @param {string} userId - User ID
 * @param {Object} paperData - Generation data
 * @param {string} paperId - Generation ID from service (legacy param name)
 * @returns {Promise<Object>} Created project
 */
export async function createProjectFromPaper(userId, paperData, paperId) {
  try {
    const projectName = paperData.topic || paperData.title || paperData.name || `AI Generated Document ${paperId}`;
    
    // Create project with generation metadata
    const project = await createProject(userId, projectName, {
      type: 'document',
      metadata: {
        description: paperData.description || '',
        documentId: paperId,
        paperId: paperId,
        aiGenerated: true,
        generatedAt: new Date().toISOString(),
        editor: 'latex',
        originalPaperData: paperData // Store original data for debugging
      }
    });

    // Update project metadata to indicate it's AI-generated (storage layer for MinIO)
    const projectMetadata = {
      id: project.id,
      name: project.name,
      type: project.type,
      metadata: project.metadata,
      createdAt: project.created_at,
      editor: 'latex',
      aiGenerated: true,
      documentId: paperId,
      paperId: paperId,
      generatedAt: new Date().toISOString()
    };
    await writeFile(project.id, 'project_metadata.json', JSON.stringify(projectMetadata, null, 2));

    return project;
  } catch (error) {
    console.error('Error creating project from generation:', error);
    throw error;
  }
}

/**
 * Extract and save generated files to project directory
 * WITH COMPREHENSIVE VALIDATION AND ERROR HANDLING
 * @param {string} projectId - Project ID
 * @param {ArrayBuffer} zipBuffer - ZIP file buffer
 * @returns {Promise<Object>} Extraction result
 */
export async function extractPaperFilesToProject(projectId, zipBuffer) {
  const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));

  // VALIDATION 1: Verify project directory exists
  try {
    await fs.access(projectPath);
  } catch {
    console.error('[EXTRACTION] Project directory does not exist');
    return {
      success: false,
      error: 'Project directory not found',
      filesExtracted: 0
    };
  }

  // VALIDATION 2: Check write permissions
  try {
    const testFile = path.join(projectPath, '.write_test');
    await fs.writeFile(testFile, 'test');
    await fs.unlink(testFile);
  } catch (error) {
    console.error('[EXTRACTION] No write permission:', error);
    return {
      success: false,
      error: 'No write permission for project directory',
      filesExtracted: 0
    };
  }

  // VALIDATION 3: Verify ZIP buffer is not empty
  if (!zipBuffer || zipBuffer.byteLength === 0) {
    console.error('[EXTRACTION] ZIP buffer is empty');
    return {
      success: false,
      error: 'ZIP buffer is empty',
      filesExtracted: 0
    };
  }

  // VALIDATION 4: Check ZIP magic bytes (50 4B 03 04 = local file header, or 50 4B 05 06 = empty/minimal ZIP)
  const zipView = new Uint8Array(zipBuffer);
  const isValidZip = (
    zipView[0] === 0x50 &&
    zipView[1] === 0x4B &&
    ((zipView[2] === 0x03 && zipView[3] === 0x04) || (zipView[2] === 0x05 && zipView[3] === 0x06))
  );

  if (!isValidZip) {
    console.error('[EXTRACTION] Invalid ZIP magic bytes:', Array.from(zipView.slice(0, 4)));
    return {
      success: false,
      error: 'Invalid ZIP file format',
      filesExtracted: 0
    };
  }

  const files = [];
  const errors = [];
  let mainTexFound = false;

  // Clean previously extracted AI files so stale artifacts don't persist across reruns.
  try {
    const metadataPath = path.join(projectPath, 'project_metadata.json');
    const metadataRaw = await fs.readFile(metadataPath, 'utf-8');
    const metadata = JSON.parse(metadataRaw || '{}');
    const previousExtracted = Array.isArray(metadata?.extractedFiles) ? metadata.extractedFiles : [];

    for (const file of previousExtracted) {
      const relPath = typeof file === 'string' ? file : (file?.path || file?.name);
      if (!relPath || typeof relPath !== 'string') continue;
      const normalizedRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
      if (!normalizedRel || normalizedRel.startsWith('..')) continue;

      const absPath = path.resolve(projectPath, normalizedRel);
      if (!absPath.startsWith(projectPath)) continue;
      await fs.rm(absPath, { force: true }).catch(() => {});
    }
  } catch (cleanupErr) {
    console.warn('[EXTRACTION] Could not clean previous extracted files:', cleanupErr?.message || cleanupErr);
  }

  try {
    // Create a temporary directory for extraction
    const tempDir = path.join(projectPath, 'temp_extraction');
    await fs.mkdir(tempDir, { recursive: true });
    const zipPath = path.join(tempDir, 'generated_files.zip');
    await fs.writeFile(zipPath, Buffer.from(zipBuffer));
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      try {
        const mainTexPath = path.join(projectPath, 'main.tex');
        const templatesManager = new ProjectTemplatesManager();
        const defaultContent = templatesManager.getDefaultMainTexContent();
        await fs.writeFile(mainTexPath, defaultContent, 'utf-8');
        const verificationResults = [{ name: 'main.tex', exists: true, size: Buffer.byteLength(defaultContent, 'utf-8') }];
        await updateProjectMetadataWithFiles(projectId, [{ name: 'main.tex', path: 'main.tex', size: defaultContent.length }]);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return {
          success: true,
          filesExtracted: 1,
          files: [{ name: 'main.tex', path: 'main.tex', size: defaultContent.length }],
          mainTexFound: true,
          errors: [],
          verificationResults
        };
      } catch (emptyErr) {
        console.error('[EXTRACTION] Failed to create default main.tex for empty ZIP:', emptyErr);
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return {
          success: false,
          filesExtracted: 0,
          files: [],
          mainTexFound: false,
          errors: ['ZIP file contains no entries', emptyErr.message]
        };
      }
    }

    // Collect file entries (skip dirs)
    const fileEntries = zipEntries.filter(e => !e.isDirectory);
    const entryNames = fileEntries.map(e => e.entryName.replace(/\\/g, '/').replace(/\/+$/, ''));

    // Unwrap single root folder to avoid project/ProjectName/ProjectName/ nesting and duplicates
    const getSingleRoot = (names) => {
      if (names.length === 0) return null;
      const parts = names.map(n => n.split('/').filter(Boolean));
      const first = parts[0][0];
      if (!first) return null;
      return parts.every(p => p[0] === first) ? first + '/' : null;
    };
    const stripPrefix = getSingleRoot(entryNames) || '';
    const writtenPaths = new Set();

    const keepSupportExtensions = new Set([
      '.cls', '.sty', '.bst', '.def', '.fd', '.cfg',
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.eps'
    ]);
    const internalArtifactNames = new Set([
      'analysis.json',
      'detailed_plan.json',
      'rough_plan.json',
      'plan.json',
      'latex_review.json',
      'paper_data.json',
      'report.txt',
      'abstract.txt'
    ]);

    const normalizeZipPath = (rawName) => {
      let normalized = String(rawName || '').replace(/\\/g, '/');
      if (stripPrefix && normalized.startsWith(stripPrefix)) {
        normalized = normalized.slice(stripPrefix.length);
      }
      normalized = normalized.replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+/g, '/');
      return normalized;
    };

    const toTexPath = (rawRef) => {
      let ref = String(rawRef || '').trim().replace(/\\/g, '/');
      if (!ref) return null;
      if (!path.posix.extname(ref)) {
        ref = `${ref}.tex`;
      }
      ref = ref.replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+/g, '/');
      return ref;
    };

    const toBibPath = (rawRef) => {
      let ref = String(rawRef || '').trim().replace(/\\/g, '/');
      if (!ref) return null;
      if (!path.posix.extname(ref)) {
        ref = `${ref}.bib`;
      }
      ref = ref.replace(/^\/+/, '').replace(/^\.\/+/, '').replace(/\/+/g, '/');
      return ref;
    };

    const normalizedEntries = fileEntries
      .map((entry) => {
        const normalizedFileName = normalizeZipPath(entry.entryName);
        return { entry, normalizedFileName };
      })
      .filter((item) => item.normalizedFileName && !item.normalizedFileName.endsWith('/'));

    // Pick the primary main.tex (prefer root-level, non-template path).
    const mainTexCandidates = normalizedEntries
      .filter((item) => path.basename(item.normalizedFileName).toLowerCase() === 'main.tex')
      .sort((a, b) => {
        const aPath = a.normalizedFileName.toLowerCase();
        const bPath = b.normalizedFileName.toLowerCase();
        const aTemplatePenalty = aPath.startsWith('template/') ? 1 : 0;
        const bTemplatePenalty = bPath.startsWith('template/') ? 1 : 0;
        if (aTemplatePenalty !== bTemplatePenalty) return aTemplatePenalty - bTemplatePenalty;
        const aDepth = a.normalizedFileName.split('/').length;
        const bDepth = b.normalizedFileName.split('/').length;
        if (aDepth !== bDepth) return aDepth - bDepth;
        return aPath.localeCompare(bPath);
      });
    const selectedMainTexPath = mainTexCandidates[0]?.normalizedFileName || null;

    const referencedTexPaths = new Set();
    const referencedTexBasenames = new Set();
    const bibliographyPaths = new Set(['references.bib']);
    const bibliographyBasenames = new Set(['references.bib']);

    if (selectedMainTexPath) {
      try {
        const selectedMainEntry = normalizedEntries.find((item) => item.normalizedFileName === selectedMainTexPath);
        const mainTexContent = selectedMainEntry?.entry?.getData()?.toString('utf-8') || '';

        const inputRegex = /\\(?:input|include)\{([^}]+)\}/g;
        let match;
        while ((match = inputRegex.exec(mainTexContent)) !== null) {
          const texPath = toTexPath(match[1]);
          if (!texPath) continue;
          referencedTexPaths.add(texPath);
          referencedTexBasenames.add(path.basename(texPath).toLowerCase());
        }

        const bibliographyRegex = /\\bibliography\{([^}]+)\}/g;
        while ((match = bibliographyRegex.exec(mainTexContent)) !== null) {
          const refs = String(match[1] || '')
            .split(',')
            .map((part) => toBibPath(part))
            .filter(Boolean);
          for (const bibPath of refs) {
            bibliographyPaths.add(bibPath.toLowerCase());
            bibliographyBasenames.add(path.basename(bibPath).toLowerCase());
          }
        }

        const addBibResourceRegex = /\\addbibresource\{([^}]+)\}/g;
        while ((match = addBibResourceRegex.exec(mainTexContent)) !== null) {
          const bibPath = toBibPath(match[1]);
          if (!bibPath) continue;
          bibliographyPaths.add(bibPath.toLowerCase());
          bibliographyBasenames.add(path.basename(bibPath).toLowerCase());
        }
      } catch (depError) {
        console.warn('[EXTRACTION] Could not parse main.tex dependencies:', depError?.message || depError);
      }
    }

    const shouldExtractFile = (normalizedFileName) => {
      const normalized = String(normalizedFileName || '').replace(/\\/g, '/');
      if (!normalized) return false;
      const lowerPath = normalized.toLowerCase();
      const basename = path.basename(normalized);
      const lowerBase = basename.toLowerCase();
      const ext = path.extname(lowerBase);

      if (lowerBase === 'main.tex') {
        // Only keep the selected primary main.tex when multiple are present.
        return !selectedMainTexPath || lowerPath === selectedMainTexPath.toLowerCase();
      }

      // Template folder is internal workspace context; keep user-facing tree clean.
      if (lowerPath.startsWith('template/')) return false;

      if (internalArtifactNames.has(lowerBase)) return false;

      if (lowerBase === 'references.bib') return true;

      if (lowerPath.startsWith('images/') || lowerPath.startsWith('webimg/')) return true;

      if (ext === '.tex') {
        return referencedTexPaths.has(lowerPath) || referencedTexBasenames.has(lowerBase);
      }

      if (ext === '.bib') {
        return bibliographyPaths.has(lowerPath) || bibliographyBasenames.has(lowerBase);
      }

      if (keepSupportExtensions.has(ext)) return true;

      return false;
    };

    // Extract files
    for (const item of normalizedEntries) {
      const entry = item.entry;
      const normalizedFileName = item.normalizedFileName;
      if (!shouldExtractFile(normalizedFileName)) continue;

      const basename = path.basename(normalizedFileName);
      if (writtenPaths.has(normalizedFileName)) continue;
      writtenPaths.add(normalizedFileName);

      try {
        let content = entry.getData();
        const filePath = path.join(projectPath, normalizedFileName);

        // Validate .cls/.sty: skip if content is a LaTeX document (prevents main.tex as IEEEtran.cls bug)
        if (basename.toLowerCase().endsWith('.cls') || basename.toLowerCase().endsWith('.sty')) {
          if (!isValidSupportFileContent(basename, content)) continue;
        }

        // Normalize common LLM typo in main.tex: 1modern -> lmodern (invalid package -> valid)
        const isMainTex = normalizedFileName === 'main.tex' || normalizedFileName.endsWith('/main.tex');
        if (isMainTex && content) {
          const wasBuffer = Buffer.isBuffer(content);
          const str = wasBuffer ? content.toString('utf-8') : String(content);
          const normalized = str.replace(/\\usepackage(\[[^\]]*\])?\{1modern\}/g, '\\usepackage$1{lmodern}');
          content = wasBuffer ? Buffer.from(normalized, 'utf-8') : normalized;
        }

        const fileDir = path.dirname(filePath);
        await fs.mkdir(fileDir, { recursive: true });
        await fs.writeFile(filePath, content);
        files.push({ name: normalizedFileName, path: normalizedFileName, size: content.length });

        if (normalizedFileName === 'main.tex' || normalizedFileName.endsWith('/main.tex')) mainTexFound = true;
      } catch (error) {
        console.error(`[EXTRACTION] ❌ Failed to extract ${entry.entryName}:`, error);
        errors.push(`Failed to extract ${entry.entryName}: ${error.message}`);
      }
    }

    // Repair path-based class/style references when template bundles include root-level
    // fallback files (e.g., "ucasproposal.cls") but main.tex references "Style/ucasproposal".
    const fileExists = async (absPath) => {
      try {
        await fs.access(absPath);
        return true;
      } catch {
        return false;
      }
    };

    const splitPackageRefs = (value) =>
      String(value || '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);

    try {
      const mainFile = files.find((f) => path.basename(String(f.path || '')).toLowerCase() === 'main.tex');
      if (mainFile?.path) {
        const mainPath = path.join(projectPath, mainFile.path);
        const mainContent = await fs.readFile(mainPath, 'utf-8');
        const requiredSupportPaths = new Set();

        for (const match of mainContent.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
          const raw = String(match[1] || '').trim();
          if (!raw) continue;
          const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
          if (!normalized.includes('/')) continue;
          requiredSupportPaths.add(path.posix.extname(normalized) ? normalized : `${normalized}.cls`);
        }

        for (const match of mainContent.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
          for (const pkgRef of splitPackageRefs(match[1])) {
            const normalizedBase = pkgRef.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\/+/, '');
            if (!normalizedBase || !normalizedBase.includes('/')) continue;
            requiredSupportPaths.add(
              path.posix.extname(normalizedBase) ? normalizedBase : `${normalizedBase}.sty`
            );
          }
        }

        for (const relSupportPath of requiredSupportPaths) {
          if (!relSupportPath || relSupportPath.startsWith('..')) continue;
          const targetPath = path.resolve(projectPath, relSupportPath);
          if (!targetPath.startsWith(projectPath)) continue;
          if (await fileExists(targetPath)) continue;

          const rootFallbackPath = path.join(projectPath, path.basename(relSupportPath));
          if (!(await fileExists(rootFallbackPath))) continue;

          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.copyFile(rootFallbackPath, targetPath);
          const stats = await fs.stat(targetPath).catch(() => null);
          if (!files.some((f) => f.path === relSupportPath)) {
            files.push({
              name: relSupportPath,
              path: relSupportPath,
              size: stats?.size || 0
            });
          }
        }
      }
    } catch (repairError) {
      console.warn('[EXTRACTION] Support-path repair skipped:', repairError?.message || repairError);
    }

    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error('[EXTRACTION] Failed to clean up temp directory:', error);
    }

    // Wait for filesystem sync (Windows may need this)
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify files exist
    const verificationResults = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(projectPath, file.path);
        try {
          const stats = await fs.stat(filePath);
          return { name: file.name, exists: true, size: stats.size };
        } catch {
          console.error(`[EXTRACTION] ❌ Missing: ${file.name}`);
          return { name: file.name, exists: false };
        }
      })
    );

    const missingFiles = verificationResults.filter(r => !r.exists);
    if (missingFiles.length > 0) {
      console.error('[EXTRACTION] Some files missing after extraction:', missingFiles);
      errors.push(`${missingFiles.length} files missing after extraction`);
    }

    // Verify main.tex specifically; if missing, use any .tex or default template
    const mainTexPath = path.join(projectPath, 'main.tex');
    try {
      const mainTexStats = await fs.stat(mainTexPath);
      mainTexFound = true;
    } catch {
      mainTexFound = false;
      errors.push('main.tex not found after extraction');

      const texFiles = files
        .filter((f) => f.path.toLowerCase().endsWith('.tex'))
        .sort((a, b) => {
          const ap = a.path.toLowerCase();
          const bp = b.path.toLowerCase();
          const prefer = ['document.tex', 'paper.tex', 'main.tex'];
          const ai = prefer.indexOf(ap);
          const bi = prefer.indexOf(bp);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          return ap.localeCompare(bp);
        });

      if (texFiles.length > 0) {
        const sourcePath = path.join(projectPath, texFiles[0].path);
        try {
          const content = await fs.readFile(sourcePath, 'utf-8');
          await fs.writeFile(mainTexPath, content, 'utf-8');
          mainTexFound = true;
          errors.splice(errors.indexOf('main.tex not found after extraction'), 1);
          files.push({ name: 'main.tex', path: 'main.tex', size: Buffer.byteLength(content, 'utf-8') });
        } catch (copyErr) {
          console.error('[EXTRACTION] Failed to copy .tex to main.tex:', copyErr);
        }
      } else {
        try {
          const templatesManager = new ProjectTemplatesManager();
          const defaultContent = templatesManager.getDefaultMainTexContent();
          await fs.writeFile(mainTexPath, defaultContent, 'utf-8');
          mainTexFound = true;
          errors.splice(errors.indexOf('main.tex not found after extraction'), 1);
          files.push({ name: 'main.tex', path: 'main.tex', size: Buffer.byteLength(defaultContent, 'utf-8') });
        } catch (defaultErr) {
          console.error('[EXTRACTION] Failed to write default main.tex:', defaultErr);
        }
      }
    }

    // Update project metadata with file information
    await updateProjectMetadataWithFiles(projectId, files);

    const success = files.length > 0 && mainTexFound && errors.length === 0;

    return {
      success,
      filesExtracted: files.length,
      files,
      mainTexFound,
      errors,
      verificationResults
    };

  } catch (error) {
    console.error('[EXTRACTION] Critical error:', error);
    return {
      success: false,
      error: error.message,
      filesExtracted: files.length,
      files,
      mainTexFound,
      errors: [...errors, error.message]
    };
  }
}

/**
 * Extract ZIP file using adm-zip library
 * @param {string} zipPath - Path to ZIP file
 * @param {string} extractPath - Path to extract to
 * @returns {Promise<Array>} List of extracted files
 */
async function extractZipFile(zipPath, extractPath) {
  try {
    
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractPath, true);
    
    // Get list of extracted files
    const zipEntries = zip.getEntries();
    const extractedFiles = zipEntries
      .filter(entry => !entry.isDirectory)
      .map(entry => entry.entryName);
    
    return extractedFiles;
  } catch (error) {
    console.error('❌ Error extracting ZIP:', error);
    throw new Error(`Failed to extract ZIP file: ${error.message}`);
  }
}


/**
 * Move extracted files to project directory
 * @param {string} tempDir - Temporary extraction directory
 * @param {string} projectPath - Project directory
 * @param {Array} extractedFiles - List of extracted file names
 * @returns {Promise<Array>} List of moved files
 */
async function moveExtractedFiles(tempDir, projectPath, extractedFiles) {
  const movedFiles = [];
  
  
  for (const fileName of extractedFiles) {
    const sourcePath = path.join(tempDir, fileName);
    // Ensure files go to project root, not template folder
    // Normalize path to remove any template/ prefix
    const normalizedFileName = fileName.replace(/^template[\/\\]/, '');
    const targetPath = path.join(projectPath, normalizedFileName);
    
    // Skip if target would be in template folder (safety check)
    if (targetPath.includes(path.join(projectPath, 'template'))) {
      continue;
    }
    
    try {
      
      // Create target directory if needed
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      
      // For AI-generated files, overwrite existing files (don't skip)
      // Only skip if it's in the template folder
      const isTemplateFile = normalizedFileName.startsWith('template/') || 
                             normalizedFileName.includes('/template/');
      
      if (!isTemplateFile) {
        // Overwrite existing files for AI-generated content
        // Move file (rename will overwrite if exists)
        await fs.rename(sourcePath, targetPath);
      } else {
        // Skip template files
        continue;
      }
      movedFiles.push(normalizedFileName);
    } catch (error) {
      console.error(`❌ Error moving file ${fileName}:`, error);
      // Continue with other files even if one fails
    }
  }
  
  return movedFiles;
}

/**
 * Update project metadata with extracted files information
 * @param {string} projectId - Project ID
 * @param {Array} files - List of extracted files
 */
async function updateProjectMetadataWithFiles(projectId, files) {
  try {
    const metadataContent = await readFile(projectId, 'project_metadata.json', { encoding: 'utf8' });
    const metadata = JSON.parse(metadataContent != null ? (Buffer.isBuffer(metadataContent) ? metadataContent.toString('utf8') : metadataContent) : '{}');
    metadata.extractedFiles = files;
    metadata.filesExtractedAt = new Date().toISOString();
    await writeFile(projectId, 'project_metadata.json', JSON.stringify(metadata, null, 2));
  } catch (error) {
    console.error('Error updating project metadata:', error);
  }
}

/**
 * Get paper generation status and handle completion
 * @param {string} paperId - Paper ID
 * @param {string} userId - User ID
 * @param {string} projectId - Optional project ID (if provided, update existing project instead of creating new one)
 * @returns {Promise<Object>} Status and project information
 */
export async function handlePaperGenerationCompletion(paperId, userId, projectId = null) {
  try {
    const headers = {};
    if (AGENT_API_KEY) {
      headers['Authorization'] = `Bearer ${AGENT_API_KEY}`;
    }
    const response = await fetch(`${GENLATEX_AGENT_URL}/documents/${paperId}`, { headers });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Failed to get generation status:', response.status, errorText);
      throw new Error(`Failed to get generation status: ${response.status} - ${errorText}`);
    }
    
    const paperStatus = await response.json();
    
    // Extract project_id from paper metadata if not provided
    if (!projectId && paperStatus.paper_data?.project_id) {
      projectId = paperStatus.paper_data.project_id;
    }
    
    if (paperStatus.status === 'completed') {
      
      // Add timeout for ZIP download
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout
      
      const zipResponse = await fetch(`${GENLATEX_AGENT_URL}/documents/${paperId}/download-all`, {
        signal: controller.signal,
        headers: AGENT_API_KEY ? { 'Authorization': `Bearer ${AGENT_API_KEY}` } : {}
      });
      
      clearTimeout(timeoutId);
      
      if (!zipResponse.ok) {
        const errorText = await zipResponse.text();
        console.error('❌ Failed to download ZIP:', zipResponse.status, errorText);
        throw new Error(`Failed to download generated files: ${zipResponse.status} - ${errorText}`);
      }
      
      const zipBuffer = await zipResponse.arrayBuffer();
      
      if (zipBuffer.byteLength === 0) {
        throw new Error('Downloaded ZIP file is empty');
      }
      
      let project;
      
      // If projectId is provided, try to use existing project
      if (projectId) {
        const existingProject = await getProjectById(projectId);
        
        if (existingProject) {
          project = existingProject.project;
          
          try {
            const metadataContent = await readFile(project.id, 'project_metadata.json', { encoding: 'utf8' });
            const metadata = JSON.parse(metadataContent != null ? (Buffer.isBuffer(metadataContent) ? metadataContent.toString('utf8') : metadataContent) : '{}');
            metadata.aiGeneration = {
              documentId: paperId,
              paperId: paperId,
              status: 'completed',
              completedAt: new Date().toISOString()
            };
            await writeFile(project.id, 'project_metadata.json', JSON.stringify(metadata, null, 2));
          } catch (metadataError) {
            console.warn('⚠️ Could not update project metadata:', metadataError);
          }
        } else {
          project = await createProjectFromPaper(userId, paperStatus.paper_data || {}, paperId);
        }
      } else {
        project = await createProjectFromPaper(userId, paperStatus.paper_data || {}, paperId);
      }
      
      
      // When using MinIO, sync project to local before extraction so we have the right directory structure
      if (isMinio()) {
        await syncProjectToLocal(project.id).catch((err) => console.warn('Sync from MinIO before extraction:', err?.message));
      }
      
      const extractionResult = await extractPaperFilesToProject(project.id, zipBuffer);
      
      if (!extractionResult.success) {
        throw new Error(`File extraction failed: ${extractionResult.error}`);
      }
      
      return {
        success: true,
        project: project,
        extractionResult: extractionResult
      };
    }
    
    return {
      success: false,
      status: paperStatus.status,
      message: 'Document generation not completed yet'
    };
    
  } catch (error) {
    console.error('❌ Error handling generation completion:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
