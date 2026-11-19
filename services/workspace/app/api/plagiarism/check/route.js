/**
 * Plagiarism Check API
 * Uses storage readFile - works with both FS and MinIO (no sync needed).
 */

import { NextResponse } from 'next/server';
import { PlagiarismDetector } from '@/lib/plagiarism-detector.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    const plagiarismDetector = new PlagiarismDetector();
    
    let result;
    
    switch (action) {
      case 'check_plagiarism':
        result = await plagiarismDetector.checkPlagiarism(data.projectId, data.options);
        break;
      case 'check_self_plagiarism':
        result = await plagiarismDetector.checkSelfPlagiarism(data.projectId, data.options);
        break;
      case 'generate_report':
        result = await plagiarismDetector.generateReport(data.projectId, data.options);
        break;
      case 'add_to_database':
        result = await plagiarismDetector.addToDatabase(data.projectId, data.metadata);
        break;
      case 'remove_from_database':
        result = await plagiarismDetector.removeFromDatabase(data.projectId);
        break;
      case 'export_report':
        result = await plagiarismDetector.exportReport(data.report, data.format);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in plagiarism check:', error);
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
    
    const plagiarismDetector = new PlagiarismDetector();
    
    let result;
    
    switch (action) {
      case 'database_stats':
        result = plagiarismDetector.getDatabaseStats();
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting plagiarism data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
