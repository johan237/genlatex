/**
 * Figure Generation API
 */

import { NextResponse } from 'next/server';
import { FigureGenerator } from '@/lib/figure-generator.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    // Sync from MinIO before reading
    if (data?.projectId && isMinio()) {
      await syncProjectToLocal(data.projectId).catch(() => {});
    }
    
    const figureGenerator = new FigureGenerator();
    
    let result;
    
    switch (action) {
      case 'generate_figure':
        result = await figureGenerator.generateFigure(data.projectId, data.figureType, data.data, data.options);
        break;
      case 'generate_from_code':
        result = await figureGenerator.generateFromCodeAnalysis(data.projectId, data.analysis, data.options);
        break;
      case 'generate_from_data':
        result = await figureGenerator.generateFromData(data.projectId, data.data, data.figureType, data.options);
        break;
      case 'generate_gallery':
        result = await figureGenerator.generateFigureGallery(data.projectId, data.options);
        break;
      case 'export_figure':
        result = await figureGenerator.exportFigure(data.figureId, data.format, data.options);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    // Sync to MinIO after writes (figure generation creates files)
    if (data?.projectId && ['generate_figure', 'generate_from_code', 'generate_from_data', 'generate_gallery'].includes(action) && isMinio()) {
      await syncProjectFromLocal(data.projectId).catch(err =>
        console.warn('MinIO sync after figure generation:', err?.message)
      );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in figure generation:', error);
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
    
    const figureGenerator = new FigureGenerator();
    
    let result;
    
    switch (action) {
      case 'available_templates':
        result = figureGenerator.getAvailableTemplates();
        break;
      case 'generated_figures':
        if (!projectId) {
          return NextResponse.json(
            { error: 'Project ID is required' },
            { status: 400 }
          );
        }
        result = figureGenerator.getGeneratedFigures(projectId);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting figure data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const figureId = searchParams.get('figureId');
    
    if (!projectId || !figureId) {
      return NextResponse.json(
        { error: 'Project ID and Figure ID are required' },
        { status: 400 }
      );
    }
    
    const figureGenerator = new FigureGenerator();
    const result = await figureGenerator.deleteFigure(projectId, figureId);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error deleting figure:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
