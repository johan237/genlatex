/**
 * Create a project from tool output (e.g. website Tools → Open in GenLaTeX).
 * Body: { latex: string, name?: string, file?: { name: string, base64: string } }
 * Returns: { projectId: string }
 */

import path from 'path';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { canUserCreateProject } from '@/lib/user-subscription.js';
import { createProject } from '@/lib/projects-storage.js';
import { writeFile, getProjectPath } from '@/lib/files.js';
import { createResearchFile } from '@/lib/db.js';

const MAX_LATEX_BYTES = 100 * 1024; // 100KB
const MAX_FILE_BYTES = 100 * 1024; // 100KB decoded

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls', '.json', '.xml', '.yaml', '.yml',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.cpp', '.c', '.go', '.rs',
  '.ipynb', '.pdf', '.md', '.txt', '.tex', '.bib', '.bibtex',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.zip', '.doc', '.docx'];

function ensureDocument(content) {
  const s = (content || '').trim();
  if (s.length < 10) {
    return '\\documentclass{article}\n\\begin{document}\n\n\\end{document}';
  }
  if (!/\\begin\s*\{\s*document\s*\}/i.test(s)) {
    return '\\documentclass{article}\n\\begin{document}\n' + s + '\n\\end{document}';
  }
  return s;
}

function validateFileType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`File type ${ext} not allowed.`);
  }
  return ext;
}

function sanitizeFileName(fileName) {
  return fileName
    .replace(/[\/\\]/g, '_')
    .replace(/[<>:"|?*\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .substring(0, 255);
}

function generateFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getMimeType(fileType) {
  const mimeTypes = {
    'csv': 'text/csv',
    'json': 'application/json',
    'pdf': 'application/pdf',
    'py': 'text/x-python',
    'md': 'text/markdown',
    'ipynb': 'application/x-ipynb+json',
    'bib': 'text/x-bibtex',
    'bibtex': 'text/x-bibtex',
  };
  return mimeTypes[fileType] || 'application/octet-stream';
}

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ error: 'Unauthorized', message: 'Sign in to open tool output in GenLaTeX.' }, { status: 401 });
    }

    const canCreate = await canUserCreateProject(session.id);
    if (!canCreate.allowed) {
      return NextResponse.json({
        error: 'Project limit reached. Upgrade to Pro for unlimited projects.',
        upgradeRequired: true,
        subscription: {
          projectCount: canCreate.projectCount,
          maxProjects: canCreate.maxProjects,
          isPro: canCreate.isPro,
        },
      }, { status: 403 });
    }

    const body = await request.json();
    let latex = typeof body.latex === 'string' ? body.latex : '';
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'From Tools';
    const filePayload = body.file && typeof body.file === 'object' ? body.file : null;

    if (Buffer.byteLength(latex, 'utf8') > MAX_LATEX_BYTES) {
      return NextResponse.json({ error: 'Payload too large', message: 'Output is too large. Use Download from the tool instead.' }, { status: 413 });
    }

    latex = ensureDocument(latex);

    const project = await createProject(session.id, name, {
      type: 'empty',
      metadata: { editor: 'latex' },
    });

    await writeFile(project.id, 'main.tex', latex);

    if (filePayload && typeof filePayload.name === 'string' && typeof filePayload.base64 === 'string') {
      const originalName = filePayload.name.trim();
      if (!originalName) {
        // skip invalid file
      } else {
        let buf;
        try {
          buf = Buffer.from(filePayload.base64, 'base64');
        } catch {
          buf = null;
        }
        if (buf && buf.length > 0 && buf.length <= MAX_FILE_BYTES) {
          try {
            validateFileType(originalName);
            const ext = path.extname(originalName).toLowerCase();
            const sanitizedName = sanitizeFileName(originalName);
            const uniqueFileName = `${Date.now()}_${sanitizedName}`;
            await writeFile(project.id, uniqueFileName, buf);

            const projectDir = path.resolve(process.cwd(), getProjectPath(session.id, project.id));
            const filePath = path.join(projectDir, uniqueFileName);
            const fileId = generateFileId();
            const fileType = ext.slice(1);

            await createResearchFile(project.id, session.id, {
              fileId,
              fileName: uniqueFileName,
              originalName,
              filePath,
              fileType,
              mimeType: getMimeType(fileType),
              fileSize: buf.length,
              processingStatus: 'pending',
            });
          } catch (fileErr) {
            console.warn('[from-tool] Optional file attach failed:', fileErr?.message);
          }
        }
      }
    }

    return NextResponse.json({ projectId: project.id });
  } catch (error) {
    console.error('[from-tool] Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project', message: error?.message || 'Please try again.' },
      { status: 500 }
    );
  }
}
