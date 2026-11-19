'use client';

import { useState, useEffect } from 'react';
import {
  getPhaseDisplayName,
  getPhaseDescription,
  downloadPaperFile,
  downloadAllFiles
} from '@/lib/paper-generation-api.js';

function normalizeProgressMessage(phase, rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return '';

  const normalizedPhase = String(phase || '').toLowerCase();
  if (normalizedPhase === 'research') {
    return 'Preparing context from your prompt and uploaded files.';
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('finding and analyzing sources') ||
    lower.includes('comprehensive initial search') ||
    lower.includes('research phase') ||
    lower.includes('pre-selected references')
  ) {
    return 'Preparing context from your prompt and uploaded files.';
  }

  return message;
}

export default function PaperGenerationProgress({
  paperId,
  status,
  phase,
  progress,
  message, // NEW: Detailed status message
  paperData,
  error,
  createdProject,
  recoveredFromError, // true when we recovered from a frontend error (toast shown by parent)
  isGenerating,
  onReset
}) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const liveMessage = normalizeProgressMessage(phase, message);
  const phases = ['plan', 'research', 'writing', 'verification', 'complete'];
  const currentPhaseIndex = phases.indexOf(phase);

  // Timer for elapsed time
  useEffect(() => {
    if (isGenerating && status !== 'completed' && status !== 'failed') {
      const startTime = Date.now();
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isGenerating, status]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Phase-specific icons, colors, and styles
  const phaseInfo = {
    'plan': {
      icon: '📋',
      agent: 'Planner Agent',
      description: 'Analyzing requirements and creating document structure',
      bgClass: 'bg-blue-50',
      borderClass: 'border-blue-200',
      textClass: 'text-blue-900',
      descClass: 'text-blue-700',
      messageClass: 'text-blue-800',
      dotClass: 'text-blue-600'
    },
    'research': {
      icon: '🔍',
      agent: 'Context Agent',
      description: 'Preparing context from provided files and instructions',
      bgClass: 'bg-purple-50',
      borderClass: 'border-purple-200',
      textClass: 'text-purple-900',
      descClass: 'text-purple-700',
      messageClass: 'text-purple-800',
      dotClass: 'text-purple-600'
    },
    'writing': {
      icon: '✍️',
      agent: 'Writer Agent',
      description: 'Generating comprehensive content for all sections',
      bgClass: 'bg-green-50',
      borderClass: 'border-green-200',
      textClass: 'text-green-900',
      descClass: 'text-green-700',
      messageClass: 'text-green-800',
      dotClass: 'text-green-600'
    },
    'verification': {
      icon: '✅',
      agent: 'LaTeX Generator',
      description: 'Formatting document and generating output files',
      bgClass: 'bg-orange-50',
      borderClass: 'border-orange-200',
      textClass: 'text-orange-900',
      descClass: 'text-orange-700',
      messageClass: 'text-orange-800',
      dotClass: 'text-orange-600'
    },
    'complete': {
      icon: '🎉',
      agent: 'System',
      description: 'Document generation complete!',
      bgClass: 'bg-emerald-50',
      borderClass: 'border-emerald-200',
      textClass: 'text-emerald-900',
      descClass: 'text-emerald-700',
      messageClass: 'text-emerald-800',
      dotClass: 'text-emerald-600'
    }
  };

  const handleDownload = (fileType) => {
    downloadPaperFile(paperId, fileType);
  };

  const handleDownloadAll = () => {
    downloadAllFiles(paperId);
  };

  const handleOpenProject = () => {
    if (createdProject) {
      window.location.href = `/editor/${createdProject.id}`;
    }
  };

  // Show initialization loading state when we have a paperId but no status yet
  if (paperId && !status) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
            <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Initializing Document Generation</h3>
          <p className="text-gray-600">
            Connecting to generation service...
          </p>
        </div>
      </div>
    );
  }

  // Show project creation loading state when paper is completed but no project yet
  // This happens when the paper generation is done but we're still creating the project
  if (status === 'completed' && !createdProject && isGenerating) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
            <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Creating Your Project</h3>
          <p className="text-gray-600">
            Downloading generated files and setting up your project...
          </p>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100 mb-4">
            <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Generation Failed</h3>
          <p className="text-gray-600 mb-4">
            {error || 'An error occurred while generating your document. Please try again.'}
          </p>
          <button
            onClick={onReset}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md font-medium transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="text-center mb-6">
          <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
            <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">Document Generated Successfully!</h3>
          <p className="text-gray-600">
            {createdProject 
              ? "Your document has been generated and added to a new project. You can now edit it directly or download the files."
              : "Your document has been generated and is ready for download."
            }
          </p>
        </div>

        {/* Download Options */}
        <div className="space-y-4">
          <h4 className="text-md font-medium text-gray-800">Download Options</h4>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button
              onClick={() => handleDownload('latex')}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              LaTeX (.tex)
            </button>
            
            <button
              onClick={() => handleDownload('pdf')}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 mr-2 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              PDF
            </button>
            
            <button
              onClick={() => handleDownload('docx')}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 mr-2 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Word (.docx)
            </button>
            
            <button
              onClick={() => handleDownload('html')}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 mr-2 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              HTML
            </button>
            
            <button
              onClick={() => handleDownload('txt')}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Text (.txt)
            </button>
            
            <button
              onClick={handleDownloadAll}
              className="flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors col-span-2 md:col-span-1"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download All (ZIP)
            </button>
          </div>
        </div>

        {/* Document Information */}
        {paperData && (
          <div className="mt-6 p-4 bg-gray-50 rounded-md">
            <h4 className="text-md font-medium text-gray-800 mb-2">Document Information</h4>
            <div className="text-sm text-gray-600 space-y-1">
              <p><strong>Generation ID:</strong> {paperId}</p>
              <p><strong>Generated:</strong> {new Date().toLocaleString()}</p>
              {paperData.title && <p><strong>Title:</strong> {paperData.title}</p>}
              {paperData.word_count && <p><strong>Word Count:</strong> {paperData.word_count.toLocaleString()}</p>}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-center space-x-4">
          {createdProject && (
            <button
              onClick={handleOpenProject}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium transition-colors"
            >
              Open Project in Editor
            </button>
          )}
          <button
            onClick={onReset}
            className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
          >
            Generate Another Document
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="text-center mb-6">
        <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 mb-4">
          <svg className="animate-spin h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">Generating Your Document</h3>
        <p className="text-gray-600">
          {phase ? getPhaseDescription(phase) : 'Initializing Document Generation...'}
        </p>
      </div>

      {/* Progress Bar with Timer */}
      <div className="mb-6">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <div className="flex items-center space-x-3">
            <span className="font-medium">{phase ? getPhaseDisplayName(phase) : 'Starting'}</span>
            {isGenerating && status !== 'completed' && (
              <span className="text-xs bg-gray-100 px-2 py-1 rounded-full flex items-center space-x-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{formatTime(elapsedTime)}</span>
              </span>
            )}
          </div>
          <span className="font-medium text-blue-600">{progress}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="bg-gradient-to-r from-blue-500 to-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out shadow-sm"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* Current Agent Activity Box - ENHANCED */}
      {phase && phaseInfo[phase] && (
        <div className={`mb-6 p-4 rounded-lg ${phaseInfo[phase].bgClass} border ${phaseInfo[phase].borderClass}`}>
          <div className="flex items-start space-x-3">
            <div className="text-2xl flex-shrink-0">{phaseInfo[phase].icon}</div>
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <p className={`text-sm font-bold ${phaseInfo[phase].textClass}`}>
                  {phaseInfo[phase].agent}
                </p>
                <svg className={`animate-pulse w-3 h-3 ${phaseInfo[phase].dotClass}`} fill="currentColor" viewBox="0 0 8 8">
                  <circle cx="4" cy="4" r="3" />
                </svg>
              </div>
              <p className={`text-xs mb-2 ${phaseInfo[phase].descClass}`}>
                {phaseInfo[phase].description}
              </p>
              {liveMessage && (
                <div className={`mt-2 p-2 bg-white bg-opacity-60 rounded text-xs ${phaseInfo[phase].messageClass}`}>
                  <span className="font-medium">Live Update:</span> {liveMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Phase Progress */}
      <div className="space-y-4">
        <h4 className="text-md font-medium text-gray-800">Generation Phases</h4>
        
        <div className="space-y-3">
          {phases.map((phaseName, index) => {
            const isCompleted = index < currentPhaseIndex;
            const isCurrent = index === currentPhaseIndex;
            const isUpcoming = index > currentPhaseIndex;

            return (
              <div key={phaseName} className="flex items-center space-x-3">
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
                  isCompleted 
                    ? 'bg-green-500 text-white' 
                    : isCurrent 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-gray-200 text-gray-500'
                }`}>
                  {isCompleted ? (
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                
                <div className="flex-1">
                  <div className={`text-sm font-medium ${
                    isCompleted 
                      ? 'text-green-700' 
                      : isCurrent 
                      ? 'text-blue-700' 
                      : 'text-gray-500'
                  }`}>
                    {getPhaseDisplayName(phaseName)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {getPhaseDescription(phaseName)}
                  </div>
                </div>
                
                {isCurrent && (
                  <div className="flex-shrink-0">
                    <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Generation ID */}
      <div className="mt-6 p-3 bg-gray-50 rounded-md">
        <div className="text-sm text-gray-600">
          <strong>Generation ID:</strong> {paperId}
        </div>
      </div>
    </div>
  );
}
