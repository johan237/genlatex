// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { readFile } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { projectId, filePaths } = await request.json();

    if (!projectId || !filePaths || !Array.isArray(filePaths)) {
      return NextResponse.json({ error: 'Project ID and file paths are required' }, { status: 400 });
    }

    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const fileContents = {};
    const fileErrors = {};

    // Read contents of each file directly from storage (MinIO or FS)
    for (const filePath of filePaths) {
      try {
        // Validate path (no directory traversal)
        const normalized = path.normalize(filePath).replace(/\\/g, '/');
        if (normalized.startsWith('..') || normalized.includes('../') || path.isAbsolute(normalized)) {
          fileContents[filePath] = null;
          fileErrors[filePath] = 'Invalid file path';
          continue;
        }

        const content = await readFile(projectId, filePath, { encoding: 'utf8' });
        if (content === null) {
          fileContents[filePath] = null;
          fileErrors[filePath] = 'File not found';
        } else {
          fileContents[filePath] = content;
        }
      } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        fileContents[filePath] = null;
        fileErrors[filePath] = error?.message ? String(error.message).slice(0, 200) : 'Failed to read file';
      }
    }

    return NextResponse.json({ fileContents, fileErrors });
  } catch (error) {
    console.error('Error in file content API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
