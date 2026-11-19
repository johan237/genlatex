/**
 * BibTeX Management API
 */

import { NextResponse } from 'next/server';
import { BibTeXManager } from '@/lib/bibtex-manager.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const action = searchParams.get('action') || 'load';
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    // Sync from MinIO before reading
    if (isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }

    const bibtexManager = new BibTeXManager();
    
    let result;
    
    if (action === 'load') {
      result = await bibtexManager.loadBibTeX(projectId);
    } else if (action === 'validate') {
      await bibtexManager.loadBibTeX(projectId);
      result = bibtexManager.validateEntries();
    } else if (action === 'unused') {
      await bibtexManager.loadBibTeX(projectId);
      const paperContent = searchParams.get('paperContent') || '';
      result = bibtexManager.findUnusedReferences(paperContent);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "load", "validate", or "unused"' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error managing BibTeX:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const { projectId, action, data } = await request.json();
    
    if (!projectId || !action) {
      return NextResponse.json(
        { error: 'Project ID and action are required' },
        { status: 400 }
      );
    }
    
    // Sync from MinIO before reading
    if (isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }

    const bibtexManager = new BibTeXManager();
    await bibtexManager.loadBibTeX(projectId);
    
    let result;
    
    if (action === 'add') {
      const key = bibtexManager.addEntry(data);
      result = { success: true, key };
    } else if (action === 'update') {
      const success = bibtexManager.updateEntry(data.key, data.updates);
      result = { success };
    } else if (action === 'remove') {
      const success = bibtexManager.removeEntry(data.key);
      result = { success };
    } else if (action === 'search') {
      const results = bibtexManager.searchEntries(data.query);
      result = { success: true, results };
    } else if (action === 'suggestions') {
      result = await bibtexManager.getCitationSuggestions(data.paperContent, data.limit);
    } else if (action === 'from-doi') {
      result = await bibtexManager.generateFromDOI(data.doi);
    } else if (action === 'from-url') {
      result = await bibtexManager.generateFromURL(data.url);
    } else if (action === 'fix') {
      const fixes = bibtexManager.fixMalformedEntries();
      result = { success: true, fixes };
    } else {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      );
    }
    
    // Save changes if applicable
    if (['add', 'update', 'remove', 'fix'].includes(action)) {
      await bibtexManager.saveBibTeX(projectId);
      // Sync to MinIO after writing
      if (isMinio()) {
        await syncProjectFromLocal(projectId).catch(err =>
          console.warn('MinIO sync after bibtex save:', err?.message)
        );
      }
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error managing BibTeX:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
