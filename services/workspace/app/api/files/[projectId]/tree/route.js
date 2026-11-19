// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { listDir, isMinio } from '@/lib/files.js';

// Files/folders to filter out from the tree
const SYSTEM_FOLDERS = new Set([
  'texmf', 'texmf-var', 'texmf-config', 'node_modules', 'template'
]);

const SYSTEM_FILE_EXTENSIONS = new Set([
  '.log', '.aux', '.toc', '.out', '.fls', '.fdb_latexmk', '.synctex.gz',
  '.bbl', '.blg', '.backup', '.bak', '.tmp', '.swp', '.swo', '.orig', '.rej',
  '.pyc', '.pyo', '.class', '.o', '.so', '.dll', '.exe', '.bin', '.lock'
]);

const SYSTEM_FILE_NAMES = new Set([
  'package-lock.json', 'yarn.lock', 'project_metadata.json',
  'paper_data.json', 'plan.json', 'report.txt', '.compile.lock',
  'analysis.json', 'detailed_plan.json', 'rough_plan.json',
  'latex_review.json', 'abstract.txt'
]);

function isSystemFolder(name) {
  if (name.startsWith('.')) return true;
  if (SYSTEM_FOLDERS.has(name)) return true;
  if (name.startsWith('LOCAL_APPDATA') || name.startsWith('TEMP_') || name.startsWith('SYSTEM_')) return true;
  if (name.includes('CACHE') || name.includes('TEMP') || name.includes('SYSTEM')) return true;
  return false;
}

function isSystemFile(name) {
  if (name.startsWith('.')) return true;
  if (name.toLowerCase().endsWith('.pdf')) return true; // PDFs shown separately
  if (SYSTEM_FILE_NAMES.has(name)) return true;

  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (SYSTEM_FILE_EXTENSIONS.has(ext)) return true;

  if (name.startsWith('temp_') || name.startsWith('texmf')) return true;
  return false;
}

export async function GET(_req, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    // Build file tree directly from storage (MinIO or FS)
    const buildTree = async (subdir = '') => {
      const items = [];
      const entries = await listDir(projectId, subdir);

      for (const entry of entries) {
        const itemPath = subdir ? `${subdir}/${entry.name}` : entry.name;

        if (entry.isDirectory) {
          if (!isSystemFolder(entry.name)) {
            items.push({
              name: entry.name,
              path: itemPath,
              type: 'folder',
              children: await buildTree(itemPath)
            });
          }
        } else {
          if (!isSystemFile(entry.name)) {
            items.push({
              name: entry.name,
              path: itemPath,
              type: 'file'
              // Note: size not available from MinIO listDir without statObject
            });
          }
        }
      }

      return items.sort((a, b) => {
        // Folders first, then files
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    };

    const files = await buildTree();

    return NextResponse.json({ files }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' }
    });

  } catch (error) {
    console.error('Error loading file tree:', error);
    return NextResponse.json({ error: 'Failed to load file tree' }, { status: 500 });
  }
}
