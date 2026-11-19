/**
 * API proxy for document generation.
 * Forwards requests to Python FastAPI backend (POST /documents/generate).
 */

import { NextResponse } from 'next/server';

const PYTHON_API_BASE = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';

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

async function forwardJsonRequest(body) {
  const normalizedBody = { ...body };
  if (normalizedBody.document_mode === undefined && normalizedBody.documentMode === undefined) {
    normalizedBody.document_mode = true;
  }

  const response = await fetch(`${PYTHON_API_BASE}/documents/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(normalizedBody),
  });

  return response;
}

async function forwardMultipartRequest(formData) {
  const pythonForm = new FormData();

  appendIfTruthy(pythonForm, 'topic', formData.get('topic'));
  appendIfTruthy(pythonForm, 'description', formData.get('description'));
  appendIfTruthy(pythonForm, 'project_id', formData.get('project_id'));
  appendIfTruthy(pythonForm, 'user_id', formData.get('user_id') ?? formData.get('userId'));
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

  const selectedReferences = formData.get('selectedReferences') ?? formData.get('selected_references');
  if (selectedReferences) {
    pythonForm.append('selected_references', selectedReferences);
  }

  const researchFiles = formData.get('research_files') ?? formData.get('researchFiles');
  if (researchFiles) {
    pythonForm.append('research_files', researchFiles);
  }

  const templateUploads = formData.getAll('templateFiles');
  templateUploads
    .filter((file) => file instanceof File)
    .forEach((file) => {
      pythonForm.append('template_files', file, file.name || 'template');
    });

  const response = await fetch(`${PYTHON_API_BASE}/documents/generate`, {
    method: 'POST',
    body: pythonForm,
  });

  return response;
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let response;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      response = await forwardMultipartRequest(formData);
    } else {
      const body = await request.json();
      response = await forwardJsonRequest(body);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Python API error:', errorText);
      return NextResponse.json(
        { error: 'Failed to generate document', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to connect to document generation service', details: error.message },
      { status: 500 }
    );
  }
}
