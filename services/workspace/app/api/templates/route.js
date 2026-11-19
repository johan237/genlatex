/**
 * Template Gallery API
 * Provides access to LaTeX template library
 */

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const TEMPLATES_DIR = path.resolve(process.cwd(), 'templates');

/**
 * Load template index
 */
async function loadTemplateIndex() {
  try {
    const indexPath = path.join(TEMPLATES_DIR, 'index.json');
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(indexContent);
  } catch (error) {
    console.error('Failed to load template index:', error);
    return { categories: {}, colorSchemes: {}, styleKeywords: {} };
  }
}

/**
 * Load all templates with metadata
 */
async function loadAllTemplates() {
  const templates = [];

  try {
    const categories = await fs.readdir(TEMPLATES_DIR);

    for (const category of categories) {
      const categoryPath = path.join(TEMPLATES_DIR, category);

      // Skip files and special directories
      const stat = await fs.stat(categoryPath);
      if (!stat.isDirectory() || category.startsWith('.') || ['styles', 'assets'].includes(category)) {
        continue;
      }

      const templateDirs = await fs.readdir(categoryPath);

      for (const templateDir of templateDirs) {
        const templatePath = path.join(categoryPath, templateDir);
        const stat2 = await fs.stat(templatePath);

        if (!stat2.isDirectory()) continue;

        const metadataPath = path.join(templatePath, 'metadata.json');

        try {
          await fs.access(metadataPath);
          const metadataContent = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(metadataContent);

          templates.push({
            ...metadata,
            relativePath: `${category}/${templateDir}`
          });
        } catch (error) {
          // Metadata file doesn't exist or is invalid
          console.warn(`No valid metadata for template: ${category}/${templateDir}`);
        }
      }
    }
  } catch (error) {
    console.error('Failed to load templates:', error);
  }

  return templates;
}

/**
 * GET /api/templates
 * Get all templates or filter by category
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const style = searchParams.get('style');
  const color = searchParams.get('color');

  try {
    // Load index and templates
    const [index, allTemplates] = await Promise.all([
      loadTemplateIndex(),
      loadAllTemplates()
    ]);

    // Filter templates
    let templates = allTemplates;

    if (category) {
      templates = templates.filter(t => t.category === category);
    }

    if (style) {
      templates = templates.filter(t => t.style === style);
    }

    if (color) {
      templates = templates.filter(t => t.colorScheme === color);
    }

    return NextResponse.json({
      success: true,
      templates,
      categories: index.categories,
      colorSchemes: index.colorSchemes,
      styleKeywords: index.styleKeywords,
      total: templates.length
    });
  } catch (error) {
    console.error('Template API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load templates',
        templates: [],
        categories: {},
        total: 0
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/templates/[templateId]
 * Get specific template details and content
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { templateId } = body;

    if (!templateId) {
      return NextResponse.json(
        { success: false, error: 'Template ID required' },
        { status: 400 }
      );
    }

    // Load all templates and find the requested one
    const allTemplates = await loadAllTemplates();
    const template = allTemplates.find(t => t.id === templateId);

    if (!template) {
      return NextResponse.json(
        { success: false, error: 'Template not found' },
        { status: 404 }
      );
    }

    // Load template content
    const templatePath = path.join(TEMPLATES_DIR, template.relativePath, 'template.tex');

    try {
      const templateContent = await fs.readFile(templatePath, 'utf-8');

      return NextResponse.json({
        success: true,
        template: {
          ...template,
          content: templateContent
        }
      });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Template file not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('Template detail API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load template' },
      { status: 500 }
    );
  }
}
