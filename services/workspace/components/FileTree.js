// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useRef } from 'react';
import FileUpload from './FileUpload';
import { useToast, useConfirm } from './Toast';

export default function FileTree({ projectId, onFileSelect, onFileCreate, onFileDelete, onFileRename, isDarkMode = false, highlightedFiles = [], onFileHighlight, refreshKey = 0 }) {
  const { toast } = useToast();
  const { confirm: showConfirm, ConfirmDialog } = useConfirm();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [editingFile, setEditingFile] = useState(null);
  const [newFileName, setNewFileName] = useState('');
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);

  useEffect(() => {
    loadFiles();
  }, [projectId, refreshKey]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenu && contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape' && contextMenu) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [contextMenu]);

  const loadFiles = async () => {
    try {
      const response = await fetch(`/api/files/${projectId}/tree`, { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      }
    } catch (error) {
      console.error('Failed to load files:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFolder = (path) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedFolders(newExpanded);
  };

  const startRename = (file) => {
    setEditingFile(file.path);
    setNewFileName(file.name);
  };

  const saveRename = async () => {
    if (!editingFile || !newFileName.trim()) return;
    const nameToSave = newFileName.trim();
    if (nameToSave === '') return;
    try {
      const response = await fetch(`/api/files/${projectId}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPath: editingFile.replace(/\\/g, '/'),
          newName: nameToSave
        })
      });
      const data = response.ok ? await response.json().catch(() => ({})) : await response.json().catch(() => ({ error: 'Failed to rename' }));
      if (!response.ok) {
        toast.error(data.error || 'Failed to rename file');
        return;
      }
      toast.success(`Renamed to "${nameToSave}"`);
      const dir = editingFile.includes('/') ? editingFile.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : '';
      const newPath = dir ? `${dir}/${nameToSave}` : nameToSave;
      if (onFileRename) onFileRename(editingFile, newPath);
      setEditingFile(null);
      setNewFileName('');
      await loadFiles();
    } catch (error) {
      console.error('Failed to rename file:', error);
      toast.error('Failed to rename file');
    }
  };

  const cancelRename = () => {
    setEditingFile(null);
    setNewFileName('');
  };

  const handleDelete = async (file) => {
    console.log('🗑️  Delete requested for:', file.name, file.path);
    
    const confirmed = await showConfirm({
      title: 'Delete File',
      description: `Are you sure you want to delete "${file.name}"? This action cannot be undone.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) {
      console.log('❌ Delete cancelled by user');
      return;
    }
    
    try {
      console.log('📤 Sending delete request...');
      const response = await fetch(`/api/files/${projectId}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path })
      });
      
      console.log('📥 Delete response status:', response.status);
      
      if (response.ok) {
        const result = await response.json();
        console.log('📄 Delete response:', result);
        
        if (result.success) {
          console.log(`✅ File deleted successfully: ${file.path}`);
          toast.success(`"${file.name}" deleted successfully`);
          // Notify parent component about deletion
          if (onFileDelete) {
            onFileDelete(file.path);
          }
          await loadFiles();
        } else {
          console.error('❌ Delete failed:', result.error);
          toast.error(result.error || 'Failed to delete file');
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Delete request failed:', response.status, errorText);
        
        try {
          const errorData = JSON.parse(errorText);
          toast.error(errorData.error || 'Failed to delete file');
        } catch {
          toast.error(`Failed to delete file: ${errorText || 'Unknown error'}`);
        }
      }
    } catch (error) {
      console.error('❌ Error deleting file:', error);
      toast.error('Error deleting file. Please try again.');
    }
  };

  const handleCreateFile = async (type, name, parentPath = '') => {
    if (!name.trim()) return;
    const pathToUse = (parentPath || showCreateMenu?.path || '').replace(/\\/g, '/');
    try {
      const response = await fetch(`/api/files/${projectId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          name: name.trim(),
          path: pathToUse
        })
      });
      const data = response.ok ? await response.json().catch(() => ({})) : await response.json().catch(() => ({ error: 'Failed to create' }));
      if (!response.ok) {
        // If folder already exists, refresh so user can see it
        if (data?.error?.toLowerCase?.().includes('already exists')) {
          setTimeout(() => loadFiles(), 150);
        }
        toast.error(data.error || 'Failed to create file or folder');
        return;
      }
      toast.success(type === 'folder' ? 'Folder created' : 'File created');
      setShowCreateMenu(false);
      // Delay to allow storage to persist before refetch (FS/MinIO)
      setTimeout(() => loadFiles(), 150);
    } catch (error) {
      console.error('Failed to create file:', error);
      toast.error('Failed to create file or folder');
    }
  };

  const handleUploadComplete = (uploadedFiles) => {
    loadFiles(); // Refresh the file tree
    setShowUpload(false);
  };

  const showContextMenu = (event, file) => {
    event.preventDefault();
    event.stopPropagation();
    
    // For click events, position menu below the button
    // For context menu events, use mouse position
    const rect = event.currentTarget.getBoundingClientRect();
    let x = event.type === 'contextmenu' ? event.clientX : rect.left;
    let y = event.type === 'contextmenu' ? event.clientY : rect.bottom + 5;
    
    // Prevent menu from going off-screen
    const menuWidth = 180;
    const menuHeight = 250;
    
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    
    console.log('📋 Opening context menu for:', file.name, 'at', { x, y });
    
    setContextMenu({
      x: x,
      y: y,
      file: file
    });
  };

  const uploadToFolder = (folderPath) => {
    setShowUpload({ targetPath: folderPath });
    setContextMenu(null);
  };

  const createInFolder = (folderPath) => {
    setShowCreateMenu({ show: true, path: folderPath });
    setContextMenu(null);
  };

  // Get file icon based on extension
  const getFileIcon = (fileName) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    // Image files
    if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) {
      return (
        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    
    // LaTeX files
    if (['tex', 'latex', 'sty', 'cls'].includes(ext)) {
      return (
        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    }
    
    // Bibliography files
    if (ext === 'bib') {
      return (
        <svg className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );
    }
    
    // PDF files
    if (ext === 'pdf') {
      return (
        <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    
    // Default file icon
    return (
      <svg className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  };

  const isFileHighlighted = (path) => highlightedFiles.includes(path);
  const toggleHighlight = (e, file) => {
    if (file.type !== 'file') return;
    e?.stopPropagation?.();
    e?.preventDefault?.();
    onFileHighlight?.(file, !isFileHighlighted(file.path));
  };

  const renderFile = (file, depth = 0) => {
    const isExpanded = expandedFolders.has(file.path);
    const isEditing = editingFile === file.path;
    const isHighlighted = file.type === 'file' && isFileHighlighted(file.path);
    
    return (
      <div key={file.path} style={{ paddingLeft: `${depth * 12}px` }}>
        <div className={`flex items-center group py-1.5 px-2 rounded-md cursor-pointer transition-colors ${isHighlighted ? (isDarkMode ? 'bg-blue-900/30' : 'bg-blue-50') : ''} ${isDarkMode ? 'hover:bg-gray-700/50' : 'hover:bg-gray-100'}`}>
          {file.type === 'folder' ? (
            <button
              onClick={() => toggleFolder(file.path)}
              className={`flex items-center gap-2 text-sm flex-1 ${isDarkMode ? 'text-gray-300 hover:text-gray-100' : 'text-gray-700 hover:text-gray-900'}`}
            >
              <svg 
                className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <svg className={`w-4 h-4 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-500'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
              </svg>
              <span className="truncate">{file.name}</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 ml-3">
              {getFileIcon(file.name)}
              {isHighlighted && (
                <svg className="w-3.5 h-3.5 text-blue-500" fill="currentColor" viewBox="0 0 20 20" title="In chat context">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              )}
            </div>
          )}
          
          {isEditing ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename();
                  if (e.key === 'Escape') cancelRename();
                }}
                onBlur={saveRename}
                className="flex-1 px-1 py-0.5 text-sm border rounded"
                autoFocus
              />
            </div>
          ) : (
            <>
              {/* Only show name button for files - folders already display name in their toggle button */}
              {file.type === 'file' && (
                <button
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      toggleHighlight(e, file);
                    } else {
                      onFileSelect && onFileSelect(file);
                    }
                  }}
                  className={`flex-1 text-left text-sm truncate ${isDarkMode ? 'text-gray-300 hover:text-gray-100' : 'text-gray-700 hover:text-gray-900'}`}
                  title={onFileHighlight ? 'Click to open, Ctrl+Click to add to chat context' : undefined}
                >
                  {file.name}
                </button>
              )}
              
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => showContextMenu(e, file)}
                  onContextMenu={(e) => showContextMenu(e, file)}
                  className={`p-1 rounded ${isDarkMode ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-600' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200'}`}
                  title="More options"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
        
        {file.type === 'folder' && isExpanded && file.children && (
          <div>
            {file.children.map(child => renderFile(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`p-4 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
        <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Loading files...</div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
      {/* Confirm Dialog */}
      {ConfirmDialog}
      
      {/* File Upload Modal */}
      {showUpload && (
        <div className="p-2">
          <FileUpload 
            projectId={projectId} 
            onUploadComplete={handleUploadComplete}
            targetPath={showUpload.targetPath}
          />
        </div>
      )}
      
      {/* Create Menu (triggered from context menu) */}
      {showCreateMenu.show && (
        <div className={`absolute top-full right-0 mt-1 border rounded shadow-lg z-10 min-w-[120px] ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}>
          <button
            onClick={() => {
              const name = prompt('Enter file name:');
              if (name) handleCreateFile('file', name);
            }}
            className={`w-full px-3 py-2 text-left text-sm first:rounded-t ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            New File
          </button>
          <button
            onClick={() => {
              const name = prompt('Enter folder name:');
              if (name) handleCreateFile('folder', name);
            }}
            className={`w-full px-3 py-2 text-left text-sm last:rounded-b ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
          >
            New Folder
          </button>
        </div>
      )}
      
      {/* File List */}
      <div className="flex-1 overflow-auto px-2">
        {files.length === 0 ? (
          <div className="text-sm text-gray-500 italic">No files yet</div>
        ) : (
          <div>
            {files.map(file => renderFile(file))}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          {/* Menu */}
          <div
            ref={contextMenuRef}
            className={`fixed border rounded-md shadow-lg z-50 py-1 min-w-[160px] ${isDarkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-gray-200'}`}
            style={{
              left: `${contextMenu.x}px`,
              top: `${contextMenu.y}px`,
              maxHeight: '300px',
              overflowY: 'auto'
            }}
          >
          {contextMenu.file.type === 'folder' ? (
            <>
              <button
                onClick={() => createInFolder(contextMenu.file.path)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                New File
              </button>
              <button
                onClick={() => {
                  const name = prompt('Enter folder name:');
                  if (name) {
                    handleCreateFile('folder', name, contextMenu.file.path);
                  }
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                </svg>
                New Folder
              </button>
              <button
                onClick={() => uploadToFolder(contextMenu.file.path)}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload
              </button>
              <div className="border-t my-1"></div>
              <button
                onClick={() => {
                  startRename(contextMenu.file);
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Rename
              </button>
              <button
                onClick={() => {
                  handleDelete(contextMenu.file);
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-red-400 hover:bg-gray-600' : 'text-red-600 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </>
          ) : (
            <>
              {onFileHighlight && (
                <button
                  onClick={() => {
                    toggleHighlight(null, contextMenu.file);
                    setContextMenu(null);
                  }}
                  className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  {isFileHighlighted(contextMenu.file.path) ? 'Remove from context' : 'Add to chat context'}
                </button>
              )}
              <button
                onClick={() => {
                  startRename(contextMenu.file);
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Rename
              </button>
              <button
                onClick={() => {
                  window.open(`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(contextMenu.file.path)}`, '_blank');
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-gray-300 hover:bg-gray-600' : 'text-gray-700 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download
              </button>
              <button
                onClick={() => {
                  handleDelete(contextMenu.file);
                  setContextMenu(null);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'text-red-400 hover:bg-gray-600' : 'text-red-600 hover:bg-gray-100'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </>
          )}
          </div>
        </>
      )}
    </div>
  );
}
