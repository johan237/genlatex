/**
 * Research Files List Component
 * Displays uploaded research files with processing status
 */

import React, { useState, useEffect } from 'react';
import {
  FileText,
  Image,
  FileSpreadsheet,
  Code,
  BookOpen,
  CheckCircle,
  Clock,
  XCircle,
  Loader,
  Trash2,
  Eye,
  Search,
  PlayCircle
} from 'lucide-react';
import { useToast } from './Toast';

const getFileIcon = (fileType) => {
  const iconClass = "w-5 h-5";

  if (fileType === 'pdf') return <FileText className={`${iconClass} text-red-600`} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg'].includes(fileType)) return <Image className={`${iconClass} text-blue-600`} />;
  if (['csv', 'xlsx', 'json', 'xml', 'yaml'].includes(fileType)) return <FileSpreadsheet className={`${iconClass} text-green-600`} />;
  if (['py', 'js', 'ts', 'jsx', 'tsx', 'java', 'cpp', 'c', 'go', 'rs'].includes(fileType)) return <Code className={`${iconClass} text-purple-600`} />;
  if (['ipynb', 'bib', 'bibtex'].includes(fileType)) return <BookOpen className={`${iconClass} text-orange-600`} />;
  return <FileText className={`${iconClass} text-gray-600`} />;
};

const getStatusIcon = (status) => {
  switch (status) {
    case 'completed':
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    case 'pending':
      return <Clock className="w-5 h-5 text-yellow-600" />;
    case 'failed':
      return <XCircle className="w-5 h-5 text-red-600" />;
    case 'processing':
      return <Loader className="w-5 h-5 text-blue-600 animate-spin" />;
    default:
      return <Clock className="w-5 h-5 text-gray-600" />;
  }
};

