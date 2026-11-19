/**
 * Advanced Bibliography API
 */

import { NextResponse } from 'next/server';
import { BibliographyManager } from '@/lib/bibliography-manager.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    // Sync from MinIO before reading
    if (data?.projectId && isMinio()) {
      await syncProjectToLocal(data.projectId).catch(() => {});
    }
    
    const bibManager = new BibliographyManager();
    
    let result;
    
    switch (action) {
      case 'generate_bibliography':
        result = await bibManager.generateBibliography(data.projectId, data.style, data.options);
        break;
      case 'validate_bibliography':
        result = await bibManager.validateBibliography(data.projectId);
        break;
      case 'fix_issues':
        result = await bibManager.fixBibliographyIssues(data.projectId);
        break;
      case 'generate_report':
        result = await bibManager.generateCitationReport(data.projectId);
        break;
      case 'format_citation':
        result = bibManager.formatCitation(data.entry, data.style);
        break;
      case 'format_in_text':
        result = bibManager.formatInTextCitation(data.entry, data.style, data.context);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    // Sync to MinIO after writes
    if (data?.projectId && ['fix_issues'].includes(action) && isMinio()) {
      await syncProjectFromLocal(data.projectId).catch(err =>
        console.warn('MinIO sync after bibliography:', err?.message)
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in advanced bibliography:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    
    const bibManager = new BibliographyManager();
    
    let result;
    
    switch (action) {
      case 'available_styles':
        result = {
          success: true,
          styles: [
            { id: 'ieee', name: 'IEEE', description: 'Institute of Electrical and Electronics Engineers' },
            { id: 'apa', name: 'APA', description: 'American Psychological Association' },
            { id: 'mla', name: 'MLA', description: 'Modern Language Association' },
            { id: 'chicago', name: 'Chicago', description: 'Chicago Manual of Style' },
            { id: 'acm', name: 'ACM', description: 'Association for Computing Machinery' }
          ]
        };
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting bibliography data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
