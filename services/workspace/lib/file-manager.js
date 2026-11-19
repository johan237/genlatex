// SPDX-License-Identifier: MIT

'use strict';

/**
 * File operation status enum
 * @readonly
 * @enum {string}
 */
export const FileStatus = {
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  DIRTY: 'dirty',
  SAVING: 'saving',
  ERROR: 'error'
};

/**
 * Normalize file path for consistent comparison
 * @param {string} filePath 
 * @returns {string}
 */
export function normalizeFilePath(filePath) {
  if (!filePath) return '';
  return filePath
    .replace(/^[\/\\]+/, '')  // Remove leading slashes
    .replace(/[\/\\]+$/, '')  // Remove trailing slashes
    .replace(/\\/g, '/');     // Normalize to forward slashes
}

/**
 * FileManager Class - Singleton
 * Manages all file state and operations for the editor
 */
class FileManager {
  constructor() {
    // Core state
    this._state = {
      status: FileStatus.IDLE,
      currentFileId: null,
      content: '',
      version: null,
      isDirty: false,
      error: null,
      projectId: null,
    };

    // File versions cache (for optimistic locking)
    this._fileVersions = new Map();

    // Operation queue for serializing async operations
    this._operationQueue = Promise.resolve();
    this._queueLength = 0;

    // Abort controller for canceling stale operations
    this._abortController = null;

    // Subscribers for state changes (Observer pattern)
    this._subscribers = new Set();

    // Pending content update (for debounced saves)
    this._pendingContent = null;
    this._saveTimeout = null;
    this._autoSaveDelay = 1500; // ms

    // Bind methods to preserve context
    this.switchFile = this.switchFile.bind(this);
    this.updateContent = this.updateContent.bind(this);
    this.saveCurrentFile = this.saveCurrentFile.bind(this);
    this.forceSave = this.forceSave.bind(this);
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  /**
   * Initialize the FileManager with a project ID
   * @param {string} projectId 
   */
  initialize(projectId) {
    if (this._state.projectId === projectId) return;
    
    // Reset state for new project
    this._reset();
    this._state.projectId = projectId;
    this._notify();
    
    console.log(`📁 FileManager initialized for project: ${projectId}`);
  }

  /**
   * Get current immutable state snapshot
   * @returns {Object}
   */
  getState() {
    return { ...this._state };
  }

  /**
   * Get file version for optimistic locking
   * @param {string} fileId 
   * @returns {string|null}
   */
  getFileVersion(fileId) {
    const normalized = normalizeFilePath(fileId);
    return this._fileVersions.get(normalized) || null;
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback 
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this._subscribers.add(callback);
    // Immediately call with current state
    callback(this.getState());
    return () => {
      this._subscribers.delete(callback);
    };
  }

  /**
   * Switch to a different file
   * Saves current file if dirty, then loads the new file
   * @param {string} fileId - File path to switch to
   * @returns {Promise<boolean>} Success status
   */
  async switchFile(fileId) {
    const normalizedFileId = normalizeFilePath(fileId);
    
    if (!normalizedFileId) {
      console.warn('⚠️ FileManager: Cannot switch to empty file path');
      return false;
    }

    if (!this._state.projectId) {
      console.error('❌ FileManager: Not initialized with projectId');
      return false;
    }

    // If same file, just return success
    if (normalizedFileId === this._state.currentFileId) {
      console.log(`📁 FileManager: Already on file ${normalizedFileId}`);
      return true;
    }

    // Enqueue the operation to prevent race conditions
    return this._enqueue(async () => {
      return this._switchFileInternal(normalizedFileId);
    });
  }

  /**
   * Update content (marks file as dirty)
   * Called by Monaco editor on content change
   * @param {string} content 
   * @param {Object} options
   * @param {boolean} options.immediate - Skip debounced save
   * @param {boolean} options.skipDirty - Don't mark as dirty (for programmatic updates)
   */
  updateContent(content, options = {}) {
    const { immediate = false, skipDirty = false } = options;

    if (this._state.status === FileStatus.LOADING) {
      console.log('⏭️ FileManager: Ignoring content update during file load');
      return;
    }

    // Update state
    this._state.content = content;
    
    if (!skipDirty && this._state.status === FileStatus.READY) {
      this._state.status = FileStatus.DIRTY;
      this._state.isDirty = true;
    }

    this._pendingContent = content;
    this._notify();

    // Schedule auto-save (debounced)
    if (!skipDirty && !immediate) {
      this._scheduleAutoSave();
    } else if (immediate) {
      this._cancelAutoSave();
      this.forceSave();
    }
  }

  /**
   * Force save current file immediately
   * @returns {Promise<Object>} Save result
   */
  async forceSave() {
    this._cancelAutoSave();
    
    if (!this._state.currentFileId || !this._state.projectId) {
      return { ok: false, error: 'No file to save' };
    }

    return this._enqueue(async () => {
      return this._saveFileInternal(
        this._state.currentFileId, 
        this._pendingContent || this._state.content
      );
    });
  }

  /**
   * Save current file (used internally and for manual saves)
   * @returns {Promise<Object>}
   */
  async saveCurrentFile() {
    return this.forceSave();
  }

  /**
   * Cancel any pending operations and reset
   */
  cancel() {
    this._cancelPendingLoad();
    this._cancelAutoSave();
  }

  /**
   * Cleanup - call on component unmount
   */
  cleanup() {
    this.cancel();
    // Don't reset subscribers - they handle their own cleanup
    console.log('🧹 FileManager: Cleaned up');
  }

  /**
   * Set content directly (for Monaco sync after external updates)
   * @param {string} content 
   */
  setContentDirect(content) {
    this._state.content = content;
    this._pendingContent = content;
    // Don't notify - Monaco is the source of this change
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Enqueue an operation to be executed serially
   * @private
   * @param {Function} operation 
   * @returns {Promise<boolean>}
   */
  _enqueue(operation) {
    this._queueLength++;
    const queuePosition = this._queueLength;
    
    const result = this._operationQueue
      .then(async () => {
        // Check if operation was superseded by a newer operation
        if (queuePosition < this._queueLength) {
          console.log(`⏭️ FileManager: Skipping superseded operation #${queuePosition} (current: ${this._queueLength})`);
          return false;
        }
        try {
          return await operation();
        } catch (error) {
          console.error('❌ FileManager: Operation error:', error);
          this._state.status = FileStatus.ERROR;
          this._state.error = error;
          this._notify();
          return false;
        }
      })
      .catch(error => {
        console.error('❌ FileManager: Queue error:', error);
        return false;
      });

    this._operationQueue = result.then(() => {}).catch(() => {});
    return result;
  }

  /**
   * Internal file switch implementation
   * @private
   * @param {string} fileId 
   * @returns {Promise<boolean>}
   */
  async _switchFileInternal(fileId) {
    const previousFileId = this._state.currentFileId;
    const previousContent = this._pendingContent || this._state.content;

    console.log(`📂 FileManager._switchFileInternal: ${previousFileId || 'null'} → ${fileId}`);
    console.log(`📂 FileManager: projectId = ${this._state.projectId}`);

    // Cancel any pending operations
    this._cancelPendingLoad();
    this._cancelAutoSave();

    // Step 1: Save dirty file first
    if (previousFileId && this._state.isDirty && previousContent) {
      console.log(`💾 FileManager: Saving dirty file ${previousFileId} before switch`);
      await this._saveFileInternal(previousFileId, previousContent);
    }

    // Step 2: Create new abort controller for this load
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    // Step 3: Update state to loading
    this._state.status = FileStatus.LOADING;
    this._state.currentFileId = fileId;
    this._state.content = '';
    this._state.isDirty = false;
    this._state.error = null;
    this._pendingContent = null;
    this._notify();

    try {
      // Step 4: Load file content
      const result = await this._loadFileContent(fileId, signal);

      // Check if aborted
      if (signal.aborted) {
        console.log(`⏭️ FileManager: Load aborted for ${fileId}`);
        return false;
      }

      // Check if file changed during load
      if (this._state.currentFileId !== fileId) {
        console.log(`⏭️ FileManager: File changed during load, ignoring ${fileId}`);
        return false;
      }

      // Step 5: Update state with loaded content
      this._state.status = FileStatus.READY;
      this._state.content = result.content;
      this._state.version = result.version;
      this._state.isDirty = false;
      this._state.error = null;
      this._pendingContent = null;
      this._notify();

      console.log(`✅ FileManager: Loaded ${fileId} (${result.content.length} chars)`);
      return true;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`⏭️ FileManager: Load aborted for ${fileId}`);
        return false;
      }

      console.error(`❌ FileManager: Failed to load ${fileId}:`, error);
      this._state.status = FileStatus.ERROR;
      this._state.error = error;
      this._notify();
      return false;
    }
  }

