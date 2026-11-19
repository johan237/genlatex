/**
 * AI-Powered Figure Generation
 * Generates figures and visualizations from code analysis and data
 */

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { getProjectPath } from './files.js';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class FigureGenerator {
  constructor() {
    this.generatedFigures = new Map();
    this.templates = new Map();
    this.loadTemplates();
  }

  /**
   * Load figure generation templates
   */
  loadTemplates() {
    // Plot templates
    this.templates.set('line_plot', {
      name: 'Line Plot',
      description: 'Generate line plots from data',
      type: 'plot',
      template: this.generateLinePlotTemplate.bind(this)
    });

    this.templates.set('bar_chart', {
      name: 'Bar Chart',
      description: 'Generate bar charts from data',
      type: 'chart',
      template: this.generateBarChartTemplate.bind(this)
    });

    this.templates.set('scatter_plot', {
      name: 'Scatter Plot',
      description: 'Generate scatter plots from data',
      type: 'plot',
      template: this.generateScatterPlotTemplate.bind(this)
    });

    this.templates.set('histogram', {
      name: 'Histogram',
      description: 'Generate histograms from data',
      type: 'chart',
      template: this.generateHistogramTemplate.bind(this)
    });

    // Diagram templates
    this.templates.set('flowchart', {
      name: 'Flowchart',
      description: 'Generate flowcharts from code structure',
      type: 'diagram',
      template: this.generateFlowchartTemplate.bind(this)
    });

    this.templates.set('architecture_diagram', {
      name: 'Architecture Diagram',
      description: 'Generate system architecture diagrams',
      type: 'diagram',
      template: this.generateArchitectureDiagramTemplate.bind(this)
    });

    this.templates.set('sequence_diagram', {
      name: 'Sequence Diagram',
      description: 'Generate sequence diagrams from code flow',
      type: 'diagram',
      template: this.generateSequenceDiagramTemplate.bind(this)
    });

    // Code visualization templates
    this.templates.set('code_structure', {
      name: 'Code Structure',
      description: 'Visualize code structure and relationships',
      type: 'visualization',
      template: this.generateCodeStructureTemplate.bind(this)
    });

    this.templates.set('dependency_graph', {
      name: 'Dependency Graph',
      description: 'Generate dependency graphs',
      type: 'graph',
      template: this.generateDependencyGraphTemplate.bind(this)
    });
  }

  /**
   * Generate figure from code analysis
   */
  async generateFigure(projectId, figureType, data, options = {}) {
    try {
      const template = this.templates.get(figureType);
      if (!template) {
        return {
          success: false,
          error: `Unknown figure type: ${figureType}`
        };
      }

      // Generate figure based on template
      const figureContent = await template.template(data, options);
      
      // Save figure
      const figureId = `fig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const figuresPath = path.join(projectPath, 'figures');
      
      await fs.mkdir(figuresPath, { recursive: true });
      
      const figurePath = path.join(figuresPath, `${figureId}.tex`);
      await fs.writeFile(figurePath, figureContent, 'utf-8');
      
      // Generate image if possible
      const imagePath = await this.generateImage(figurePath, figureId, options);
      
      const figure = {
        id: figureId,
        type: figureType,
        name: template.name,
        description: template.description,
        texPath: figurePath,
        imagePath: imagePath,
        data: data,
        options: options,
        generatedAt: new Date().toISOString()
      };
      
      // Store figure info
      this.generatedFigures.set(figureId, figure);
      
      return {
        success: true,
        figure,
        latexCode: figureContent
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate line plot template
   */
  async generateLinePlotTemplate(data, options = {}) {
    const title = options.title || 'Line Plot';
    const xLabel = options.xLabel || 'X';
    const yLabel = options.yLabel || 'Y';
    const width = options.width || '0.8\\textwidth';
    
    let dataPoints = '';
    if (data.points && Array.isArray(data.points)) {
      dataPoints = data.points.map(point => `(${point.x}, ${point.y})`).join(' ');
    } else if (data.x && data.y && Array.isArray(data.x) && Array.isArray(data.y)) {
      dataPoints = data.x.map((x, i) => `(${x}, ${data.y[i]})`).join(' ');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}
\\begin{axis}[
    title={${title}},
    xlabel={${xLabel}},
    ylabel={${yLabel}},
    width=${width},
    grid=major,
    legend pos=north west
]
\\addplot[color=blue, mark=*] coordinates {
    ${dataPoints}
};
\\legend{${options.legend || 'Data'}}
\\end{axis}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'line_plot'}}
\\end{figure}`;
  }

  /**
   * Generate bar chart template
   */
  async generateBarChartTemplate(data, options = {}) {
    const title = options.title || 'Bar Chart';
    const xLabel = options.xLabel || 'Categories';
    const yLabel = options.yLabel || 'Values';
    const width = options.width || '0.8\\textwidth';
    
    let bars = '';
    if (data.categories && data.values) {
      bars = data.categories.map((cat, i) => 
        `\\addplot[fill=blue!30] coordinates {(0,${data.values[i]}) (1,${data.values[i]}) (2,${data.values[i]}) (3,${data.values[i]})};`
      ).join('\n');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}
\\begin{axis}[
    title={${title}},
    xlabel={${xLabel}},
    ylabel={${yLabel}},
    width=${width},
    ybar,
    bar width=0.5,
    symbolic x coords={${data.categories ? data.categories.join(',') : 'A,B,C,D'}},
    xtick=data
]
${bars}
\\end{axis}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'bar_chart'}}
\\end{figure}`;
  }

  /**
   * Generate scatter plot template
   */
  async generateScatterPlotTemplate(data, options = {}) {
    const title = options.title || 'Scatter Plot';
    const xLabel = options.xLabel || 'X';
    const yLabel = options.yLabel || 'Y';
    const width = options.width || '0.8\\textwidth';
    
    let dataPoints = '';
    if (data.points && Array.isArray(data.points)) {
      dataPoints = data.points.map(point => `(${point.x}, ${point.y})`).join(' ');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}
\\begin{axis}[
    title={${title}},
    xlabel={${xLabel}},
    ylabel={${yLabel}},
    width=${width},
    scatter/classes={a={mark=*,blue}, b={mark=*,red}},
    scatter,
    only marks,
    scatter src=explicit symbolic
]
\\addplot[scatter, only marks, mark=*, blue] coordinates {
    ${dataPoints}
};
\\end{axis}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'scatter_plot'}}
\\end{figure}`;
  }

  /**
   * Generate histogram template
   */
  async generateHistogramTemplate(data, options = {}) {
    const title = options.title || 'Histogram';
    const xLabel = options.xLabel || 'Values';
    const yLabel = options.yLabel || 'Frequency';
    const width = options.width || '0.8\\textwidth';
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}
\\begin{axis}[
    title={${title}},
    xlabel={${xLabel}},
    ylabel={${yLabel}},
    width=${width},
    ybar,
    bar width=0.5
]
\\addplot[fill=blue!30] coordinates {
    ${data.bins ? data.bins.map((bin, i) => `(${bin}, ${data.frequencies[i] || 0})`).join(' ') : '(0,0) (1,0) (2,0) (3,0)'}
};
\\end{axis}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'histogram'}}
\\end{figure}`;
  }

  /**
   * Generate flowchart template
   */
  async generateFlowchartTemplate(data, options = {}) {
    const title = options.title || 'Flowchart';
    const width = options.width || '0.8\\textwidth';
    
    let nodes = '';
    let edges = '';
    
    if (data.nodes && Array.isArray(data.nodes)) {
      nodes = data.nodes.map((node, i) => 
        `\\node[${node.type || 'rectangle'}, draw] (${node.id || `node${i}`}) at (${node.x || i}, ${node.y || 0}) {${node.label || node.text || 'Node'}};`
      ).join('\n');
    }
    
    if (data.edges && Array.isArray(data.edges)) {
      edges = data.edges.map(edge => 
        `\\draw[->] (${edge.from}) -- (${edge.to});`
      ).join('\n');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}[node distance=2cm, auto]
${nodes}
${edges}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'flowchart'}}
\\end{figure}`;
  }

  /**
   * Generate architecture diagram template
   */
  async generateArchitectureDiagramTemplate(data, options = {}) {
    const title = options.title || 'System Architecture';
    const width = options.width || '0.8\\textwidth';
    
    let components = '';
    if (data.components && Array.isArray(data.components)) {
      components = data.components.map((comp, i) => 
        `\\node[rectangle, draw, minimum width=2cm, minimum height=1cm] (${comp.id || `comp${i}`}) at (${comp.x || i*2}, ${comp.y || 0}) {${comp.name || 'Component'}};`
      ).join('\n');
    }
    
    let connections = '';
    if (data.connections && Array.isArray(data.connections)) {
      connections = data.connections.map(conn => 
        `\\draw[->] (${conn.from}) -- (${conn.to}) node[midway, above] {${conn.label || ''}};`
      ).join('\n');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}[node distance=2cm, auto]
${components}
${connections}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'architecture'}}
\\end{figure}`;
  }

  /**
   * Generate sequence diagram template
   */
  async generateSequenceDiagramTemplate(data, options = {}) {
    const title = options.title || 'Sequence Diagram';
    
    let participants = '';
    let messages = '';
    
    if (data.participants && Array.isArray(data.participants)) {
      participants = data.participants.map(part => 
        `\\participant{${part.name}}`
      ).join('\n');
    }
    
    if (data.messages && Array.isArray(data.messages)) {
      messages = data.messages.map(msg => 
        `\\${msg.type || 'call'}{${msg.from}}{${msg.to}}{${msg.message}}`
      ).join('\n');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{sequencediagram}
${participants}
${messages}
\\end{sequencediagram}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'sequence'}}
\\end{figure}`;
  }

  /**
   * Generate code structure template
   */
  async generateCodeStructureTemplate(data, options = {}) {
    const title = options.title || 'Code Structure';
    
    let structure = '';
    if (data.structure) {
      structure = this.generateStructureTree(data.structure);
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}[
    level 1/.style={sibling distance=3cm},
    level 2/.style={sibling distance=1.5cm}
]
\\node {${data.root || 'Root'}}
${structure}
;
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'code_structure'}}
\\end{figure}`;
  }

  /**
   * Generate dependency graph template
   */
  async generateDependencyGraphTemplate(data, options = {}) {
    const title = options.title || 'Dependency Graph';
    
    let nodes = '';
    let edges = '';
    
    if (data.dependencies) {
      const deps = Object.entries(data.dependencies);
      nodes = deps.map(([name, deps]) => 
        `\\node[circle, draw] (${name}) {${name}};`
      ).join('\n');
      
      edges = deps.flatMap(([name, deps]) => 
        deps.map(dep => `\\draw[->] (${dep}) -- (${name});`)
      ).join('\n');
    }
    
    return `\\begin{figure}[h]
