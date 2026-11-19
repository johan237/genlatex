/**
 * Project Templates API
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { ProjectTemplatesManager } from '@/lib/project-templates.js';
import { createProject } from '@/lib/projects-storage.js';

export async function POST(request) {
  try {
    const body = await request.json();
    
    // Handle new format from template selector
    if (body.templateId && body.projectName) {
      const { templateId, projectName, projectDescription, metadata } = body;
      
      // Check session
      const session = await getSessionFromRequest();
      if (!session?.id) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
      
      const templatesManager = new ProjectTemplatesManager();
      
      // Create a new project directly using the storage function
      const project = await createProject(session.id, projectName);
      
      // Apply template to the project
      const result = await templatesManager.createProjectFromTemplate(
        project.id, 
        templateId, 
        {
          description: projectDescription,
          metadata: metadata
        }
      );
      
      return NextResponse.json({
        success: true,
        project: project,
        template: result
      });
    }
    
    // Handle legacy format
    const { action, data } = body;
    const templatesManager = new ProjectTemplatesManager();
    
    let result;
    
    switch (action) {
      case 'create_from_template':
        result = await templatesManager.createProjectFromTemplate(data.projectId, data.templateId, data.options);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in project templates:', error);
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
    const category = searchParams.get('category');
    const templateId = searchParams.get('templateId');
    
    const templatesManager = new ProjectTemplatesManager();
    
    let result;
    
    // If no action specified, return all available templates (default behavior)
    if (!action) {
      result = templatesManager.getAvailableTemplates();
    } else {
      switch (action) {
        case 'available_templates':
          result = templatesManager.getAvailableTemplates();
          break;
        case 'template_details':
          if (!templateId) {
            return NextResponse.json(
              { error: 'Template ID is required' },
              { status: 400 }
            );
          }
          result = templatesManager.getTemplate(templateId);
          break;
        case 'templates_by_category':
          if (!category) {
            return NextResponse.json(
              { error: 'Category is required' },
              { status: 400 }
            );
          }
          result = templatesManager.getTemplatesByCategory(category);
          break;
        default:
          return NextResponse.json(
            { error: 'Invalid action' },
            { status: 400 }
          );
      }
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting template data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
