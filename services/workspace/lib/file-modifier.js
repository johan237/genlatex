/**
 * File Modifier
 * Handles direct file modifications using filesystem operations
 */

import { ContextMapper } from './context-mapper.js';
import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class FileModifier {
  constructor() {
    this.contextMapper = new ContextMapper();
    // In-memory snapshot storage for quick rollback
    // Key: projectId:filePath, Value: { content, timestamp }
    this.snapshots = new Map();
    // Limit to last 10 snapshots per file
    this.maxSnapshotsPerFile = 10;
  }

  /**
   * Create a snapshot of file content before modification
   * @param {string} projectId - Project ID
   * @param {string} filePath - File path (relative to project)
   * @param {string} content - Current file content
   * @returns {string} Snapshot ID
   */
  createSnapshot(projectId, filePath, content) {
    const snapshotKey = `${projectId}:${filePath}`;
    const snapshotId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Get existing snapshots for this file
    let fileSnapshots = this.snapshots.get(snapshotKey) || [];
    
    // Add new snapshot
    fileSnapshots.push({
      id: snapshotId,
      content,
      timestamp: new Date().toISOString(),
      filePath,
      projectId
    });
    
    // Keep only the most recent snapshots
    if (fileSnapshots.length > this.maxSnapshotsPerFile) {
      fileSnapshots = fileSnapshots.slice(-this.maxSnapshotsPerFile);
    }
    
    this.snapshots.set(snapshotKey, fileSnapshots);
    
    console.log(`📸 Created snapshot ${snapshotId} for ${filePath} (${fileSnapshots.length} total)`);
    
    return snapshotId;
  }

  /**
   * Restore file from a snapshot
   * @param {string} projectId - Project ID
   * @param {string} filePath - File path (relative to project)
   * @param {string} snapshotId - Snapshot ID (optional - uses latest if not provided)
   * @returns {Promise<Object>} Result { success, content, snapshot }
   */
  async restoreSnapshot(projectId, filePath, snapshotId = null) {
    const snapshotKey = `${projectId}:${filePath}`;
    const fileSnapshots = this.snapshots.get(snapshotKey) || [];
    
    if (fileSnapshots.length === 0) {
      return {
        success: false,
        error: 'No snapshots available for this file'
      };
    }
    
    // Find the snapshot
    let snapshot;
    if (snapshotId) {
      snapshot = fileSnapshots.find(s => s.id === snapshotId);
      if (!snapshot) {
        return {
          success: false,
          error: `Snapshot ${snapshotId} not found`
        };
      }
    } else {
      // Use the latest snapshot
      snapshot = fileSnapshots[fileSnapshots.length - 1];
    }
    
    // Write the snapshot content back to file
    try {
      const projectPath = getProjectPath(undefined, projectId);
      const fullPath = path.join(projectPath, filePath);
      
      await fs.writeFile(fullPath, snapshot.content, 'utf-8');
      
      console.log(`🔄 Restored file ${filePath} from snapshot ${snapshot.id}`);
      
      return {
        success: true,
        content: snapshot.content,
        snapshot: {
          id: snapshot.id,
          timestamp: snapshot.timestamp
        }
      };
    } catch (error) {
      console.error(`Error restoring snapshot:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List available snapshots for a file
   * @param {string} projectId - Project ID
   * @param {string} filePath - File path (relative to project)
   * @returns {Array} Array of snapshot metadata
   */
  listSnapshots(projectId, filePath) {
    const snapshotKey = `${projectId}:${filePath}`;
    const fileSnapshots = this.snapshots.get(snapshotKey) || [];
    
    return fileSnapshots.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      size: s.content.length
    }));
  }

  /**
   * Clear old snapshots for a file
   * @param {string} projectId - Project ID
   * @param {string} filePath - File path (relative to project)
   * @param {number} olderThanMs - Remove snapshots older than this (milliseconds)
   */
  clearOldSnapshots(projectId, filePath, olderThanMs = 3600000) { // Default: 1 hour
    const snapshotKey = `${projectId}:${filePath}`;
    const fileSnapshots = this.snapshots.get(snapshotKey) || [];
    
    const cutoffTime = Date.now() - olderThanMs;
    const filtered = fileSnapshots.filter(s => {
      const snapshotTime = new Date(s.timestamp).getTime();
      return snapshotTime > cutoffTime;
    });
    
    this.snapshots.set(snapshotKey, filtered);
    
    const removed = fileSnapshots.length - filtered.length;
    if (removed > 0) {
      console.log(`🧹 Cleared ${removed} old snapshot(s) for ${filePath}`);
    }
  }

  /**
   * Extract file path from user message
   * @param {string} message - User message
   * @returns {string|null} Extracted file path or null
   */
  extractFilePathFromMessage(message) {
    if (!message) return null;
    
    // Pattern 1: "in main.tex", "in references.bib", etc.
    const inFilePattern = /\b(?:in|from|to|modify|edit|update|fix|change)\s+([a-zA-Z0-9_-]+\.(?:tex|bib|cls|sty))\b/i;
    const inFileMatch = message.match(inFilePattern);
    if (inFileMatch) {
      return inFileMatch[1];
    }
    
    // Pattern 2: Standalone filename with extension
    const standaloneFilePattern = /\b([a-zA-Z0-9_-]+\.(?:tex|bib|cls|sty))\b/;
    const standaloneMatch = message.match(standaloneFilePattern);
    if (standaloneMatch) {
      return standaloneMatch[1];
    }
    
    // Pattern 3: File path with directory
    const pathPattern = /\b([a-zA-Z0-9_\-\/\\]+\.(?:tex|bib|cls|sty))\b/;
    const pathMatch = message.match(pathPattern);
    if (pathMatch) {
      return pathMatch[1];
    }
    
    return null;
  }

  /**
   * Get active file from context or fallback
   * @param {string} projectId - Project ID
   * @param {Object} context - Context with activeFile, currentDocument, etc.
   * @returns {Promise<string|null>} Active file path or null
   */
  async getActiveFile(projectId, context = {}) {
    // Try context.activeFile first
    if (context.activeFile) {
      // Validate that it's a path (not content)
      // Paths are typically short, don't start with LaTeX commands, and contain file extensions
      const looksLikePath = context.activeFile.length < 500 && 
                           !context.activeFile.includes('\\documentclass') &&
                           !context.activeFile.includes('\\begin{document}') &&
                           (context.activeFile.includes('.tex') || context.activeFile.includes('.bib'));
      
      if (looksLikePath) {
        return context.activeFile;
      }
      console.warn(`⚠️ activeFile appears to be content, not a path. Length: ${context.activeFile.length}, starts with: ${context.activeFile.substring(0, 50)}`);
    }
    
    // Check other context properties
    if (context.currentFile && context.currentFile.length < 500 && !context.currentFile.includes('\\documentclass')) {
      return context.currentFile;
    }
    
    // Try currentDocument if it looks like a file path (not content)
    if (context.currentDocument && 
        context.currentDocument.length < 500 &&
        !context.currentDocument.includes('\\documentclass') &&
        !context.currentDocument.includes('\\begin{document}') &&
        (context.currentDocument.includes('.tex') || context.currentDocument.includes('/') || context.currentDocument.includes('\\'))) {
      return context.currentDocument;
    }
    
    // Try to extract file path from user message
    if (context.userMessage) {
      const extractedPath = this.extractFilePathFromMessage(context.userMessage);
      if (extractedPath) {
        console.log(`📄 Extracted file path from message: ${extractedPath}`);
        return extractedPath;
      }
    }
    
    // Memory system removed - return default active file
    return 'main.tex';
  }

  /**
   * Read file content
   * @param {string} filePath - File path (relative to project)
   * @param {string} projectId - Project ID
   * @returns {Promise<string>} File content
   */
  async readFile(filePath, projectId) {
    try {
      // Try to read via API or direct file access
      // For now, we'll rely on the context having the file content
      // In a full implementation, we'd fetch from the file API
      throw new Error('File reading should be done via context.currentDocument or API');
    } catch (error) {
      console.error('Error reading file:', error);
      throw error;
    }
  }

  /**
   * Apply a single modification to a file
   * @param {string} filePath - File path (relative to project)
   * @param {Object} modification - Modification object
   * @param {string} projectId - Project ID
   * @param {string} currentFileContent - Current file content (required)
   * @returns {Promise<Object>} Result { success: boolean, error?: string, snapshotId?: string }
   */
  async applyModification(filePath, modification, projectId, currentFileContent) {
    if (!currentFileContent) {
      throw new Error('currentFileContent is required for file modification');
    }
    
    // Validate filePath - it should be a path, not content
    if (!filePath || filePath.length > 500 || filePath.includes('\\documentclass') || filePath.includes('\\begin{document}')) {
      const errorMsg = `Invalid filePath provided to applyModification. Path appears to be file content instead of a file path. Length: ${filePath?.length}`;
      console.error(`❌ ${errorMsg}`);
      console.error(`   First 200 chars: ${filePath?.substring(0, 200)}`);
      return { success: false, error: errorMsg };
    }
    
    // Create snapshot before modification
    const snapshotId = this.createSnapshot(projectId, filePath, currentFileContent);
    
    // For full file replacement (start=0, end=fileContent.length), use direct write
    if (modification.type === 'replace' && 
        modification.start === 0 && 
        modification.end === currentFileContent.length) {
      console.log(`📝 Full file replacement detected - using direct write`);
      const result = await this.writeFileDirect(filePath, modification.content || '', projectId);
      if (result.success) {
        result.snapshotId = snapshotId;
      }
      return result;
    }
    
    // Convert modification to patches
    const patches = this.modificationToPatches(modification, currentFileContent);
    
    if (patches.length === 0) {
      return { success: false, error: 'No valid patches generated' };
    }
    
    // Apply patches with currentFileContent for validation
    const result = await this.applyPatches(filePath, patches, projectId, currentFileContent);
    if (result.success) {
      result.snapshotId = snapshotId;
    }
    return result;
  }

  /**
   * Write file directly (bypass patch system for full replacements)
   * @param {string} filePath - File path (relative to project)
   * @param {string} content - New file content
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} Result { success: boolean, error?: string }
   */
  async writeFileDirect(filePath, content, projectId) {
    // Validate filePath - it should be a path, not content
    if (!filePath || filePath.length > 500 || filePath.includes('\\documentclass') || filePath.includes('\\begin{document}')) {
      console.error(`❌ Invalid filePath provided to writeFileDirect. Length: ${filePath?.length}, starts with: ${filePath?.substring(0, 100)}`);
      return { success: false, error: `Invalid file path: path appears to be file content instead of a file path` };
    }
    
    const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    
    try {
      const { getProjectPath } = await import('./files.js');
      const projectPath = getProjectPath(undefined, projectId);
      const projectPathAbs = path.resolve(projectPath);
      const target = path.resolve(projectPathAbs, normalizedPath);
      
      // Security check
      if (!target.startsWith(projectPathAbs + path.sep) && target !== projectPathAbs) {
        return { success: false, error: 'Invalid file path' };
      }
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(target), { recursive: true });
      
      // Write file directly
      await fs.writeFile(target, content, 'utf-8');
      
      console.log(`✅ Direct write successful: ${normalizedPath} (${content.length} chars)`);
      return { success: true, patchesApplied: 1 };
    } catch (error) {
      console.error('Error writing file directly:', error);
      return { success: false, error: error.message || 'Failed to write file' };
    }
  }

  /**
   * Convert modification object to patches
   * @param {Object} modification - Modification object
   * @param {string} fileContent - Current file content
   * @returns {Array} Array of patch objects { start: number, end: number, newText: string }
   */
  modificationToPatches(modification, fileContent) {
    const patches = [];
    
    if (modification.type === 'replace') {
      // Determine start and end positions
      let start, end;
      
      if (modification.line !== undefined) {
        // Line-based replacement
        const lineInfo = this.contextMapper.findLineByNumber(modification.line, fileContent);
        if (!lineInfo) {
          return patches; // Invalid line number
        }
        
        if (modification.oldContent) {
          // Replace specific content within the line
          const oldPos = lineInfo.content.indexOf(modification.oldContent);
          if (oldPos !== -1) {
            start = lineInfo.start + oldPos;
            end = start + modification.oldContent.length;
          } else {
            // Fallback: replace entire line
            start = lineInfo.start;
            end = lineInfo.end;
          }
        } else {
          // Replace entire line
          start = lineInfo.start;
          end = lineInfo.end;
        }
      } else if (modification.start !== undefined && modification.end !== undefined) {
        // Character position-based replacement
        start = modification.start;
        end = modification.end;
      } else if (modification.oldContent) {
        // Content-based replacement
        const oldPos = fileContent.indexOf(modification.oldContent);
        if (oldPos !== -1) {
          start = oldPos;
          end = oldPos + modification.oldContent.length;
        } else {
          return patches; // Old content not found
        }
      } else {
        return patches; // Invalid modification
      }
      
      patches.push({
        start: start,
        end: end,
        newText: modification.content || ''
      });
      
    } else if (modification.type === 'insert') {
      // Insert at position
      let position;
      
      if (modification.line !== undefined) {
        const lineInfo = this.contextMapper.findLineByNumber(modification.line, fileContent);
        if (!lineInfo) {
          return patches;
        }
        position = lineInfo.end; // Insert after the line (including newline)
      } else if (modification.position !== undefined) {
        position = modification.position;
      } else if (modification.start !== undefined) {
        position = modification.start;
      } else {
        return patches; // Invalid modification
      }
      
      patches.push({
        start: position,
        end: position,
        newText: modification.content || ''
      });
      
    } else if (modification.type === 'delete') {
      // Delete content
      let start, end;
      
      if (modification.line !== undefined) {
        const lineInfo = this.contextMapper.findLineByNumber(modification.line, fileContent);
        if (!lineInfo) {
          return patches;
        }
        start = lineInfo.start;
        end = lineInfo.end + 1; // Include newline
      } else if (modification.start !== undefined && modification.end !== undefined) {
        start = modification.start;
        end = modification.end;
      } else if (modification.oldContent) {
        const oldPos = fileContent.indexOf(modification.oldContent);
        if (oldPos !== -1) {
          start = oldPos;
          end = oldPos + modification.oldContent.length;
        } else {
          return patches;
        }
      } else {
        return patches;
      }
      
      patches.push({
        start: start,
        end: end,
        newText: ''
      });
    } else if (modification.type === 'patch') {
      // Direct patch - use as-is
      patches.push({
        start: modification.start,
        end: modification.end,
        newText: modification.content || ''
      });
    }
    
    return patches;
  }

  /**
   * Apply multiple patches to a file
   * @param {string} filePath - File path (relative to project)
   * @param {Array} patches - Array of patch objects
   * @param {string} projectId - Project ID
   * @param {string} expectedContent - Expected file content for validation (optional)
   * @returns {Promise<Object>} Result { success: boolean, error?: string }
   */
  async applyPatches(filePath, patches, projectId, expectedContent = null) {
    if (!patches || patches.length === 0) {
      return { success: false, error: 'No patches provided' };
    }
    
    // Normalize file path (remove leading slash, handle Windows paths)
    const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    
    try {
      // Get project directory
      const projectPath = getProjectPath(undefined, projectId);
      const projectPathAbs = path.resolve(projectPath);
      const target = path.resolve(projectPathAbs, normalizedPath);
      
      // Security check: ensure target is within project directory
      if (!target.startsWith(projectPathAbs + path.sep) && target !== projectPathAbs) {
        return { success: false, error: 'Invalid file path' };
      }
      
      // Read current file content
      let content = '';
      try {
        content = await fs.readFile(target, 'utf-8');
      } catch {
        // If file does not exist, start from empty
        content = '';
      }
      
      // Use expectedContent if provided and different from file content
      // This handles cases where the file was modified but we have the expected state
      if (expectedContent && expectedContent.length > 0 && content !== expectedContent) {
        console.log(`⚠️ File content differs from expected. Using expected content for patch validation.`);
        console.log(`   File size: ${content.length}, Expected size: ${expectedContent.length}`);
        // Validate against expectedContent instead
        content = expectedContent;
      }
      
      // Validate patch ranges against the content we'll be modifying
      for (const p of patches) {
        if (typeof p.start !== 'number' || typeof p.end !== 'number' || p.start < 0 || p.end < p.start) {
          return { success: false, error: 'Invalid patch ranges' };
        }
        if (p.end > content.length) {
          console.error(`❌ Patch out of bounds: end=${p.end} but content length=${content.length}`);
          return { success: false, error: `Patch out of bounds: end position ${p.end} exceeds file length ${content.length}` };
        }
      }
      
      // Sort patches by start position (ascending)
      const sortedPatches = [...patches].sort((a, b) => a.start - b.start);
      
      // Apply patches sequentially with offset tracking
      let offset = 0;
      let result = content;
      for (const p of sortedPatches) {
        const s = p.start + offset;
        const e = p.end + offset;
        if (s > result.length || e > result.length) {
          return { success: false, error: 'Patch out of bounds' };
        }
        result = result.slice(0, s) + (p.newText ?? '') + result.slice(e);
        offset += (p.newText?.length || 0) - (e - s);
      }
      
      // Write file
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, result, 'utf-8');
      
      return { success: true, patchesApplied: patches.length };
      
    } catch (error) {
      console.error('Error applying patches:', error);
      return { success: false, error: error.message || 'Failed to apply patches' };
    }
  }

  /**
   * Map user target reference to file modification
   * @param {Object} target - Target object from action
   * @param {string} fileContent - Current file content
   * @param {Object} context - Context with projectId and filePath
   * @returns {Promise<Object|null>} Modification location { start: number, end: number, ... }
   */
  async mapTargetToLocation(target, fileContent, context = {}) {
    if (!target || !fileContent) {
      return null;
    }
    
    return await this.contextMapper.mapUserReference(target, fileContent, {
      projectId: context.projectId,
      filePath: context.filePath,
      useAI: context.useAI !== false
    });
  }
}

