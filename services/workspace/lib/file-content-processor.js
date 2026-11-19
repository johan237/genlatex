import fs from 'fs/promises';
import path from 'path';

/**
 * File Content Processor
 * Extracts and processes content from various file types for LLM analysis
 */
class FileContentProcessor {
  constructor() {
    this.supportedExtensions = {
      // Code files
      '.js': 'javascript',
      '.ts': 'typescript', 
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.r': 'r',
      '.m': 'matlab',
      '.jl': 'julia',
      
      // Data files
      '.json': 'json',
      '.xml': 'xml',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.csv': 'csv',
      '.tsv': 'tsv',
      '.sql': 'sql',
      
      // Documentation
      '.md': 'markdown',
      '.txt': 'text',
      '.rst': 'restructuredtext',
      '.tex': 'latex',
      '.bib': 'bibtex',
      
      // Configuration
      '.conf': 'config',
      '.cfg': 'config',
      '.ini': 'config',
      '.toml': 'toml',
      '.env': 'env',
      
      // Other
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.less': 'less'
    };
  }

  /**
   * Process all files in a directory and extract content
   * @param {string} directoryPath - Path to the directory
   * @param {number} maxFileSize - Maximum file size in bytes (default: 1MB)
   * @param {number} maxFiles - Maximum number of files to process (default: 50)
   * @returns {Promise<Object>} Processed content summary
   */
  async processDirectory(directoryPath, maxFileSize = 1024 * 1024, maxFiles = 50) {
    try {
      console.log('📁 Processing directory:', directoryPath);
      
      const files = await this.getAllFiles(directoryPath);
      const processedFiles = [];
      const contentSummary = {
        totalFiles: files.length,
        processedFiles: 0,
        skippedFiles: 0,
        fileTypes: {},
        keyFiles: [],
        content: '',
        references: [],
        errors: []
      };

      let processedCount = 0;
      
      for (const filePath of files) {
        if (processedCount >= maxFiles) {
          console.log(`⚠️ Reached maximum file limit: ${maxFiles}`);
          break;
        }

        try {
          const fileInfo = await this.processFile(filePath, maxFileSize);
          if (fileInfo) {
            processedFiles.push(fileInfo);
            processedCount++;
            
            // Update content summary
            contentSummary.processedFiles++;
            contentSummary.fileTypes[fileInfo.extension] = (contentSummary.fileTypes[fileInfo.extension] || 0) + 1;
            
            // Add key files (README, main files, etc.)
            if (this.isKeyFile(fileInfo.name)) {
              contentSummary.keyFiles.push(fileInfo);
            }
            
            // Accumulate content
            if (fileInfo.content) {
              contentSummary.content += `\n\n=== ${fileInfo.name} ===\n${fileInfo.content}`;
            }
            
            // Extract references from content
            const references = this.extractReferences(fileInfo.content, fileInfo.name);
            contentSummary.references.push(...references);
          } else {
            contentSummary.skippedFiles++;
          }
        } catch (error) {
          console.error(`❌ Error processing file ${filePath}:`, error.message);
          contentSummary.errors.push({
            file: filePath,
            error: error.message
          });
          contentSummary.skippedFiles++;
        }
      }

      // Generate summary
      contentSummary.summary = this.generateSummary(contentSummary);
      
      console.log(`✅ Processed ${processedCount} files, skipped ${contentSummary.skippedFiles} files`);
      return contentSummary;
      
    } catch (error) {
      console.error('❌ Error processing directory:', error);
      throw error;
    }
  }

  /**
   * Get all files in a directory recursively
   * @param {string} dirPath - Directory path
   * @returns {Promise<string[]>} Array of file paths
   */
  async getAllFiles(dirPath) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        // Skip hidden files and common ignore patterns
        if (entry.name.startsWith('.') || 
            entry.name === 'node_modules' || 
            entry.name === '__pycache__' ||
            entry.name === '.git' ||
            entry.name === 'venv' ||
            entry.name === 'env' ||
            entry.name === 'dist' ||
            entry.name === 'build') {
          continue;
        }
        
