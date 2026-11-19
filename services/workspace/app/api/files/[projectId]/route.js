// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { readFile, writeFile, fileExists as storageFileExists, isMinio } from '@/lib/files.js';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { normalizeProjectPath } from '@/lib/project-path.js';
import { createHash, randomUUID } from 'crypto';
import path from 'path';

const MAIN_TEX = 'main.tex';
const TEXT_FILE_EXTENSIONS = new Set([
  '.tex', '.bib', '.sty', '.cls', '.txt', '.md', '.json', '.csv', '.yaml', '.yml', '.xml', '.log'
]);
const BINARY_FILE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.eot'
]);
const ALLOWED_FILE_EXTENSIONS = new Set([...TEXT_FILE_EXTENSIONS, ...BINARY_FILE_EXTENSIONS]);

function hashContent(content) {
  const hash = createHash('sha256');
  if (Buffer.isBuffer(content)) {
    hash.update(content);
  } else if (content == null) {
    hash.update('', 'utf8');
  } else {
    hash.update(String(content), 'utf8');
  }
  return hash.digest('hex');
}

function parseBinaryContent(content, contentEncoding) {
  if (Buffer.isBuffer(content)) return content;
  if (Array.isArray(content)) return Buffer.from(content);
  if (typeof content !== 'string') return null;

  if (contentEncoding === 'base64') {
    return Buffer.from(content, 'base64');
  }

  if (content.startsWith('data:')) {
    const commaIndex = content.indexOf(',');
    if (commaIndex >= 0) {
      return Buffer.from(content.slice(commaIndex + 1), 'base64');
    }
  }

  return Buffer.from(content, 'utf8');
}

export async function GET(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId);
  if (access instanceof NextResponse) return access;

  const { searchParams } = new URL(req.url);
  const fileParam = searchParams.get('file') ?? '';
  const requestId = req.headers.get('x-request-id') || randomUUID();

  const fileToUse = normalizeProjectPath(fileParam) ?? MAIN_TEX;

  let content = '';
  const exists = await storageFileExists(projectId, fileToUse);
  if (exists) {
    const data = await readFile(projectId, fileToUse, { encoding: 'utf8' });
    content = data != null ? (Buffer.isBuffer(data) ? data.toString('utf8') : data) : '';
  } else if (fileToUse === MAIN_TEX) {
    content = defaultTemplate();
    await writeFile(projectId, fileToUse, content);
  }

  const version = hashContent(content);
  const res = NextResponse.json({ content, file: fileToUse, version, requestId });
  res.headers.set('x-request-id', requestId);
  res.headers.set('etag', version);
  return res;
}

export async function POST(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { requireEdit: true });
  if (access instanceof NextResponse) return access;

  const body = await req.json();
  const content = body.content ?? '';
  const contentEncoding = String(body.contentEncoding || '').toLowerCase();
  const fileParam = body.file ?? '';
  const expectedVersion = body.expectedVersion || req.headers.get('if-match');
  const requestId = req.headers.get('x-request-id') || randomUUID();

  const fileToUse = normalizeProjectPath(fileParam) ?? MAIN_TEX;
  const fileExt = path.extname(fileToUse).toLowerCase();
  const isBinaryFile = BINARY_FILE_EXTENSIONS.has(fileExt);

  if (!ALLOWED_FILE_EXTENSIONS.has(fileExt)) {
    const res = NextResponse.json({ error: 'File type not allowed', requestId }, { status: 400 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  if (fileExt === '.tex' && (!content || String(content).trim().length < 10)) {
    const res = NextResponse.json({
      error: 'Cannot save empty LaTeX file',
      message: 'The file content is empty or too short. This may indicate a generation issue.',
      requestId
    }, { status: 400 });
    res.headers.set('x-request-id', requestId);
    return res;
  }

  try {
    let currentVersion = null;
    if (await storageFileExists(projectId, fileToUse)) {
      const currentData = await readFile(projectId, fileToUse);
      currentVersion = hashContent(currentData ?? '');
    }

    if (expectedVersion && currentVersion && expectedVersion !== currentVersion) {
      const res = NextResponse.json({
        error: 'Conflict',
        message: 'File has changed on the server. Reload and try again.',
        currentVersion,
        requestId
      }, { status: 409 });
      res.headers.set('x-request-id', requestId);
      res.headers.set('etag', currentVersion);
      return res;
    }

    const payload = isBinaryFile ? parseBinaryContent(content, contentEncoding) : String(content);
    if (payload == null) {
      const res = NextResponse.json({
        error: 'Invalid binary payload',
        message: 'Binary file content must be base64, data URI, or byte array.',
        requestId
      }, { status: 400 });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    await writeFile(projectId, fileToUse, payload);

    const newVersion = hashContent(payload);
    const size = Buffer.isBuffer(payload) ? payload.length : String(payload).length;
    console.log(`Saved file: ${fileToUse} (${size} bytes)${isMinio() ? ' [MinIO]' : ''}`);

    const res = NextResponse.json({ ok: true, version: newVersion, requestId });
    res.headers.set('x-request-id', requestId);
    res.headers.set('etag', newVersion);
    return res;
  } catch (error) {
    console.error(`Failed to save file ${fileToUse}:`, error);
    const res = NextResponse.json({ error: 'Failed to save file', requestId }, { status: 500 });
    res.headers.set('x-request-id', requestId);
    return res;
  }
}

function defaultTemplate() {
  return `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\title{GenLaTeX}
\\author{Author}
\\date{\\today}

\\begin{document}
\\maketitle

Hello GenLaTeX! This is your first LaTeX document.

\\end{document}`;
}
