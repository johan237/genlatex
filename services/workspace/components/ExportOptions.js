// SPDX-License-Identifier: MIT

'use client';

import { useState } from 'react';

export default function ExportOptions({ projectId, compileTarget, onClose, pdfExists }) {
  const [exporting, setExporting] = useState(false);
  const hasTarget = !!compileTarget && typeof compileTarget === 'string';

  const downloadPDF = () => {
    if (!hasTarget) return;
    if (!pdfExists) {
      alert('Fix compile errors before downloading the final PDF.');
      return;
    }
    const pdfName = compileTarget.replace(/\.tex$/i, '.pdf');
    window.open(`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(pdfName)}`, '_blank');
  };

  const downloadProject = () => {
    window.open(`/api/files/${projectId}/download?type=project`, '_blank');
  };

  const downloadSource = () => {
    if (!hasTarget) return;
    window.open(`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(compileTarget)}`, '_blank');
  };

  const copyToClipboard = async () => {
    if (!hasTarget) return;
    try {
      const response = await fetch(`/api/files/${projectId}?file=${encodeURIComponent(compileTarget)}`);
      const data = await response.json();
      await navigator.clipboard.writeText(data.content);
      alert('Source code copied to clipboard!');
    } catch (error) {
      console.error('Failed to copy:', error);
      alert('Failed to copy to clipboard');
    }
  };

  return (
    <div className="absolute top-full right-0 mt-1 bg-white border rounded shadow-lg z-20 min-w-[200px]">
      <div className="p-2 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Export Options</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>
      </div>
      
      <div className="p-2 space-y-1">
        <button
          onClick={downloadPDF}
          disabled={!hasTarget || !pdfExists}
          className={`w-full px-3 py-2 text-left text-sm rounded flex items-center gap-2 ${
            hasTarget && pdfExists ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed text-gray-400'
          }`}
          title={!hasTarget ? 'Open a .tex file to compile' : !pdfExists ? 'Fix compile errors before viewing the final PDF' : 'Download compiled PDF'}
        >
          📄 Download PDF {!pdfExists && hasTarget && '(Fix errors first)'}
        </button>
        
        <button
          onClick={downloadSource}
          disabled={!hasTarget}
          className={`w-full px-3 py-2 text-left text-sm rounded flex items-center gap-2 ${hasTarget ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed text-gray-400'}`}
        >
          📝 Download Source
        </button>
        
        <button
          onClick={copyToClipboard}
          disabled={!hasTarget}
          className={`w-full px-3 py-2 text-left text-sm rounded flex items-center gap-2 ${hasTarget ? 'hover:bg-gray-100' : 'opacity-50 cursor-not-allowed text-gray-400'}`}
        >
          📋 Copy Source
        </button>
        
        <div className="border-t my-1"></div>
        
        <button
          onClick={downloadProject}
          className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 rounded flex items-center gap-2"
        >
          📦 Download Project (.zip)
        </button>
      </div>
    </div>
  );
}
