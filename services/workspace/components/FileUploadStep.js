/**
 * File Upload Step Component
 * Feature 4: Allow users to upload reference files (PDFs, images, CSVs)
 */

import React, { useState, useCallback } from 'react';
import { Upload, FileText, Image, FileSpreadsheet, X, AlertCircle } from 'lucide-react';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB per file
const MAX_TOTAL_SIZE = 1 * 1024 * 1024 * 1024; // 1GB total (free tier)
const MAX_FILES = 50; // Free tier limit
const ALLOWED_TYPES = {
  // Documents
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/x-tex': '.tex',

  // Data files
  'text/csv': '.csv',
  'application/vnd.ms-excel': '.csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/json': '.json',
  'text/xml': '.xml',
  'application/xml': '.xml',
  'text/yaml': '.yaml',
  'text/x-yaml': '.yml',

  // Code files
  'text/x-python': '.py',
  'application/x-python-code': '.py',
  'text/javascript': '.js',
  'application/javascript': '.jsx',
  'text/typescript': '.ts',
  'application/typescript': '.tsx',
  'text/x-java': '.java',
  'text/x-c': '.c',
  'text/x-c++': '.cpp',
  'text/x-go': '.go',
  'text/x-rust': '.rs',

  // Notebooks
  'application/x-ipynb+json': '.ipynb',

  // Bibliography
  'application/x-bibtex': '.bib',
  'text/x-bibtex': '.bibtex',

  // Images
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',

  // Archives
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip'
};

const getFileIcon = (type) => {
  if (type.startsWith('image/')) return <Image className="w-5 h-5 text-blue-600" />;
  if (type === 'application/pdf') return <FileText className="w-5 h-5 text-red-600" />;
  if (type.includes('csv') || type.includes('sheet') || type.includes('json') || type.includes('xml') || type.includes('yaml'))
    return <FileSpreadsheet className="w-5 h-5 text-green-600" />;
  return <FileText className="w-5 h-5 text-gray-600" />;
};

export default function FileUploadStep({ value = [], onChange }) {
  const [files, setFiles] = useState(value || []);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  const validateFile = (file) => {
    // Check file type
    if (!ALLOWED_TYPES[file.type]) {
      return `Invalid file type: ${file.type}. Allowed: PDF, images (PNG, JPG), CSV, XLSX`;
    }

    // Check individual file size
    if (file.size > MAX_FILE_SIZE) {
      return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 50MB`;
    }

    // Check total number of files
    if (files.length >= MAX_FILES) {
      return `Maximum ${MAX_FILES} files allowed`;
    }

    // Check total size
    if (totalSize + file.size > MAX_TOTAL_SIZE) {
      const remainingMB = ((MAX_TOTAL_SIZE - totalSize) / 1024 / 1024).toFixed(1);
      return `Total size limit exceeded. You can only upload ${remainingMB}MB more.`;
    }

    return null;
  };

  const handleFiles = useCallback(async (newFiles) => {
    setUploading(true);
    setError(null);

    const validFiles = [];
    const errors = [];

    for (const file of Array.from(newFiles)) {
      const validationError = validateFile(file);
      if (validationError) {
        errors.push(`${file.name}: ${validationError}`);
        continue;
      }

      // Create file metadata
      const fileData = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        file: file, // Store the actual File object for later upload
        uploadedAt: new Date().toISOString()
      };

      validFiles.push(fileData);
    }

    if (errors.length > 0) {
      setError(errors.join('\n'));
    }

    if (validFiles.length > 0) {
      const updatedFiles = [...files, ...validFiles];
      setFiles(updatedFiles);
      onChange(updatedFiles);
    }

    setUploading(false);
  }, [files, onChange, totalSize]);

  const handleFileInput = (e) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      handleFiles(selectedFiles);
    }
    // Reset input
    e.target.value = '';
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (fileId) => {
    const updatedFiles = files.filter(f => f.id !== fileId);
    setFiles(updatedFiles);
    onChange(updatedFiles);
    setError(null);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-2">
          Upload Supporting Files (Optional)
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Upload source files (PDFs, code, data, notebooks, images, etc.) that the AI can use while generating your document.
          Files are processed for context so the output reflects your provided material.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded whitespace-pre-wrap">
          {error}
        </div>
      )}

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition ${
          dragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-blue-400'
        } ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          multiple
          accept={Object.values(ALLOWED_TYPES).join(',')}
          onChange={handleFileInput}
          className="hidden"
          id="file-upload"
          disabled={uploading || files.length >= MAX_FILES}
        />
        <label htmlFor="file-upload" className="cursor-pointer block">
          <Upload className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-sm text-gray-600 mb-1">
            {uploading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing files...
              </span>
            ) : (
              'Drop files here or click to upload'
            )}
          </p>
          <p className="text-xs text-gray-400">
            PDF, code, data, notebooks, images, ZIP (Max 100MB/file, 1GB total, {MAX_FILES} files max)
          </p>
        </label>
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">
              {files.length} file{files.length !== 1 ? 's' : ''} uploaded
            </span>
            <span className={`${totalSize > MAX_TOTAL_SIZE * 0.8 ? 'text-orange-600 font-medium' : 'text-gray-500'}`}>
              {formatFileSize(totalSize)} / {formatFileSize(MAX_TOTAL_SIZE)}
            </span>
          </div>

          <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
            {files.map((file) => (
              <div key={file.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(file.id)}
                  className="text-red-600 hover:text-red-800 transition ml-2"
                  title="Remove file"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usage Info */}
      <div className="bg-blue-50 border border-blue-200 p-4 rounded-md">
        <div className="flex items-start space-x-2">
          <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-2">How AI uses your files:</p>
            <ul className="space-y-1 ml-4 list-disc">
              <li><strong>Discovery:</strong> AI lists and searches files by keywords/metadata</li>
              <li><strong>Selective Reading:</strong> AI chooses which files to read based on relevance</li>
              <li><strong>Content Search:</strong> AI searches within files for specific information</li>
              <li><strong>Deferred Processing:</strong> Files processed before first generation (5-10s per file)</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Examples */}
      <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
        <p className="text-sm font-medium mb-2 text-gray-700">Supported file types:</p>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• <strong>Documents:</strong> PDF (with OCR), TXT, Markdown, LaTeX</li>
          <li>• <strong>Data:</strong> CSV, Excel, JSON, XML, YAML</li>
          <li>• <strong>Code:</strong> Python, JavaScript, TypeScript, Java, C/C++, Go, Rust</li>
          <li>• <strong>Notebooks:</strong> Jupyter (.ipynb)</li>
          <li>• <strong>Bibliography:</strong> BibTeX (.bib, .bibtex)</li>
          <li>• <strong>Archives:</strong> ZIP (auto-extracted recursively)</li>
        </ul>
      </div>
    </div>
  );
}
