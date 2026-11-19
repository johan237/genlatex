/**
 * Client utilities for the document generation API.
 * All requests use /api/agent/documents. Function names with "Paper" are kept for compatibility.
 */

const API_BASE = '/api/agent/documents';

/** Normalize special instructions to canonical API shape: string | null (never object). */
function normalizeSpecialInstructions(value) {
  if (value == null) return null;
  const s = typeof value === 'string' ? value.trim() : value?.text?.trim();
  return s && s.length > 0 ? s : null;
}

/**
 * Start document generation.
 * @param {Object} params - Generation parameters
 * @param {string} params.topic - Topic/prompt
 * @param {string} params.description - Description
 * @returns {Promise<Object>} Response with generation id
 */
function buildGenerationFormData(params) {
  const {
    topic,
    description,
    specialInstructions,
    uploadedFiles = [],
    selectedReferences = [],
    templateFiles = [],
    templateSource = null,
    useCustomTemplate = null
  } = params;

  const formData = new FormData();
  formData.append('topic', topic);
  formData.append('description', description);

  const normalized = normalizeSpecialInstructions(specialInstructions);
  if (normalized) {
    formData.append('specialInstructions', normalized);
  }

  uploadedFiles
    .map((item) => {
      if (item instanceof File) return { file: item, name: item.name };
      if (item?.file instanceof File) return { file: item.file, name: item.name || item.file.name };
      return null;
    })
    .filter(Boolean)
    .forEach(({ file, name }) => {
      formData.append('uploadedFiles', file, name || file.name || 'material');
    });

  if (Array.isArray(selectedReferences) && selectedReferences.length > 0) {
    formData.append('selectedReferences', JSON.stringify(selectedReferences));
  }

  templateFiles
    .filter((file) => file instanceof File)
    .forEach((file) => {
      formData.append('templateFiles', file, file.name || 'template');
    });

  const resolvedTemplateSource = templateSource || (templateFiles.length > 0 ? 'project' : 'builtin');
  formData.append('template_source', resolvedTemplateSource);
  formData.append('use_custom_template', String(useCustomTemplate ?? (resolvedTemplateSource === 'project')));

  return formData;
}

export async function startPaperGeneration(params) {
  const { topic, description, selectedReferences } = params;
  try {
    const hasUploads =
      (params.uploadedFiles && params.uploadedFiles.length > 0) ||
      (params.templateFiles && params.templateFiles.length > 0);

    const payload = hasUploads
      ? buildGenerationFormData(params)
      : JSON.stringify({
          topic,
          description,
          special_instructions: normalizeSpecialInstructions(params.specialInstructions),
          selected_references: selectedReferences || null
        });

    const headers = hasUploads ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(`${API_BASE}/generate`, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.message || errorData.error || response.statusText || 'Failed to start document generation';
      throw new Error(msg);
    }

    return await response.json();
  } catch (error) {
    console.error('Error starting document generation:', error);
    throw error;
  }
}

/**
 * Start document generation with automatic project creation.
 * @param {Object} params - Generation parameters
 * @param {string} params.topic - Topic
 * @param {string} params.description - Description
 * @param {string} params.templatePath - Optional template ZIP file path
 * @returns {Promise<Object>} Response with generation id and user id
 */
