// SPDX-License-Identifier: MIT

/**
 * SyncTeX Parser for mapping LaTeX source to PDF coordinates
 *
 * SyncTeX format reference:
 * - Lines starting with '(' define input files
 * - Lines starting with '{' or '[' define vertical/horizontal boxes
 * - Lines starting with 'v', 'h', 'k', 'g', 'x' define different box types
 * - Format: <type>:<line>:<column>,<x>,<y>:<width>,<height>,<depth>
 */

export class SyncTeXParser {
  constructor(synctexData) {
    this.data = synctexData;
    this.inputFiles = new Map();
    this.boxes = [];
    this.pages = [];
    this.currentFile = null;
    this.currentPage = null;
    this.unit = 1; // Default unit in scaled points
  }

  /**
   * Parse SyncTeX data and build mapping structure
   */
  parse() {
    const lines = this.data.split('\n');
    let fileIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse input file
      if (line.startsWith('Input:')) {
        const match = line.match(/Input:(\d+):(.+)/);
        if (match) {
          const index = parseInt(match[1]);
          const filename = match[2];
          this.inputFiles.set(index, filename);
        }
      }
      // Parse unit (conversion factor)
      else if (line.startsWith('Unit:')) {
        const match = line.match(/Unit:(\d+)/);
        if (match) {
          this.unit = parseInt(match[1]);
        }
      }
      // Parse page
      else if (line.startsWith('{') && !line.startsWith('({')) {
        const match = line.match(/\{(\d+)/);
        if (match) {
          const pageNum = parseInt(match[1]);
          this.currentPage = {
            page: pageNum,
            boxes: []
          };
          this.pages.push(this.currentPage);
          console.log(`📄 Parsed page ${pageNum}`);
        }
      }
      // Parse content box (horizontal box with text, vertical box, or any box type)
      else if (/^[hkvxg]/.test(line)) {
        const box = this.parseBox(line);
        if (box && this.currentPage) {
          this.currentPage.boxes.push(box);
        }
      }
    }

    return this;
  }

  /**
   * Parse a box line from SyncTeX
   * Format: h<tag>,<line>:<column>,<x>,<y>:<width>,<height>,<depth>
   */
  parseBox(line) {
    try {
      // Extract type (first character)
      const type = line[0];

      // Try to match the box format
      // Format: htag,line:column,x,y:width,height,depth
      // Example: h1,36:4736287,729744:29685704,0,0
      // Matches: h, tag=1, line=36, column=4736287, x=729744, y=29685704, width=0, height=0, depth=?
      const match = line.match(/^[hvkgx](\d+),(\d+):(\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/);

      if (!match) return null;

      // Match: [tag, line, column, x, y, width, height, depth]
      const [, tag, lineNum, column, x, y, width, height] = match;

      return {
        type,
        tag: tag || '0',
        line: parseInt(lineNum),
        column: parseInt(column),
        x: parseInt(x) / this.unit,
        y: parseInt(y) / this.unit,
        width: width ? parseInt(width) / this.unit : 0,
        height: height ? parseInt(height) / this.unit : 0,
        depth: 0
      };
    } catch (e) {
      console.warn('Failed to parse box:', line, e);
      return null;
    }
  }

  /**
   * Get all boxes for a specific page
   */
  getPageBoxes(pageNum) {
    const page = this.pages.find(p => p.page === pageNum);
    return page ? page.boxes : [];
  }

  /**
   * Get boxes for a specific source line
   */
  getBoxesForLine(lineNum, pageNum = 1) {
    const pageBoxes = this.getPageBoxes(pageNum);
    return pageBoxes.filter(box => box.line === lineNum);
  }

  /**
   * Get all boxes grouped by line number
   */
  getBoxesByLine(pageNum = 1) {
    const pageBoxes = this.getPageBoxes(pageNum);
    const lineMap = new Map();

    pageBoxes.forEach(box => {
      if (!lineMap.has(box.line)) {
        lineMap.set(box.line, []);
      }
      lineMap.get(box.line).push(box);
    });

    return lineMap;
  }

  /**
   * Convert SyncTeX coordinates to PDF points
   * SyncTeX uses scaled points (sp): 1 pt = 65536 sp
   */
  spToPoints(sp) {
    return sp / 65536.0;
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    return {
      inputFiles: Array.from(this.inputFiles.entries()),
      pageCount: this.pages.length,
      totalBoxes: this.pages.reduce((sum, page) => sum + page.boxes.length, 0),
      unit: this.unit
    };
  }
}

/**
 * Utility function to parse SyncTeX data
 */
export function parseSyncTeX(synctexData) {
  const parser = new SyncTeXParser(synctexData);
  return parser.parse();
}
