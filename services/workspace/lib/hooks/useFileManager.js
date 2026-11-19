// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import fileManager, { FileStatus, normalizeFilePath } from '../file-manager.js';

/**
 * React hook for FileManager integration
 * 
 * @param {string} projectId - Project ID to initialize FileManager with
 * @returns {Object} File state and actions
 * 
 * @example
 * const {
 *   currentFile,
 *   content,
 *   isLoading,
 *   isSaving,
 *   isDirty,
 *   error,
 *   switchFile,
 *   updateContent,
 *   saveFile,
 * } = useFileManager(projectId);
 */
export function useFileManager(projectId) {
  // State from FileManager
  const [state, setState] = useState(() => fileManager.getState());
  
  // Track the projectId we initialized with
  const initializedProjectRef = useRef(null);

  // Initialize FileManager with projectId - reinitialize if projectId changes
  useEffect(() => {
    if (projectId && projectId !== initializedProjectRef.current) {
      console.log(`🔧 useFileManager: Initializing FileManager for project: ${projectId}`);
      fileManager.initialize(projectId);
      initializedProjectRef.current = projectId;
    }
  }, [projectId]);

  // Subscribe to FileManager state changes
  useEffect(() => {
    const unsubscribe = fileManager.subscribe((newState) => {
      setState(newState);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Save any pending changes before unmount
      if (state.isDirty) {
        fileManager.forceSave().catch(err => {
          console.error('Failed to save on unmount:', err);
        });
      }
    };
  }, [state.isDirty]);

  // ============================================================
  // MEMOIZED ACTIONS
  // ============================================================

  /**
   * Switch to a different file
   * @param {string} fileId - File path to switch to
   * @returns {Promise<boolean>}
   */
  const switchFile = useCallback(async (fileId) => {
    const normalized = normalizeFilePath(fileId);
    if (!normalized) {
      console.warn('useFileManager: Cannot switch to empty file path');
      return false;
    }
    return fileManager.switchFile(normalized);
  }, []);

  /**
   * Update file content (marks as dirty, schedules auto-save)
   * @param {string} content - New content
   * @param {Object} options
   */
  const updateContent = useCallback((content, options = {}) => {
    fileManager.updateContent(content, options);
  }, []);

  /**
   * Set content directly without marking dirty (for Monaco sync)
   * @param {string} content 
   */
  const setContentDirect = useCallback((content) => {
    fileManager.setContentDirect(content);
  }, []);

  /**
   * Force save current file immediately
   * @returns {Promise<Object>}
   */
  const saveFile = useCallback(async () => {
    return fileManager.forceSave();
  }, []);

  /**
   * Get file version for a specific file
   * @param {string} fileId 
   * @returns {string|null}
   */
  const getFileVersion = useCallback((fileId) => {
    return fileManager.getFileVersion(fileId);
  }, []);

  /**
   * Cancel any pending operations
   */
  const cancel = useCallback(() => {
    fileManager.cancel();
  }, []);

  // ============================================================
  // COMPUTED VALUES
  // ============================================================

  const isLoading = state.status === FileStatus.LOADING;
  const isSaving = state.status === FileStatus.SAVING;
  const isReady = state.status === FileStatus.READY || state.status === FileStatus.DIRTY;
  const hasError = state.status === FileStatus.ERROR;

  // ============================================================
  // RETURN VALUE
  // ============================================================

  return {
    // State
    currentFile: state.currentFileId,
    content: state.content,
    version: state.version,
    isDirty: state.isDirty,
    status: state.status,
    error: state.error,
    projectId: state.projectId,

    // Computed
    isLoading,
    isSaving,
    isReady,
    hasError,

    // Actions
    switchFile,
    updateContent,
    setContentDirect,
    saveFile,
    getFileVersion,
    cancel,

    // Raw FileManager access (for advanced use cases)
    fileManager,
  };
}

export default useFileManager;
