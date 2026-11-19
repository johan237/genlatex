/**
 * LaTeX Linting API
 */

import { NextResponse } from 'next/server';
import { LaTeXLinter } from '@/lib/latex-linter.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    // Sync from MinIO before reading
    if (data?.projectId && isMinio()) {
      await syncProjectToLocal(data.projectId).catch(() => {});
    }
    
    const linter = new LaTeXLinter();
    
    let result;
    
    switch (action) {
      case 'lint_document':
        result = await linter.lintDocument(data.projectId, data.options);
        break;
      case 'fix_issues':
        result = await linter.fixIssues(data.projectId, data.issues, data.options);
        break;
      case 'export_report':
        result = await linter.exportReport(data.issues, data.format);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    // Sync to MinIO after writes (fix_issues modifies files)
    if (data?.projectId && action === 'fix_issues' && isMinio()) {
      await syncProjectFromLocal(data.projectId).catch(err =>
        console.warn('MinIO sync after latex lint:', err?.message)
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in LaTeX linting:', error);
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
    
    const linter = new LaTeXLinter();
    
    let result;
    
    switch (action) {
      case 'available_rules':
        result = linter.getAvailableRules();
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting linting data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
