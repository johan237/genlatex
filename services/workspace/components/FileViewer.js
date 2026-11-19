// SPDX-License-Identifier: MIT

'use client';

import { useEffect, useState, useRef } from 'react';

export default function FileViewer({ projectId, filePath, fileViewMode }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [error, setError] = useState('');
  const abortControllerRef = useRef(null);
  const currentFilePathRef = useRef(null);

  useEffect(() => {
    // Normalize file path for consistent comparison
    const normalizedPath = filePath ? filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/') : '';
    
    if (!normalizedPath) {
      setLoading(false);
      setContent('');
      setError('');
      currentFilePathRef.current = null;
      return;
    }

    const isImageFile = /\.(png|jpg|jpeg|gif|svg)$/i.test(normalizedPath);
    const isPdfFile = /\.pdf$/i.test(normalizedPath);
    
    // For images and PDFs - show loading until image/PDF loads (via onLoad)
    if (isImageFile || isPdfFile) {
      setContent('');
      setError('');
      setImageError(false);
      currentFilePathRef.current = normalizedPath;
      setImageLoaded(false);
      setLoading(true); // Will be cleared by onLoad in img/iframe
      return;
    }

    // Cancel any pending file load to prevent race conditions
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Create new AbortController for this load operation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    currentFilePathRef.current = normalizedPath;

    const loadFile = async () => {
      setLoading(true);
      setError('');
      setContent(''); // Clear previous content immediately
      
      try {
        const res = await fetch(`/api/files/${projectId}?file=${encodeURIComponent(normalizedPath)}`, {
          signal: abortController.signal
        });
        
        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }
        
        // Check if file path changed during load
        if (currentFilePathRef.current !== normalizedPath) {
          console.log(`⏭️  File changed during load, ignoring result for: ${normalizedPath}`);
          return;
        }
        
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error || errData?.message || `Failed to load file (${res.status})`;
          throw new Error(msg);
        }
        
        const data = await res.json();
        
        // Final check before updating state
        if (abortController.signal.aborted || currentFilePathRef.current !== normalizedPath) {
          console.log(`⏭️  File changed before state update, ignoring result for: ${normalizedPath}`);
          return;
        }
        
        setContent(data.content || '');
      } catch (err) {
        // Don't log error if it was aborted (expected behavior)
        if (err.name !== 'AbortError') {
          console.error('Failed to load file:', err);
          // Only set error if this is still the current file
          if (currentFilePathRef.current === normalizedPath) {
            setError(err.message || 'Failed to load file');
          }
        }
      } finally {
        // Only clear loading state if this is still the expected file
        if (currentFilePathRef.current === normalizedPath) {
          setLoading(false);
        }
      }
    };

    loadFile();
    
    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [projectId, filePath]);

  const isImageFile = /\.(png|jpg|jpeg|gif|svg)$/i.test(filePath);
  const isPdfFile = /\.pdf$/i.test(filePath);
  const fileName = filePath ? filePath.split('/').pop() : '';

  // For non-image/PDF files, show loading until content is fetched
  if (loading && !isImageFile && !isPdfFile) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full bg-white dark:bg-gray-900">
        <svg className="w-10 h-10 animate-spin text-blue-500 dark:text-blue-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
          <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="text-sm text-gray-600 dark:text-gray-400">Loading file...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  if (isImageFile) {
    const normalizedPath = filePath ? filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/') : filePath;
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 relative">
        {loading && !imageLoaded && !imageError && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <svg className="w-10 h-10 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-400">Loading image...</span>
            </div>
          </div>
        )}
        {imageError ? (
          <div className="flex flex-col items-center justify-center gap-2 p-6 rounded-lg bg-gray-100 dark:bg-gray-800 text-center max-w-md">
            <svg className="w-12 h-12 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14" />
            </svg>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Image not found</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 break-all">{fileName || filePath}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Add this file to the project or update the path in your document.</p>
          </div>
        ) : (
          <div className="max-w-full max-h-full">
            <img 
              src={`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(normalizedPath)}`}
              alt={fileName}
              className="max-w-full max-h-full object-contain"
              style={{ maxHeight: 'calc(100vh - 200px)' }}
              onLoad={() => {
                setImageLoaded(true);
                setLoading(false);
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                setImageError(true);
                setLoading(false);
                console.warn('Image not in project:', filePath);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  if (isPdfFile) {
    return (
      <div className="h-full flex flex-col relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <svg className="w-10 h-10 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span className="text-sm text-gray-600 dark:text-gray-400">Loading PDF...</span>
            </div>
          </div>
        )}
        <div className="p-2 border-b bg-gray-50">
          <div className="text-sm text-gray-600">
            <span className="font-medium">File:</span> {fileName}
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <iframe
            src={`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(filePath)}`}
            className="w-full h-full border-0"
            title={fileName}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    );
  }

  // For text files, show content in a read-only view
  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b bg-gray-50">
        <div className="text-sm text-gray-600">
          <span className="font-medium">File:</span> {fileName}
          <span className="ml-4 font-medium">Size:</span> {content.length} characters
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-sm font-mono whitespace-pre-wrap text-gray-800">
          {content}
        </pre>
      </div>
    </div>
  );
}
