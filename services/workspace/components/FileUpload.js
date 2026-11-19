// SPDX-License-Identifier: MIT

'use client';

import { useState, useRef } from 'react';
import { useToast } from './Toast';

export default function FileUpload({ projectId, onUploadComplete, targetPath }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileSelect = async (files) => {
    if (!files || files.length === 0) return;
    
    setUploading(true);
    const formData = new FormData();
    
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    
    try {
      const url = `/api/files/${projectId}/upload${targetPath ? `?target=${encodeURIComponent(targetPath)}` : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success(`${files.length} file(s) uploaded successfully`);
        onUploadComplete && onUploadComplete(result.files);
      } else {
        toast.error('Upload failed: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    handleFileSelect(files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="space-y-4">
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragOver 
            ? 'border-blue-400 bg-blue-50' 
            : 'border-gray-300 hover:border-gray-400'
        }`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
            <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="text-sm text-gray-600">
            <button
              type="button"
              onClick={openFileDialog}
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              Click to upload
            </button>
            {' '}or drag and drop
          </div>
          <p className="text-xs text-gray-500">
            LaTeX files, images, bibliography files, and other project assets
          </p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFileSelect(Array.from(e.target.files))}
        accept=".tex,.bib,.sty,.cls,.png,.jpg,.jpeg,.gif,.pdf,.eps,.svg"
      />

      {uploading && (
        <div className="flex items-center justify-center p-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            Uploading files...
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500 space-y-1">
        <div><strong>Supported file types:</strong></div>
        <div>• LaTeX: .tex, .bib, .sty, .cls</div>
        <div>• Images: .png, .jpg, .jpeg, .gif, .pdf, .eps, .svg</div>
        <div>• Other: Any file type for project assets</div>
      </div>
    </div>
  );
}
