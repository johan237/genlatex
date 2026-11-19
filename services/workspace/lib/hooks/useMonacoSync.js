// SPDX-License-Identifier: MIT

'use client';

import { useEffect, useRef, useCallback } from 'react';
import { FileStatus, normalizeFilePath } from '../file-manager.js';

/**
 * Get Monaco language ID based on file extension
 * @param {string} filePath 
 * @returns {string}
 */
export function getLanguageFromFile(filePath) {
  if (!filePath) return 'plaintext';
  
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  const languageMap = {
    'tex': 'latex',
    'latex': 'latex',
    'bib': 'bibtex',
    'bibtex': 'bibtex',
    'sty': 'latex',
    'cls': 'latex',
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'md': 'markdown',
    'markdown': 'markdown',
    'css': 'css',
    'scss': 'scss',
    'html': 'html',
    'htm': 'html',
    'xml': 'xml',
    'svg': 'xml',
    'yaml': 'yaml',
    'yml': 'yaml',
    'py': 'python',
    'sh': 'shell',
    'bash': 'shell',
    'txt': 'plaintext',
    'log': 'plaintext',
  };
  
  return languageMap[ext] || 'plaintext';
}

/**
 * Check if a file is editable (text-based)
 * @param {string} filePath 
 * @returns {boolean}
 */
export function isEditableFile(filePath) {
  if (!filePath) return false;
  
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  
  const editableExtensions = [
    'tex', 'latex', 'bib', 'bibtex', 'sty', 'cls',
    'js', 'jsx', 'ts', 'tsx', 'json',
    'md', 'markdown', 'txt', 'log',
    'css', 'scss', 'html', 'htm', 'xml', 'svg',
    'yaml', 'yml', 'py', 'sh', 'bash',
    'gitignore', 'env', 'cfg', 'ini', 'conf'
  ];
  
  return editableExtensions.includes(ext) || !ext;
}

/**
 * React hook for Monaco editor synchronization with FileManager
 * 
 * @param {Object} params
 * @param {React.RefObject} params.editorRef - Ref to Monaco editor instance
 * @param {React.RefObject} params.monacoRef - Ref to Monaco namespace
 * @param {string} params.currentFile - Current file ID from FileManager
 * @param {string} params.content - Content from FileManager
 * @param {string} params.status - FileManager status
 * @param {Function} params.updateContent - FileManager updateContent function
 * @param {Function} params.setContentDirect - FileManager setContentDirect function
 * @param {Object} options
 * @param {Function} options.onContentChange - Callback when content changes
 * @param {boolean} options.skipInitialSync - Don't sync on mount
 * 
 * @returns {Object} Monaco sync utilities
 */
