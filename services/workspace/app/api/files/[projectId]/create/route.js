// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { normalizeProjectPath } from '@/lib/project-path.js';
import { writeFile, fileExists as storageFileExists } from '@/lib/files.js';

/** Editable file extensions allowed for user-created files. No extension → treated as .txt */
const EDITABLE_EXTENSIONS = new Set([
  '.tex', '.bib', '.sty', '.cls', '.md', '.txt', '.json', '.csv', '.yml', '.yaml',
  '.toml', '.cfg', '.ini', '.log', '.tex.latexmain', '.latexmain'
]);

function normalizeFileNameForCreate(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return null;
  const ext = path.extname(trimmed).toLowerCase();
  if (!ext) return trimmed.endsWith('.') ? trimmed + 'txt' : trimmed + '.txt';
  return trimmed;
}

function isEditableExtension(name) {
  const ext = path.extname(name).toLowerCase();
  if (!ext) return true; // will be normalized to .txt
  return EDITABLE_EXTENSIONS.has(ext);
}

export async function POST(req, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const { type, name, path: filePath } = await req.json();

    if (!name || !type) {
      return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
    }

    const normalizedName = normalizeFileNameForCreate(name);
    if (!normalizedName) {
      return NextResponse.json({ error: 'Invalid file name' }, { status: 400 });
    }
    if (type === 'file' && !isEditableExtension(normalizedName)) {
      return NextResponse.json(
        { error: `Only editable file types are allowed. Allowed extensions: ${[...EDITABLE_EXTENSIONS].join(', ')}` },
        { status: 400 }
      );
    }

    // Build the relative path within the project
    const relativePathRaw = filePath
      ? `${filePath}/${type === 'file' ? normalizedName : name}`
      : (type === 'file' ? normalizedName : name);

    const normalized = normalizeProjectPath(relativePathRaw);
    if (!normalized) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }

    if (type === 'folder') {
      // For folders in object storage, we create a placeholder file
      // (MinIO doesn't have real folders, they're derived from key prefixes)
      const placeholderPath = `${normalized}/.gitkeep`;

      // Check if folder already has content
      if (await storageFileExists(projectId, placeholderPath)) {
        return NextResponse.json({ error: 'Folder already exists' }, { status: 400 });
      }

      // Create placeholder to establish the folder
      await writeFile(projectId, placeholderPath, '');

      // If creating images folder, add a README
      if (name === 'images') {
        const readmePath = `${normalized}/README.md`;
        const readmeContent = `# Images Folder

This folder contains images for your LaTeX project.

## Usage

To include images in your LaTeX document, use:

\\begin{figure}[h]
\\centering
\\includegraphics[width=0.8\\textwidth]{images/your-image.png}
\\caption{Your caption here}
\\label{fig:your-label}
\\end{figure}

## Supported Formats

- PNG (.png)
- JPEG (.jpg, .jpeg)
- PDF (.pdf)
- EPS (.eps)
- SVG (.svg)

## Tips

- Use descriptive filenames
- Keep images reasonably sized for web viewing
- Consider using vector formats (PDF, EPS, SVG) for diagrams
`;
        await writeFile(projectId, readmePath, readmeContent);
      }
    } else if (type === 'file') {
      // Check if file already exists
      if (await storageFileExists(projectId, normalized)) {
        return NextResponse.json({ error: 'File already exists' }, { status: 400 });
      }

      const ext = path.extname(normalizedName).toLowerCase();
      let content = '';

      switch (ext) {
        case '.tex':
          content = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}

\\title{${normalizedName.replace(/\.tex$/i, '')}}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

Your content here.

\\end{document}`;
          break;
        case '.txt':
          content = '';
          break;
        case '.bib':
          content = `@article{example,
  title={Example Article},
  author={Author, Name},
  journal={Journal Name},
  year={2024}
}`;
          break;
        case '.sty':
          content = `% Custom style file: ${normalizedName}
\\NeedsTeXFormat{LaTeX2e}
\\ProvidesPackage{${normalizedName.replace(/\.sty$/i, '')}}[2024/01/01 Custom package]

% Your package code here

\\endinput`;
          break;
        case '.cls':
          content = `% Custom class file: ${normalizedName}
\\NeedsTeXFormat{LaTeX2e}
\\ProvidesClass{${normalizedName.replace(/\.cls$/i, '')}}[2024/01/01 Custom class]

% Your class code here

\\endinput`;
          break;
        default:
          content = '';
      }

      // Write directly to storage (MinIO or FS)
      await writeFile(projectId, normalized, content);
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error creating file/folder:', error);
    return NextResponse.json({ error: 'Failed to create file/folder' }, { status: 500 });
  }
}
