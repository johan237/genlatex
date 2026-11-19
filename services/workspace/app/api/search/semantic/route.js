/**
 * Semantic Search API
 */

import { NextResponse } from 'next/server';
import { SmartSearchEngine } from '@/lib/smart-search.js';
import { isMinio, syncProjectToLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { query, projectId, searchType = 'semantic', options = {} } = await request.json();
    
    if (!query) {
      return NextResponse.json(
        { error: 'Search query is required' },
        { status: 400 }
      );
    }

    // Sync from MinIO before reading (search needs to read project files)
    if (projectId && isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }
    
    const searchEngine = await SmartSearchEngine.getInstance();
    
    let result;
    
    if (searchType === 'semantic') {
      result = await searchEngine.semanticSearch(query, projectId, options);
    } else if (searchType === 'keyword') {
      result = await searchEngine.search(query, projectId, options);
    } else if (searchType === 'cross-domain') {
      if (!projectId) {
        return NextResponse.json(
          { error: 'Project ID is required for cross-domain search' },
          { status: 400 }
        );
      }
      result = await searchEngine.crossDomainSearch(query, projectId, options);
    } else {
      return NextResponse.json(
        { error: 'Invalid search type. Use "semantic", "keyword", or "cross-domain"' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error performing search:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const { projectId } = await request.json();
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (projectId && isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }
    
    const searchEngine = await SmartSearchEngine.getInstance();
    const result = await searchEngine.indexProject(projectId);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error indexing project:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
