/**
 * Context Updater
 * Reads files from disk and updates context after modifications
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class ContextUpdater {
  constructor() {
    // Cache for recently read files to avoid redundant reads
    this.fileCache = new Map();
    this.cacheTimeout = 5000; // 5 seconds cache
  }

  /**
   * Update context with fresh file content from disk
   * @param {string} filePath - File path (relative to project)
   * @param {string} projectId - Project ID
   * @param {Object} context - Current context object
   * @returns {Promise<Object>} Updated context and file content
   */
  async updateContextAfterModification(filePath, projectId, context = {}) {
    if (!filePath) {
      console.warn('⚠️ No file path provided to updateContextAfterModification');
      return {
        success: false,
        updatedContent: null,
        updatedContext: context,
        error: 'No file path provided'
      };
    }

    const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    
    try {
      // Read file from disk
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const projectPathAbs = path.resolve(projectPath);
      const target = path.resolve(projectPathAbs, normalizedPath);
      
      // Security check
      if (!target.startsWith(projectPathAbs + path.sep) && target !== projectPathAbs) {
        console.error('❌ Invalid file path for context update:', normalizedPath);
        return {
          success: false,
          updatedContent: null,
          updatedContext: context,
          error: 'Invalid file path - security check failed'
        };
      }

      let fileContent;
      try {
        fileContent = await fs.readFile(target, 'utf-8');
        
        // Update cache
        this.fileCache.set(`${projectId}:${normalizedPath}`, {
          content: fileContent,
          timestamp: Date.now()
        });
        
        console.log(`✅ Updated context from disk: ${normalizedPath} (${fileContent.length} chars)`);
      } catch (error) {
        console.error(`❌ Failed to read file for context update: ${error.message}`);
        
        // Try to use cached content if available
        const cacheKey = `${projectId}:${normalizedPath}`;
        const cached = this.fileCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
          console.log(`⚠️ Using cached content for context update`);
          fileContent = cached.content;
        } else {
          // Fallback to existing context
          fileContent = context.currentDocument || '';
          console.warn(`⚠️ Using existing context content as fallback`);
        }
      }

      // Update context object
      const updatedContext = {
        ...context,
        currentDocument: fileContent,
        activeFile: normalizedPath,
        lastUpdated: new Date().toISOString()
      };

      return {
        success: true,
        updatedContent: fileContent,
        updatedContext,
        filePath: normalizedPath
      };

    } catch (error) {
      console.error('Error updating context:', error);
      
      // Return context unchanged on error
      return {
        success: false,
        updatedContent: context.currentDocument || null,
        updatedContext: context,
        error: error.message || 'Unknown error updating context'
      };
    }
  }

  /**
   * Read file content from disk (with caching)
   * @param {string} filePath - File path (relative to project)
   * @param {string} projectId - Project ID
   * @param {boolean} forceRefresh - Force refresh even if cached
   * @returns {Promise<string|null>} File content or null on error
   */
  async readFileContent(filePath, projectId, forceRefresh = false) {
    if (!filePath) {
      return null;
    }

    const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    const cacheKey = `${projectId}:${normalizedPath}`;

    // Check cache first
    if (!forceRefresh) {
      const cached = this.fileCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        return cached.content;
      }
    }

    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const projectPathAbs = path.resolve(projectPath);
      const target = path.resolve(projectPathAbs, normalizedPath);
      
      // Security check
      if (!target.startsWith(projectPathAbs + path.sep) && target !== projectPathAbs) {
        console.error('❌ Invalid file path for reading:', normalizedPath);
        return null;
      }

      const content = await fs.readFile(target, 'utf-8');
      
      // Update cache
      this.fileCache.set(cacheKey, {
        content,
        timestamp: Date.now()
      });

      return content;

    } catch (error) {
      console.error(`Error reading file ${normalizedPath}:`, error.message);
      
      // Try cache as fallback
      const cached = this.fileCache.get(cacheKey);
      if (cached) {
        console.log(`⚠️ Using cached content for ${normalizedPath}`);
        return cached.content;
      }
      
      return null;
    }
  }

  /**
   * Clear file cache
   * @param {string} filePath - Optional file path to clear, or clear all if not provided
   * @param {string} projectId - Project ID
   */
  clearCache(filePath = null, projectId = null) {
    if (filePath && projectId) {
      const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
      const cacheKey = `${projectId}:${normalizedPath}`;
      this.fileCache.delete(cacheKey);
      console.log(`🗑️ Cleared cache for ${normalizedPath}`);
    } else {
      this.fileCache.clear();
      console.log('🗑️ Cleared all file cache');
    }
  }

  /**
   * Update multiple files in context
   * @param {Array<string>} filePaths - Array of file paths
   * @param {string} projectId - Project ID
   * @param {Object} context - Current context
   * @returns {Promise<Object>} Updated context with all file contents
   */
  async updateContextForMultipleFiles(filePaths, projectId, context = {}) {
    const updatedFiles = {};
    const updatedContext = { ...context };

    for (const filePath of filePaths) {
      const result = await this.updateContextAfterModification(filePath, projectId, updatedContext);
      if (result.success) {
        updatedFiles[filePath] = result.updatedContent;
        
        // Update context with the latest file (typically the active one)
        if (filePath === context.activeFile || !updatedContext.currentDocument) {
          updatedContext.currentDocument = result.updatedContent;
        }
      }
    }

    return {
      success: true,
      updatedFiles,
      updatedContext
    };
  }
}