        if (entry.isDirectory()) {
          const subFiles = await this.getAllFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`❌ Error reading directory ${dirPath}:`, error.message);
    }
    
    return files;
  }

  /**
   * Process a single file and extract content
   * @param {string} filePath - Path to the file
   * @param {number} maxFileSize - Maximum file size in bytes
   * @returns {Promise<Object|null>} File information or null if skipped
   */
  async processFile(filePath, maxFileSize) {
    try {
      const stats = await fs.stat(filePath);
      
      // Skip if file is too large
      if (stats.size > maxFileSize) {
        console.log(`⚠️ Skipping large file: ${filePath} (${stats.size} bytes)`);
        return null;
      }
      
      const fileName = path.basename(filePath);
      const extension = path.extname(fileName).toLowerCase();
      
      // Skip unsupported files
      if (!this.supportedExtensions[extension]) {
        return null;
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      
      return {
        name: fileName,
        path: filePath,
        extension: extension,
        size: stats.size,
        language: this.supportedExtensions[extension],
        content: content,
        lines: content.split('\n').length,
        lastModified: stats.mtime
      };
      
    } catch (error) {
      console.error(`❌ Error reading file ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Check if a file is considered "key" (important for understanding the project)
   * @param {string} fileName - Name of the file
   * @returns {boolean} True if key file
   */
  isKeyFile(fileName) {
    const keyPatterns = [
      /^readme/i,
      /^main\./i,
      /^index\./i,
      /^app\./i,
      /^server\./i,
      /^package\.json$/i,
      /^requirements\.txt$/i,
      /^pom\.xml$/i,
      /^build\.gradle$/i,
      /^cargo\.toml$/i,
      /^go\.mod$/i,
      /^composer\.json$/i,
      /^gemfile$/i,
      /^setup\.py$/i,
      /^makefile$/i,
      /^dockerfile$/i,
      /^\.env$/i,
      /^config\./i,
      /^settings\./i
    ];
    
    return keyPatterns.some(pattern => pattern.test(fileName));
  }

  /**
   * Extract references from file content
   * @param {string} content - File content
   * @param {string} fileName - File name
   * @returns {Array} Array of reference objects
   */
  extractReferences(content, fileName) {
    const references = [];
    
    if (!content) return references;
    
    // Extract URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    const urls = content.match(urlRegex) || [];
    
    urls.forEach(url => {
      references.push({
        type: 'url',
        value: url,
        source: fileName,
        context: this.getContextAround(content, url)
      });
    });
    
    // Extract citations (various formats)
    const citationPatterns = [
      /\[([^\]]+)\]\(([^)]+)\)/g, // Markdown links
      /@(\w+)/g, // @citations
      /cite\{([^}]+)\}/g, // LaTeX citations
      /\\cite\{([^}]+)\}/g // LaTeX citations with backslash
    ];
    
    citationPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        references.push({
          type: 'citation',
          value: match[1] || match[0],
          source: fileName,
          context: this.getContextAround(content, match[0])
        });
      }
    });
    
    // Extract academic references
    const academicPatterns = [
      /(?:et al\.|et al)/g,
      /(?:doi:|DOI:)\s*([^\s]+)/g,
      /(?:arxiv:|arXiv:)\s*([^\s]+)/g,
      /(?:pubmed:|PMID:)\s*([^\s]+)/g
    ];
    
    academicPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        references.push({
          type: 'academic',
          value: match[1] || match[0],
          source: fileName,
          context: this.getContextAround(content, match[0])
        });
      }
    });
    
    return references;
  }

  /**
   * Get context around a match in content
   * @param {string} content - Full content
   * @param {string} match - The matched text
   * @param {number} contextLength - Length of context (default: 100)
   * @returns {string} Context around the match
   */
  getContextAround(content, match, contextLength = 100) {
    if (!content || !match) return '';
    
    const index = content.indexOf(match);
    if (index === -1) return '';
    
    const start = Math.max(0, index - contextLength);
    const end = Math.min(content.length, index + match.length + contextLength);
    
    return content.substring(start, end).trim();
  }

  /**
   * Generate a summary of the processed content
   * @param {Object} contentSummary - Content summary object
   * @returns {string} Generated summary
   */
  generateSummary(contentSummary) {
    const { processedFiles, fileTypes, keyFiles, references } = contentSummary;
    
    let summary = `Project Analysis Summary:\n`;
    summary += `- Total files processed: ${processedFiles}\n`;
    summary += `- File types found: ${Object.keys(fileTypes).join(', ')}\n`;
    
    if (keyFiles.length > 0) {
      summary += `- Key files identified: ${keyFiles.map(f => f.name).join(', ')}\n`;
    }
    
    if (references.length > 0) {
      const urlRefs = references.filter(r => r.type === 'url').length;
      const citationRefs = references.filter(r => r.type === 'citation').length;
      const academicRefs = references.filter(r => r.type === 'academic').length;
      
      summary += `- References found: ${references.length} total\n`;
      summary += `  - URLs: ${urlRefs}\n`;
      summary += `  - Citations: ${citationRefs}\n`;
      summary += `  - Academic: ${academicRefs}\n`;
    }
    
    return summary;
  }
}

export default FileContentProcessor;