export async function startPaperGenerationWithProject(params) {
  const { topic, description, templatePath = null, selectedReferences } = params;
  try {
    const hasUploads =
      (params.uploadedFiles && params.uploadedFiles.length > 0) ||
      (params.templateFiles && params.templateFiles.length > 0);

    let payload;
    let headers = {};

    if (hasUploads) {
      payload = buildGenerationFormData(params);
    } else {
      const requestBody = {
        topic,
        description,
      };

      const resolvedTemplateSource = params.templateSource || (templatePath ? 'project' : 'builtin');
      requestBody.template_source = resolvedTemplateSource;
      requestBody.use_custom_template = Boolean(
        params.useCustomTemplate ?? (resolvedTemplateSource === 'project')
      );

      requestBody.special_instructions = normalizeSpecialInstructions(params.specialInstructions);

      if (templatePath) {
        requestBody.templatePath = templatePath;
      }

      if (selectedReferences && selectedReferences.length > 0) {
        requestBody.selected_references = selectedReferences;
      }

      payload = JSON.stringify(requestBody);
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${API_BASE}/generate-with-project`, {
      method: 'POST',
      headers,
      body: payload,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.message || errorData.error || response.statusText || 'Failed to start document generation';
      throw new Error(msg);
    }

    return await response.json();
  } catch (error) {
    console.error('Error starting document generation with project:', error);
    throw error;
  }
}

/**
 * Handle document generation completion and create project.
 * @param {string} documentId - Generation id (document ID from start response)
 * @returns {Promise<Object>} Project creation result
 */
export async function completePaperGenerationWithProject(documentId) {
  try {
    const response = await fetch(`${API_BASE}/generate-with-project`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ documentId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.message || errorData.error || response.statusText || 'Failed to complete document generation';
      throw new Error(msg);
    }

    return await response.json();
  } catch (error) {
    console.error('Error completing document generation with project:', error);
    throw error;
  }
}

/**
 * Get generation status and progress.
 * @param {string} documentId - Generation id (from start response document_id or paper_id)
 * @returns {Promise<Object>} Generation status, phase, progress, and data
 */
export async function getPaperStatus(documentId) {
  try {
    const response = await fetch(`${API_BASE}/${documentId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Status fetch error:', errorData);
      const msg = errorData.message || errorData.error || `Failed to get generation status: ${response.status}`;
      throw new Error(msg);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting generation status:', error);
    throw error;
  }
}

/**
 * Download a single generated file.
 * @param {string} documentId - Generation id
 * @param {string} fileType - File type (latex, pdf, docx, html, txt)
 */
export function downloadPaperFile(documentId, fileType) {
  const url = `${API_BASE}/${documentId}/download/${fileType}`;
  window.open(url, '_blank');
}

/**
 * Download all generated files as ZIP.
 * @param {string} documentId - Generation id
 */
export function downloadAllFiles(documentId) {
  const url = `${API_BASE}/${documentId}/download-all`;
  window.open(url, '_blank');
}

export function getPhaseDisplayName(phase) {
  const phaseNames = {
    plan: 'Planning structure',
    research: 'Preparing content',
    writing: 'Drafting sections',
    verification: 'Finalizing output',
    complete: 'Complete'
  };
  return phaseNames[phase] || phase;
}

export function getPhaseDescription(phase) {
  const descriptions = {
    plan: 'Creating the document structure and outline',
    research: 'Collecting and organizing provided context',
    writing: 'Writing the document content and sections',
    verification: 'Reviewing formatting and consistency',
    complete: 'Document generation completed successfully'
  };
  return descriptions[phase] || 'Processing...';
}

export function isPhaseActive(phase) {
  return ['plan', 'research', 'writing', 'verification'].includes(phase);
}

export function isPaperCompleted(status) {
  return status === 'completed' || status === 'done' || status === 'finished';
}

export function isPaperFailed(status) {
  return status === 'failed' || status === 'error' || status === 'cancelled';
}

export function isPaperInProgress(status) {
  return status === 'in_progress' || status === 'processing' || status === 'running' || status === 'pending';
}

// Document-first aliases
export const startDocumentGeneration = startPaperGeneration;
export const startDocumentGenerationWithProject = startPaperGenerationWithProject;
export const completeDocumentGenerationWithProject = completePaperGenerationWithProject;
export const getDocumentStatus = getPaperStatus;
export const downloadDocumentFile = downloadPaperFile;
export const isDocumentCompleted = isPaperCompleted;
export const isDocumentFailed = isPaperFailed;
export const isDocumentInProgress = isPaperInProgress;