export function useMonacoSync({
  editorRef,
  monacoRef,
  currentFile,
  content,
  status,
  updateContent,
  setContentDirect,
}, options = {}) {
  const { onContentChange, skipInitialSync = false } = options;

  // Track last synced values to prevent loops
  const lastSyncedFileRef = useRef(null);
  const lastSyncedContentRef = useRef(null);
  const isUpdatingFromMonacoRef = useRef(false);
  const isUpdatingMonacoRef = useRef(false);
  const disposablesRef = useRef([]);

  /**
   * Create a new Monaco model for a file
   */
  const createModel = useCallback((fileId, fileContent) => {
    const monaco = monacoRef?.current;
    if (!monaco || !fileId) return null;

    const normalizedFileId = normalizeFilePath(fileId);
    const fileUri = monaco.Uri.parse(`file:///${normalizedFileId}`);
    const language = getLanguageFromFile(normalizedFileId);

    // Dispose existing model if it exists
    const existingModel = monaco.editor.getModel(fileUri);
    if (existingModel) {
      console.log(`🗑️ useMonacoSync: Disposing existing model for ${normalizedFileId}`);
      existingModel.dispose();
    }

    // Create fresh model
    const model = monaco.editor.createModel(fileContent || '', language, fileUri);
    console.log(`📄 useMonacoSync: Created model for ${normalizedFileId} (${language}, ${(fileContent || '').length} chars)`);

    return model;
  }, [monacoRef]);

  /**
   * Sync FileManager content to Monaco editor
   */
  const syncToMonaco = useCallback(() => {
    const editor = editorRef?.current;
    const monaco = monacoRef?.current;
    
    if (!editor || !monaco || !currentFile) return;
    if (isUpdatingFromMonacoRef.current) return; // Prevent loop
    if (status === FileStatus.LOADING) return; // Don't sync during load

    const normalizedFile = normalizeFilePath(currentFile);

    // Check if file changed
    const fileChanged = lastSyncedFileRef.current !== normalizedFile;
    const contentChanged = lastSyncedContentRef.current !== content;

    if (!fileChanged && !contentChanged) return;

    isUpdatingMonacoRef.current = true;

    try {
      if (fileChanged) {
        // File changed - create new model
        console.log(`🔄 useMonacoSync: File changed to ${normalizedFile}`);
        const model = createModel(normalizedFile, content);
        
        if (model) {
          editor.setModel(model);
          lastSyncedFileRef.current = normalizedFile;
          lastSyncedContentRef.current = content;
        }
      } else if (contentChanged) {
        // Same file, content changed externally
        const model = editor.getModel();
        if (model && model.getValue() !== content) {
          console.log(`🔄 useMonacoSync: Updating content for ${normalizedFile}`);
          model.setValue(content);
          lastSyncedContentRef.current = content;
        }
      }
    } finally {
      isUpdatingMonacoRef.current = false;
    }
  }, [editorRef, monacoRef, currentFile, content, status, createModel]);

  /**
   * Setup Monaco change listener
   */
  const setupChangeListener = useCallback(() => {
    const editor = editorRef?.current;
    if (!editor) return;

    // Dispose old listeners
    disposablesRef.current.forEach(d => d.dispose());
    disposablesRef.current = [];

    // Listen for content changes from Monaco
    const disposable = editor.onDidChangeModelContent((event) => {
      if (isUpdatingMonacoRef.current) return; // Prevent loop

      const model = editor.getModel();
      if (!model) return;

      const newContent = model.getValue();
      
      // Update refs to track this change
      lastSyncedContentRef.current = newContent;
      isUpdatingFromMonacoRef.current = true;

      try {
        // Send to FileManager
        updateContent(newContent);

        // Call optional callback
        if (onContentChange) {
          onContentChange(newContent, event);
        }
      } finally {
        isUpdatingFromMonacoRef.current = false;
      }
    });

    disposablesRef.current.push(disposable);

    // Listen for model changes
    const modelDisposable = editor.onDidChangeModel((event) => {
      if (event.newModelUrl) {
        const fileId = event.newModelUrl.path.replace(/^\/+/, '');
        console.log(`📄 useMonacoSync: Model changed to ${fileId}`);
        lastSyncedFileRef.current = normalizeFilePath(fileId);
      }
    });

    disposablesRef.current.push(modelDisposable);
  }, [editorRef, updateContent, onContentChange]);

  // Sync when file/content changes
  useEffect(() => {
    if (skipInitialSync && !lastSyncedFileRef.current) {
      // Skip initial sync but track the file
      lastSyncedFileRef.current = normalizeFilePath(currentFile);
      lastSyncedContentRef.current = content;
      return;
    }

    syncToMonaco();
  }, [currentFile, content, status, syncToMonaco, skipInitialSync]);

  // Setup change listener when editor is ready
  useEffect(() => {
    setupChangeListener();

    return () => {
      // Cleanup on unmount
      disposablesRef.current.forEach(d => d.dispose());
      disposablesRef.current = [];
    };
  }, [setupChangeListener]);

  // Cleanup all models on unmount
  useEffect(() => {
    return () => {
      const monaco = monacoRef?.current;
      if (monaco) {
        const models = monaco.editor.getModels();
        console.log(`🗑️ useMonacoSync: Disposing ${models.length} models on unmount`);
        models.forEach(model => model.dispose());
      }
    };
  }, [monacoRef]);

  // ============================================================
  // RETURN VALUE
  // ============================================================

  return {
    // Utilities
    createModel,
    syncToMonaco,
    setupChangeListener,
    getLanguageFromFile,
    isEditableFile,

    // State
    lastSyncedFile: lastSyncedFileRef.current,
    isUpdating: isUpdatingMonacoRef.current || isUpdatingFromMonacoRef.current,
  };
}

export default useMonacoSync;
