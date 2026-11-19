// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';

export default function FileMentionAutocomplete({ 
  projectId, 
  query, 
  onSelect, 
  onClose 
}) {
  const [files, setFiles] = useState([]);
  const [filteredFiles, setFilteredFiles] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const { theme } = useTheme();
  const dropdownRef = useRef(null);

  // Fetch file tree
  useEffect(() => {
    const fetchFiles = async () => {
      if (!projectId) return;
      
      setLoading(true);
      try {
        const response = await fetch(`/api/files/${projectId}/tree`);
        if (response.ok) {
          const data = await response.json();
          const allFiles = extractFiles(data);
          setFiles(allFiles);
        }
      } catch (error) {
        console.error('Error fetching files:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [projectId]);

  // Filter files based on query
  useEffect(() => {
    if (!query) {
      setFilteredFiles(files.slice(0, 10)); // Show first 10 files
    } else {
      const filtered = files.filter(file => 
        file.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10);
      setFilteredFiles(filtered);
    }
    setSelectedIndex(0);
  }, [query, files]);

  // Extract file paths from tree structure
  const extractFiles = (tree) => {
    const files = [];
    
    const traverse = (node, path = '') => {
      if (node.type === 'file') {
        files.push(path + node.name);
      } else if (node.children) {
        node.children.forEach(child => {
          traverse(child, path + node.name + '/');
        });
      }
    };

    if (tree.children) {
      tree.children.forEach(child => traverse(child));
    }
    
    return files;
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!dropdownRef.current) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            Math.min(prev + 1, filteredFiles.length - 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredFiles[selectedIndex]) {
            onSelect(filteredFiles[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [filteredFiles, selectedIndex, onSelect, onClose]);

  const getFileIcon = (filePath) => {
    const extension = filePath.split('.').pop()?.toLowerCase();
    
    switch (extension) {
      case 'tex':
        return '📄';
      case 'pdf':
        return '📕';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'gif':
        return '🖼️';
      case 'csv':
        return '📊';
      case 'json':
        return '📋';
      default:
        return '📄';
    }
  };

  if (loading) {
    return (
      <div className={`
        bg-white border rounded-lg shadow-lg p-3
        ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
      `}>
        <div className="text-sm text-gray-500">Loading files...</div>
      </div>
    );
  }

  if (filteredFiles.length === 0) {
    return (
      <div className={`
        bg-white border rounded-lg shadow-lg p-3
        ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
      `}>
        <div className="text-sm text-gray-500">No files found</div>
      </div>
    );
  }

  return (
    <div 
      ref={dropdownRef}
      className={`
        bg-white border rounded-lg shadow-lg max-h-60 overflow-y-auto
        ${theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}
      `}
    >
      {filteredFiles.map((filePath, index) => (
        <button
          key={filePath}
          onClick={() => onSelect(filePath)}
          className={`
            w-full px-3 py-2 text-left text-sm hover:bg-gray-100
            ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}
            ${index === selectedIndex 
              ? theme === 'dark' 
                ? 'bg-gray-700 text-white' 
                : 'bg-gray-100 text-gray-900'
              : theme === 'dark' 
                ? 'text-gray-200' 
                : 'text-gray-700'
            }
            ${index === 0 ? 'rounded-t-lg' : ''}
            ${index === filteredFiles.length - 1 ? 'rounded-b-lg' : ''}
            focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20
          `}
        >
          <div className="flex items-center gap-2">
            <span className="text-base">{getFileIcon(filePath)}</span>
            <span className="truncate">{filePath}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