const getStatusLabel = (status) => {
  switch (status) {
    case 'completed':
      return 'Processed';
    case 'pending':
      return 'Pending';
    case 'failed':
      return 'Failed';
    case 'processing':
      return 'Processing...';
    default:
      return 'Unknown';
  }
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export default function ResearchFilesList({ projectId, refreshTrigger = 0 }) {
  const { toast } = useToast();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [projectId, refreshTrigger]);

  const fetchFiles = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/files/${projectId}/research`);

      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      } else {
        throw new Error('Failed to fetch research files');
      }
    } catch (err) {
      console.error('Error fetching research files:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (fileId) => {
    if (!confirm('Are you sure you want to delete this file?')) return;

    try {
      const response = await fetch(`/api/files/${projectId}/research/${fileId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setFiles(files.filter(f => f.fileId !== fileId));
        toast.success('File deleted successfully');
      } else {
        throw new Error('Failed to delete file');
      }
    } catch (err) {
      console.error('Error deleting file:', err);
      toast.error('Failed to delete file: ' + err.message);
    }
  };

  const handleViewMetadata = (file) => {
    setSelectedFile(file);
  };

  const handleProcessFiles = async (includeFailed = false) => {
    if (processing) return;

    try {
      setProcessing(true);
      setError(null);

      const response = await fetch(`/api/files/${projectId}/research/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ includeFailed })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Refresh files list
        await fetchFiles();
        
        // Show success message
        toast.success(`Successfully processed ${data.processed} file(s)${data.failed > 0 ? `, ${data.failed} failed` : ''}`);
      } else {
        throw new Error(data.error || data.details || 'Failed to process files');
      }
    } catch (err) {
      console.error('Error processing files:', err);
      setError(err.message);
      toast.error('Failed to process files: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader className="w-6 h-6 animate-spin text-blue-600" />
        <span className="ml-2 text-gray-600">Loading research files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded">
        <p>Error loading files: {error}</p>
        <button
          onClick={fetchFiles}
          className="mt-2 text-sm underline hover:no-underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="text-center p-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-3 text-gray-400" />
        <p>No research files uploaded yet</p>
        <p className="text-sm mt-1">Upload files during project creation or add them later</p>
      </div>
    );
  }

  const statusCounts = {
    completed: files.filter(f => f.processingStatus === 'completed').length,
    pending: files.filter(f => f.processingStatus === 'pending').length,
    failed: files.filter(f => f.processingStatus === 'failed').length
  };

  return (
    <div className="space-y-4">
      {/* Status Summary */}
      <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
        <div className="flex items-center space-x-4 text-sm">
          <span className="font-medium text-gray-700">{files.length} files</span>
          {statusCounts.completed > 0 && (
            <span className="flex items-center text-green-700">
              <CheckCircle className="w-4 h-4 mr-1" />
              {statusCounts.completed} processed
            </span>
          )}
          {statusCounts.pending > 0 && (
            <span className="flex items-center text-yellow-700">
              <Clock className="w-4 h-4 mr-1" />
              {statusCounts.pending} pending
            </span>
          )}
          {statusCounts.failed > 0 && (
            <span className="flex items-center text-red-700">
              <XCircle className="w-4 h-4 mr-1" />
              {statusCounts.failed} failed
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          {(statusCounts.pending > 0 || statusCounts.failed > 0) && (
            <button
              onClick={() => handleProcessFiles(statusCounts.failed > 0)}
              disabled={processing}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition"
              title={statusCounts.failed > 0 ? 'Process pending and failed files' : 'Process pending files'}
            >
              {processing ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <PlayCircle className="w-4 h-4" />
                  <span>Process Now</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={fetchFiles}
            disabled={processing}
            className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-400"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* File List */}
      <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
        {files.map((file) => (
          <div key={file.fileId} className="flex items-center justify-between p-4 hover:bg-gray-50 transition">
            <div className="flex items-center space-x-3 flex-1 min-w-0">
              {getFileIcon(file.fileType)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {file.originalName || file.fileName}
                  </p>
                  {getStatusIcon(file.processingStatus)}
                </div>
                <div className="flex items-center space-x-3 text-xs text-gray-500 mt-1">
                  <span>{formatFileSize(file.fileSize)}</span>
                  <span>•</span>
                  <span className={
                    file.processingStatus === 'completed' ? 'text-green-600' :
                    file.processingStatus === 'failed' ? 'text-red-600' :
                    'text-yellow-600'
                  }>
                    {getStatusLabel(file.processingStatus)}
                  </span>
                  {file.metadata?.keywords && file.metadata.keywords.length > 0 && (
                    <>
                      <span>•</span>
                      <span className="flex items-center">
                        <Search className="w-3 h-3 mr-1" />
                        {file.metadata.keywords.slice(0, 3).join(', ')}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center space-x-2 ml-2">
              {file.processingStatus === 'completed' && file.metadata && (
                <button
                  onClick={() => handleViewMetadata(file)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded transition"
                  title="View metadata"
                >
                  <Eye className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => handleDelete(file.fileId)}
                className="p-2 text-red-600 hover:bg-red-50 rounded transition"
                title="Delete file"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Metadata Modal */}
      {selectedFile && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedFile(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">
                {selectedFile.originalName || selectedFile.fileName}
              </h3>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>

            {selectedFile.metadata && (
              <div className="space-y-4">
                {selectedFile.metadata.about && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">About</h4>
                    <p className="text-sm text-gray-600">{selectedFile.metadata.about}</p>
                  </div>
                )}

                {selectedFile.metadata.summary && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Summary</h4>
                    <p className="text-sm text-gray-600">{selectedFile.metadata.summary}</p>
                  </div>
                )}

                {selectedFile.metadata.keyPoints && selectedFile.metadata.keyPoints.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-1">Key Points</h4>
                    <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                      {selectedFile.metadata.keyPoints.map((point, idx) => (
                        <li key={idx}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedFile.metadata.keywords && selectedFile.metadata.keywords.length > 0 && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Keywords</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedFile.metadata.keywords.map((keyword, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded"
                        >
                          {keyword}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
