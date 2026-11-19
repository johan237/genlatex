/**
 * Export Manager
 * Handles multiple export formats for LaTeX documents
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { getProjectPath } from './files.js';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ExportManager {
  constructor() {
    this.supportedFormats = [
      'pdf', 'html', 'docx', 'odt', 'epub', 'rtf', 'txt', 'xml'
    ];
    this.exportQueue = new Map();
  }

  /**
   * Export document to specified format
   */
  async exportDocument(projectId, format, options = {}) {
    try {
      if (!this.supportedFormats.includes(format)) {
        return {
          success: false,
          error: `Unsupported format: ${format}. Supported formats: ${this.supportedFormats.join(', ')}`
        };
      }

      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const mainFile = options.mainFile || 'main.tex';
      const outputPath = path.join(projectPath, `export_${Date.now()}`);

      // Create export directory
      await fs.mkdir(outputPath, { recursive: true });

      let result;
      switch (format) {
        case 'pdf':
          result = await this.exportToPDF(projectPath, mainFile, outputPath, options);
          break;
        case 'html':
          result = await this.exportToHTML(projectPath, mainFile, outputPath, options);
          break;
        case 'docx':
          result = await this.exportToDOCX(projectPath, mainFile, outputPath, options);
          break;
        case 'odt':
          result = await this.exportToODT(projectPath, mainFile, outputPath, options);
          break;
        case 'epub':
          result = await this.exportToEPUB(projectPath, mainFile, outputPath, options);
          break;
        case 'rtf':
          result = await this.exportToRTF(projectPath, mainFile, outputPath, options);
          break;
        case 'txt':
          result = await this.exportToTXT(projectPath, mainFile, outputPath, options);
          break;
        case 'xml':
          result = await this.exportToXML(projectPath, mainFile, outputPath, options);
          break;
        default:
          throw new Error(`Export method not implemented for format: ${format}`);
      }

      if (result.success) {
        return {
          success: true,
          format,
          outputPath: result.outputPath,
          downloadUrl: `/api/export/download/${path.basename(outputPath)}`,
          metadata: result.metadata || {}
        };
      } else {
        return result;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export to PDF using LaTeX compilation
   */
  async exportToPDF(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      
      // Check if main file exists
      await fs.access(mainFilePath);

      // Compile LaTeX to PDF
      const compileCommand = options.compiler || 'pdflatex';
      const compileOptions = options.compileOptions || '-interaction=nonstopmode';
      
      await execAsync(`${compileCommand} ${compileOptions} -output-directory="${outputPath}" "${mainFilePath}"`);
      
      // Run again for references
      await execAsync(`${compileCommand} ${compileOptions} -output-directory="${outputPath}" "${mainFilePath}"`);

      const pdfPath = path.join(outputPath, path.basename(mainFile, '.tex') + '.pdf');
      
      // Check if PDF was created
      await fs.access(pdfPath);

      return {
        success: true,
        outputPath: pdfPath,
        metadata: {
          format: 'pdf',
          compiler: compileCommand,
          pages: await this.getPDFPageCount(pdfPath)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `PDF export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to HTML using LaTeX2HTML or similar
   */
  async exportToHTML(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      
      // Try different HTML conversion methods
      let htmlPath;
      
      try {
        // Method 1: Use pandoc (if available)
        await execAsync(`pandoc "${mainFilePath}" -o "${path.join(outputPath, 'output.html')}" --standalone --mathjax`);
        htmlPath = path.join(outputPath, 'output.html');
      } catch (pandocError) {
        try {
          // Method 2: Use htlatex
          await execAsync(`htlatex "${mainFilePath}" "html,mathml" "" "" -output-directory="${outputPath}"`);
          htmlPath = path.join(outputPath, path.basename(mainFile, '.tex') + '.html');
        } catch (htlatexError) {
          // Method 3: Use latex2html
          await execAsync(`latex2html -dir "${outputPath}" "${mainFilePath}"`);
          htmlPath = path.join(outputPath, 'index.html');
        }
      }

      // Check if HTML was created
      await fs.access(htmlPath);

      return {
        success: true,
        outputPath: htmlPath,
        metadata: {
          format: 'html',
          method: 'pandoc/htlatex/latex2html'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `HTML export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to DOCX using pandoc
   */
  async exportToDOCX(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const docxPath = path.join(outputPath, 'output.docx');
      
      // Use pandoc to convert LaTeX to DOCX
      const pandocOptions = [
        '--standalone',
        '--reference-doc=' + (options.referenceDoc || ''),
        '--bibliography=' + path.join(projectPath, 'references.bib'),
        '--csl=' + (options.cslFile || '')
      ].filter(opt => opt && !opt.includes('=') || opt.split('=')[1]).join(' ');

      await execAsync(`pandoc "${mainFilePath}" -o "${docxPath}" ${pandocOptions}`);

      // Check if DOCX was created
      await fs.access(docxPath);

      return {
        success: true,
        outputPath: docxPath,
        metadata: {
          format: 'docx',
          method: 'pandoc'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `DOCX export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to ODT using pandoc
   */
  async exportToODT(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const odtPath = path.join(outputPath, 'output.odt');
      
      // Use pandoc to convert LaTeX to ODT
      await execAsync(`pandoc "${mainFilePath}" -o "${odtPath}" --standalone`);

      // Check if ODT was created
      await fs.access(odtPath);

      return {
        success: true,
        outputPath: odtPath,
        metadata: {
          format: 'odt',
          method: 'pandoc'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `ODT export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to EPUB using pandoc
   */
  async exportToEPUB(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const epubPath = path.join(outputPath, 'output.epub');
      
      // Use pandoc to convert LaTeX to EPUB
      const pandocOptions = [
        '--standalone',
        '--epub-cover-image=' + (options.coverImage || ''),
        '--epub-metadata=' + (options.metadataFile || '')
      ].filter(opt => opt && !opt.includes('=') || opt.split('=')[1]).join(' ');

      await execAsync(`pandoc "${mainFilePath}" -o "${epubPath}" ${pandocOptions}`);

      // Check if EPUB was created
      await fs.access(epubPath);

      return {
        success: true,
        outputPath: epubPath,
        metadata: {
          format: 'epub',
          method: 'pandoc'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `EPUB export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to RTF using pandoc
   */
  async exportToRTF(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const rtfPath = path.join(outputPath, 'output.rtf');
      
      // Use pandoc to convert LaTeX to RTF
      await execAsync(`pandoc "${mainFilePath}" -o "${rtfPath}" --standalone`);

      // Check if RTF was created
      await fs.access(rtfPath);

      return {
        success: true,
        outputPath: rtfPath,
        metadata: {
          format: 'rtf',
          method: 'pandoc'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `RTF export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to plain text
   */
  async exportToTXT(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const txtPath = path.join(outputPath, 'output.txt');
      
      // Read LaTeX content
      const content = await fs.readFile(mainFilePath, 'utf-8');
      
      // Convert LaTeX to plain text (basic conversion)
      const plainText = this.convertLaTeXToText(content);
      
      // Write to file
      await fs.writeFile(txtPath, plainText, 'utf-8');

      return {
        success: true,
        outputPath: txtPath,
        metadata: {
          format: 'txt',
          method: 'basic_conversion'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `TXT export failed: ${error.message}`
      };
    }
  }

  /**
   * Export to XML
   */
  async exportToXML(projectPath, mainFile, outputPath, options) {
    try {
      const mainFilePath = path.join(projectPath, mainFile);
      const xmlPath = path.join(outputPath, 'output.xml');
      
      // Use pandoc to convert LaTeX to XML
      await execAsync(`pandoc "${mainFilePath}" -o "${xmlPath}" --standalone`);

      // Check if XML was created
      await fs.access(xmlPath);

      return {
        success: true,
        outputPath: xmlPath,
        metadata: {
          format: 'xml',
          method: 'pandoc'
        }
      };
    } catch (error) {
      return {
        success: false,
        error: `XML export failed: ${error.message}`
      };
    }
  }

  /**
   * Convert LaTeX to plain text (basic implementation)
   */
  convertLaTeXToText(content) {
    let text = content;
    
    // Remove LaTeX commands
    text = text.replace(/\\[a-zA-Z]+\{[^}]*\}/g, '');
    text = text.replace(/\\[a-zA-Z]+/g, '');
    
    // Remove environments
    text = text.replace(/\\begin\{[^}]*\}[\s\S]*?\\end\{[^}]*\}/g, '');
    
    // Remove comments
    text = text.replace(/%.*$/gm, '');
    
    // Clean up whitespace
    text = text.replace(/\s+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');
    
    return text.trim();
  }

  /**
   * Get PDF page count
   */
  async getPDFPageCount(pdfPath) {
    try {
      // Try to use pdfinfo if available
      const { stdout } = await execAsync(`pdfinfo "${pdfPath}"`);
      const match = stdout.match(/Pages:\s*(\d+)/);
      return match ? parseInt(match[1]) : 0;
    } catch (error) {
      // Fallback: estimate based on file size
      const stats = await fs.stat(pdfPath);
      return Math.max(1, Math.floor(stats.size / 50000)); // Rough estimate
    }
  }

  /**
   * Batch export to multiple formats
   */
  async batchExport(projectId, formats, options = {}) {
    try {
      const results = [];
      const errors = [];

      for (const format of formats) {
        try {
          const result = await this.exportDocument(projectId, format, options);
          if (result.success) {
            results.push(result);
          } else {
            errors.push({ format, error: result.error });
          }
        } catch (error) {
          errors.push({ format, error: error.message });
        }
      }

      return {
        success: errors.length === 0,
        results,
        errors,
        totalFormats: formats.length,
        successfulExports: results.length,
        failedExports: errors.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get export history
   */
  async getExportHistory(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const historyPath = path.join(projectPath, 'export_history.json');
      
      try {
        const historyContent = await fs.readFile(historyPath, 'utf-8');
        const history = JSON.parse(historyContent);
        
        return {
          success: true,
          history: history.exports || [],
          totalExports: (history.exports || []).length
        };
      } catch (error) {
        // No history file exists
        return {
          success: true,
          history: [],
          totalExports: 0
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save export to history
   */
  async saveExportToHistory(projectId, exportResult) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const historyPath = path.join(projectPath, 'export_history.json');
      
      let history = { exports: [] };
      
      try {
        const historyContent = await fs.readFile(historyPath, 'utf-8');
        history = JSON.parse(historyContent);
      } catch (error) {
        // File doesn't exist, use default
      }
      
      const exportRecord = {
        id: `export_${Date.now()}`,
        timestamp: new Date().toISOString(),
        format: exportResult.format,
        outputPath: exportResult.outputPath,
        metadata: exportResult.metadata,
        downloadUrl: exportResult.downloadUrl
      };
      
      history.exports.push(exportRecord);
      
      // Keep only last 50 exports
      if (history.exports.length > 50) {
        history.exports = history.exports.slice(-50);
      }
      
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      
      return {
        success: true,
        exportRecord
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up old exports
   */
  async cleanupOldExports(projectId, maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const historyPath = path.join(projectPath, 'export_history.json');
      
      let history = { exports: [] };
      
      try {
        const historyContent = await fs.readFile(historyPath, 'utf-8');
        history = JSON.parse(historyContent);
      } catch (error) {
        return { success: true, message: 'No history to clean up' };
      }
      
      const now = Date.now();
      const initialCount = history.exports.length;
      
      // Filter out old exports
      history.exports = history.exports.filter(exportRecord => {
        const exportTime = new Date(exportRecord.timestamp).getTime();
        return (now - exportTime) < maxAge;
      });
      
      const removedCount = initialCount - history.exports.length;
      
      await fs.writeFile(historyPath, JSON.stringify(history, null, 2));
      
      return {
        success: true,
        removedCount,
        remainingCount: history.exports.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get supported formats
   */
  getSupportedFormats() {
    return {
      success: true,
      formats: this.supportedFormats.map(format => ({
        format,
        description: this.getFormatDescription(format),
        requirements: this.getFormatRequirements(format)
      }))
    };
  }

  /**
   * Get format description
   */
  getFormatDescription(format) {
    const descriptions = {
      'pdf': 'Portable Document Format - Best for printing and sharing',
      'html': 'HyperText Markup Language - For web viewing',
      'docx': 'Microsoft Word Document - For editing in Word',
      'odt': 'OpenDocument Text - For LibreOffice/OpenOffice',
      'epub': 'Electronic Publication - For e-readers',
      'rtf': 'Rich Text Format - Universal document format',
      'txt': 'Plain Text - Simple text format',
      'xml': 'Extensible Markup Language - Structured data format'
    };
    
    return descriptions[format] || 'Unknown format';
  }

  /**
   * Get format requirements
   */
  getFormatRequirements(format) {
    const requirements = {
      'pdf': ['LaTeX compiler (pdflatex, xelatex, or lualatex)'],
      'html': ['pandoc or htlatex or latex2html'],
      'docx': ['pandoc'],
      'odt': ['pandoc'],
      'epub': ['pandoc'],
      'rtf': ['pandoc'],
      'txt': ['No additional requirements'],
      'xml': ['pandoc']
    };
    
    return requirements[format] || [];
  }

  /**
   * Check if format is available
   */
  async checkFormatAvailability(format) {
    try {
      const requirements = this.getFormatRequirements(format);
      const available = [];
      const unavailable = [];
      
      for (const requirement of requirements) {
        try {
          if (requirement.includes('pandoc')) {
            await execAsync('pandoc --version');
            available.push(requirement);
          } else if (requirement.includes('LaTeX compiler')) {
            await execAsync('pdflatex --version');
            available.push(requirement);
          } else if (requirement.includes('htlatex')) {
            await execAsync('htlatex --version');
            available.push(requirement);
          } else if (requirement.includes('latex2html')) {
            await execAsync('latex2html --version');
            available.push(requirement);
          } else {
            available.push(requirement);
          }
        } catch (error) {
          unavailable.push(requirement);
        }
      }
      
      return {
        success: true,
        format,
        available,
        unavailable,
        isAvailable: unavailable.length === 0
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
