import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { readFile, writeFile } from '@/lib/files.js';

function sanitizePathList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const files = [];
  for (const raw of values) {
    const value = String(raw || '').trim().replace(/\\/g, '/');
    if (!value) continue;
    if (value.startsWith('/') || value.includes('..')) continue;
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    files.push(value);
  }
  return files;
}

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const access = await requireProjectAccess(projectId, { requireEdit: true });
    if (access instanceof NextResponse) return access;

    const body = await request.json().catch(() => ({}));
    const tag = String(body.tag || '').trim();
    const files = sanitizePathList(body.files);

    if (!tag) {
      return NextResponse.json({ success: false, error: 'tag is required' }, { status: 400 });
    }
    if (!files.length) {
      return NextResponse.json({ success: false, error: 'files must contain at least one path' }, { status: 400 });
    }

    let projectManifest = {
      id: projectId,
      name: '',
      template: 'default',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: [],
      tags: []
    };

    try {
      const raw = await readFile(projectId, 'project.json', { encoding: 'utf8' });
      if (raw) {
        const parsed = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
        if (parsed && typeof parsed === 'object') {
          projectManifest = { ...projectManifest, ...parsed };
        }
      }
    } catch {
      // keep fallback manifest
    }

    const existingTags = Array.isArray(projectManifest.tags) ? projectManifest.tags : [];
    const filtered = existingTags.filter((entry) => String(entry?.tag || '').toLowerCase() !== tag.toLowerCase());
    filtered.push({ tag, files });

    projectManifest.tags = filtered;
    projectManifest.updatedAt = new Date().toISOString();

    await writeFile(projectId, 'project.json', JSON.stringify(projectManifest, null, 2));

    return NextResponse.json({
      success: true,
      tag,
      files,
      tags: projectManifest.tags
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to update tag mapping' },
      { status: 500 }
    );
  }
}
