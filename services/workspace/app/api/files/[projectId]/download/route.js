// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import path from 'path';
import archiver from 'archiver';
import { Readable } from 'stream';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { readFile, listDir, fileExists as storageFileExists } from '@/lib/files.js';

// Files/folders to filter out from downloads
const SYSTEM_FOLDERS = new Set([
  'texmf', 'texmf-var', 'texmf-config', 'node_modules'
]);

const SYSTEM_FILE_PATTERNS = [
  /^\./,  // Hidden files
  /\.log$/, /\.aux$/, /\.toc$/, /\.out$/, /\.fls$/,
  /\.fdb_latexmk$/, /\.synctex\.gz$/, /\.bbl$/, /\.blg$/,
  /\.bcf$/, /\.run\.xml$/, /\.nav$/, /\.snm$/, /\.vrb$/,
  /\.lof$/, /\.lot$/, /\.idx$/, /\.ind$/, /\.ilg$/,
  /\.glo$/, /\.gls$/, /\.glg$/, /\.xdv$/, /\.pdf$/,
  /\.backup$/, /\.backup\./,
  /^project_metadata\.json$/, /^paper_data\.json$/,
  /^plan\.json$/, /^report\.txt$/,
  /^package\.json$/, /^package-lock\.json$/, /^yarn\.lock$/,
  /^\.compile\.lock$/, /^\.gitkeep$/
];

function isSystemFolder(name) {
  if (name.startsWith('.')) return true;
  return SYSTEM_FOLDERS.has(name);
}

function isSystemFile(name) {
  return SYSTEM_FILE_PATTERNS.some(pattern => pattern.test(name));
}

export async function GET(req, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(req.url);
    const filePath = searchParams.get('file');
    const type = searchParams.get('type') || 'project'; // 'project' or 'file'

    const projectName = projectId; // Use projectId as name for now

    if (type === 'file' && filePath) {
      // Download single file directly from storage
      const normalized = path.normalize(filePath).replace(/\\/g, '/');
      if (normalized.startsWith('..') || normalized.includes('../')) {
        return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
      }

      const exists = await storageFileExists(projectId, filePath);
      if (!exists) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const content = await readFile(projectId, filePath);
      if (content === null) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      // Determine content type
      let contentType = 'application/octet-stream';
      if (filePath.endsWith('.pdf')) {
        contentType = 'application/pdf';
      } else if (filePath.endsWith('.tex') || filePath.endsWith('.txt') || filePath.endsWith('.bib')) {
        contentType = 'text/plain';
      } else if (filePath.endsWith('.json')) {
        contentType = 'application/json';
      }

      return new NextResponse(content, {
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(content.length),
          'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`
        }
      });

    } else {
      // Download entire project as ZIP
      // Collect all files from storage (MinIO or FS)
      const allFiles = [];

      const collectFiles = async (prefix = '') => {
        const entries = await listDir(projectId, prefix);

        for (const entry of entries) {
          const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory) {
            if (!isSystemFolder(entry.name)) {
              await collectFiles(entryPath);
            }
          } else {
            if (!isSystemFile(entry.name)) {
              allFiles.push(entryPath);
            }
          }
        }
      };

      await collectFiles();

      // Create archive
      const archive = archiver('zip', { zlib: { level: 9 } });

      // Set up response
      const response = new NextResponse(archive, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${projectName}.zip"`
        }
      });

      // Add files to archive by reading from storage
      for (const filePath of allFiles) {
        try {
          const content = await readFile(projectId, filePath);
          if (content !== null) {
            archive.append(content, { name: filePath });
          }
        } catch (err) {
          console.warn(`Failed to read file for archive: ${filePath}`, err.message);
        }
      }

      // Finalize the archive
      archive.finalize();

      return response;
    }

  } catch (error) {
    console.error('Error downloading files:', error);
    return NextResponse.json({ error: 'Failed to download files' }, { status: 500 });
  }
}
