/**
 * Export Formats API
 */

import { NextResponse } from 'next/server';
import { ExportManager } from '@/lib/export-manager.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    // Sync from MinIO before reading
    if (data?.projectId && isMinio()) {
      await syncProjectToLocal(data.projectId).catch(() => {});
    }
    
    const exportManager = new ExportManager();
    
    let result;
    
    switch (action) {
      case 'export':
        result = await exportManager.exportDocument(data.projectId, data.format, data.options);
        break;
      case 'batch_export':
        result = await exportManager.batchExport(data.projectId, data.formats, data.options);
        break;
      case 'save_to_history':
        result = await exportManager.saveExportToHistory(data.projectId, data.exportResult);
        break;
      case 'cleanup':
        result = await exportManager.cleanupOldExports(data.projectId, data.maxAge);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    // Sync to MinIO after writes
    if (data?.projectId && ['export', 'batch_export', 'save_to_history'].includes(action) && isMinio()) {
      await syncProjectFromLocal(data.projectId).catch(err =>
        console.warn('MinIO sync after export:', err?.message)
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in export formats:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const action = searchParams.get('action');
    
    const exportManager = new ExportManager();
    
    let result;
    
    switch (action) {
      case 'supported_formats':
        result = exportManager.getSupportedFormats();
        break;
      case 'check_availability':
        const format = searchParams.get('format');
        result = await exportManager.checkFormatAvailability(format);
        break;
      case 'history':
        if (!projectId) {
          return NextResponse.json(
            { error: 'Project ID is required' },
            { status: 400 }
          );
        }
        result = await exportManager.getExportHistory(projectId);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting export data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