  /**
   * Load file content from server
   * @private
   * @param {string} fileId 
   * @param {AbortSignal} signal 
   * @returns {Promise<{content: string, version: string|null}>}
   */
  async _loadFileContent(fileId, signal) {
    const requestId = crypto.randomUUID();
    const url = `/api/files/${this._state.projectId}?file=${encodeURIComponent(fileId)}`;

    console.log(`📂 FileManager._loadFileContent: Fetching ${url}`);

    const response = await fetch(url, {
      signal,
      headers: {
        'x-request-id': requestId
      }
    });

    console.log(`📂 FileManager._loadFileContent: Response status = ${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Failed to load ${fileId}`);
    }

    const data = await response.json();
    
    console.log(`📂 FileManager._loadFileContent: Got content length = ${data.content?.length || 0}`);
    
    // Update version cache
    if (data.version) {
      this._setFileVersion(fileId, data.version);
    }

    return {
      content: data.content || '',
      version: data.version || null
    };
  }

  /**
   * Save file content to server
   * @private
   * @param {string} fileId 
   * @param {string} content 
   * @returns {Promise<Object>}
   */
  async _saveFileInternal(fileId, content) {
    if (!content || content.trim() === '') {
      console.warn(`⚠️ FileManager: Skipping save - empty content for ${fileId}`);
      return { ok: false, error: 'Empty content' };
    }

    const previousStatus = this._state.status;
    this._state.status = FileStatus.SAVING;
    this._notify();

    try {
      const requestId = crypto.randomUUID();
      const expectedVersion = this.getFileVersion(fileId);

      console.log(`💾 FileManager: Saving ${fileId} [${requestId}]`);

      const response = await fetch(`/api/files/${this._state.projectId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': requestId
        },
        body: JSON.stringify({
          content,
          file: fileId,
          expectedVersion
        })
      });

      // Handle version conflict
      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        if (data.currentVersion) {
          this._setFileVersion(fileId, data.currentVersion);
        }
        
        console.error(`⚠️ FileManager: Save conflict for ${fileId} [${requestId}]`);
        
        // Restore status
        this._state.status = previousStatus;
        this._notify();
        
        return { ok: false, conflict: true, currentVersion: data.currentVersion };
      }

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.version) {
          this._setFileVersion(fileId, data.version);
        }

        // Update state - file is now clean
        if (this._state.currentFileId === fileId) {
          this._state.status = FileStatus.READY;
          this._state.isDirty = false;
          this._state.version = data.version || this._state.version;
        } else {
          this._state.status = previousStatus;
        }
        this._notify();

        console.log(`✅ FileManager: Saved ${fileId} [${requestId}]`);
        return { ok: true, version: data.version };
      }

      throw new Error(`HTTP ${response.status}: Failed to save ${fileId}`);

    } catch (error) {
      console.error(`❌ FileManager: Save failed for ${fileId}:`, error);
      this._state.status = FileStatus.ERROR;
      this._state.error = error;
      this._notify();
      return { ok: false, error };
    }
  }

  /**
   * Schedule debounced auto-save
   * @private
   */
  _scheduleAutoSave() {
    this._cancelAutoSave();

    this._saveTimeout = setTimeout(async () => {
      if (this._state.isDirty && this._state.currentFileId && this._pendingContent) {
        console.log(`⏰ FileManager: Auto-saving ${this._state.currentFileId}`);
        await this.forceSave();
      }
    }, this._autoSaveDelay);
  }

  /**
   * Cancel pending auto-save
   * @private
   */
  _cancelAutoSave() {
    if (this._saveTimeout) {
      clearTimeout(this._saveTimeout);
      this._saveTimeout = null;
    }
  }

  /**
   * Cancel pending file load
   * @private
   */
  _cancelPendingLoad() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  /**
   * Set file version in cache
   * @private
   * @param {string} fileId 
   * @param {string} version 
   */
  _setFileVersion(fileId, version) {
    if (!fileId || !version) return;
    const normalized = normalizeFilePath(fileId);
    this._fileVersions.set(normalized, version);
  }

  /**
   * Notify all subscribers of state change
   * @private
   */
  _notify() {
    const state = this.getState();
    this._subscribers.forEach(callback => {
      try {
        callback(state);
      } catch (error) {
        console.error('❌ FileManager: Subscriber error:', error);
      }
    });
  }

  /**
   * Reset state
   * @private
   */
  _reset() {
    this._cancelPendingLoad();
    this._cancelAutoSave();
    
    this._state = {
      status: FileStatus.IDLE,
      currentFileId: null,
      content: '',
      version: null,
      isDirty: false,
      error: null,
      projectId: null,
    };
    
    this._fileVersions.clear();
    this._pendingContent = null;
    this._queueLength = 0;
    this._operationQueue = Promise.resolve();
  }
}

// ============================================================
// SINGLETON EXPORT
// ============================================================

// Single instance for the entire application
const fileManager = new FileManager();

// Note: We don't freeze the instance because it needs to modify its internal state
// The singleton pattern ensures only one instance exists

export default fileManager;

// Named exports for convenience
export { fileManager };