\\centering
\\begin{tikzpicture}[node distance=2cm, auto]
${nodes}
${edges}
\\end{tikzpicture}
\\caption{${options.caption || title}}
\\label{fig:${options.label || 'dependencies'}}
\\end{figure}`;
  }

  /**
   * Generate structure tree
   */
  generateStructureTree(structure, level = 0) {
    let tree = '';
    const indent = '  '.repeat(level);
    
    for (const [key, value] of Object.entries(structure)) {
      if (typeof value === 'object' && value !== null) {
        tree += `\n${indent}child { node {${key}}`;
        tree += this.generateStructureTree(value, level + 1);
        tree += `\n${indent}}`;
      } else {
        tree += `\n${indent}child { node {${key}} }`;
      }
    }
    
    return tree;
  }

  /**
   * Generate image from LaTeX figure
   */
  async generateImage(texPath, figureId, options = {}) {
    try {
      const projectPath = path.dirname(path.dirname(texPath));
      const outputPath = path.join(projectPath, 'figures', `${figureId}.png`);
      
      // Try different methods to generate image
      try {
        // Method 1: Use pdftocairo (if available)
        await execAsync(`pdflatex -interaction=nonstopmode "${texPath}"`);
        const pdfPath = texPath.replace('.tex', '.pdf');
        await execAsync(`pdftocairo -png "${pdfPath}" "${outputPath}"`);
        return outputPath;
      } catch (error) {
        try {
          // Method 2: Use convert (ImageMagick)
          const pdfPath = texPath.replace('.tex', '.pdf');
          await execAsync(`convert "${pdfPath}" "${outputPath}"`);
          return outputPath;
        } catch (error) {
          // Method 3: Use dvisvgm
          await execAsync(`latex -interaction=nonstopmode "${texPath}"`);
          const dviPath = texPath.replace('.tex', '.dvi');
          await execAsync(`dvisvgm --no-fonts "${dviPath}" -o "${outputPath}"`);
          return outputPath;
        }
      }
    } catch (error) {
      console.warn('Could not generate image:', error.message);
      return null;
    }
  }

  /**
   * Generate figure from code analysis
   */
  async generateFromCodeAnalysis(projectId, analysis, options = {}) {
    try {
      const figures = [];
      
      // Generate method call graph
      if (analysis.method_extraction && analysis.method_extraction.methods) {
        const methodData = {
          nodes: analysis.method_extraction.methods.map((method, i) => ({
            id: `method_${i}`,
            label: method.name,
            type: 'rectangle',
            x: i % 4,
            y: Math.floor(i / 4)
          })),
          edges: [] // Could be enhanced with call relationships
        };
        
        const methodFigure = await this.generateFigure(
          projectId,
          'flowchart',
          methodData,
          { ...options, title: 'Method Structure', label: 'methods' }
        );
        
        if (methodFigure.success) {
          figures.push(methodFigure.figure);
        }
      }
      
      // Generate class hierarchy
      if (analysis.class_analysis && analysis.class_analysis.classes) {
        const classData = {
          nodes: analysis.class_analysis.classes.map((cls, i) => ({
            id: `class_${i}`,
            label: cls.name,
            type: 'rectangle',
            x: i % 3,
            y: Math.floor(i / 3)
          })),
          edges: []
        };
        
        const classFigure = await this.generateFigure(
          projectId,
          'flowchart',
          classData,
          { ...options, title: 'Class Structure', label: 'classes' }
        );
        
        if (classFigure.success) {
          figures.push(classFigure.figure);
        }
      }
      
      // Generate dependency graph
      if (analysis.dependency_analysis && analysis.dependency_analysis.dependencies) {
        const depData = {
          dependencies: analysis.dependency_analysis.categories
        };
        
        const depFigure = await this.generateFigure(
          projectId,
          'dependency_graph',
          depData,
          { ...options, title: 'Dependencies', label: 'dependencies' }
        );
        
        if (depFigure.success) {
          figures.push(depFigure.figure);
        }
      }
      
      return {
        success: true,
        figures,
        totalGenerated: figures.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate figure from data
   */
  async generateFromData(projectId, data, figureType, options = {}) {
    try {
      const figure = await this.generateFigure(projectId, figureType, data, options);
      
      if (figure.success) {
        return {
          success: true,
          figure: figure.figure,
          latexCode: figure.latexCode
        };
      } else {
        return figure;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available figure templates
   */
  getAvailableTemplates() {
    const templates = Array.from(this.templates.entries()).map(([id, template]) => ({
      id,
      name: template.name,
      description: template.description,
      type: template.type
    }));
    
    return {
      success: true,
      templates,
      totalTemplates: templates.length
    };
  }

  /**
   * Get generated figures for project
   */
  getGeneratedFigures(projectId) {
    const figures = Array.from(this.generatedFigures.values())
      .filter(figure => figure.id.startsWith(`fig_${projectId}_`) || figure.texPath.includes(projectId));
    
    return {
      success: true,
      figures,
      totalFigures: figures.length
    };
  }

  /**
   * Delete generated figure
   */
  async deleteFigure(projectId, figureId) {
    try {
      const figure = this.generatedFigures.get(figureId);
      if (!figure) {
        return {
          success: false,
          error: 'Figure not found'
        };
      }
      
      // Delete files
      if (figure.texPath) {
        await fs.unlink(figure.texPath).catch(() => {});
      }
      
      if (figure.imagePath) {
        await fs.unlink(figure.imagePath).catch(() => {});
      }
      
      // Remove from memory
      this.generatedFigures.delete(figureId);
      
      return {
        success: true,
        message: 'Figure deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Export figure to different formats
   */
  async exportFigure(figureId, format, options = {}) {
    try {
      const figure = this.generatedFigures.get(figureId);
      if (!figure) {
        return {
          success: false,
          error: 'Figure not found'
        };
      }
      
      const exportPath = figure.texPath.replace('.tex', `.${format}`);
      
      switch (format) {
        case 'svg':
          await execAsync(`dvisvgm --no-fonts "${figure.texPath.replace('.tex', '.dvi')}" -o "${exportPath}"`);
          break;
        case 'eps':
          await execAsync(`pdftops -eps "${figure.texPath.replace('.tex', '.pdf')}" "${exportPath}"`);
          break;
        case 'png':
          await execAsync(`pdftocairo -png "${figure.texPath.replace('.tex', '.pdf')}" "${exportPath}"`);
          break;
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
      
      return {
        success: true,
        exportPath,
        format
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate figure gallery
   */
  async generateFigureGallery(projectId, options = {}) {
    try {
      const figures = this.getGeneratedFigures(projectId).figures;
      
      if (figures.length === 0) {
        return {
          success: false,
          error: 'No figures found for project'
        };
      }
      
      const galleryContent = this.generateGalleryLaTeX(figures, options);
      
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const galleryPath = path.join(projectPath, 'figure_gallery.tex');
      
      await fs.writeFile(galleryPath, galleryContent, 'utf-8');
      
      return {
        success: true,
        galleryPath,
        totalFigures: figures.length,
        latexContent: galleryContent
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate gallery LaTeX content
   */
  generateGalleryLaTeX(figures, options = {}) {
    const title = options.title || 'Figure Gallery';
    const columns = options.columns || 2;
    
    let content = `\\documentclass{article}
\\usepackage{graphicx}
\\usepackage{subcaption}
\\usepackage{geometry}
\\geometry{margin=1in}

\\title{${title}}
\\author{Generated by GenLaTeX}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Generated Figures}

\\begin{figure}[h]
\\centering
`;

    figures.forEach((figure, index) => {
      if (index % columns === 0 && index > 0) {
        content += '\\end{figure}\n\n\\begin{figure}[h]\n\\centering\n';
      }
      
      content += `\\begin{subfigure}[b]{${0.9/columns}\\textwidth}
\\centering
\\includegraphics[width=\\textwidth]{${figure.imagePath || figure.texPath}}
\\caption{${figure.name}}
\\label{fig:${figure.id}}
\\end{subfigure}
${index % columns === columns - 1 ? '' : '\\hfill'}
`;
    });
    
    content += `\\end{figure}

\\end{document}`;
    
    return content;
  }
}
