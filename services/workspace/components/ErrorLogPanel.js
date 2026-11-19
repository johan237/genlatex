// SPDX-License-Identifier: MIT

'use client';

import { useState } from 'react';

export default function ErrorLogPanel({ 
  errors = [], 
  warnings = [], 
  log = '', 
  onErrorLineClick, 
  compilationSuccess, 
  isDarkMode = false,
  errorGroups = [] // Optional: grouped errors for display
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRawLog, setShowRawLog] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const copyLog = () => {
    navigator.clipboard.writeText(log);
  };

  const downloadLog = () => {
    const blob = new Blob([log], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'compilation-log.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  // Group errors by category for better display
  const groupedErrors = errors.reduce((acc, error) => {
    const category = error.category || 'general';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(error);
    return acc;
  }, {});

  const getCategoryColor = (category) => {
    const colors = {
      'syntax': 'red',
      'missing-package': 'orange',
      'citation': 'yellow',
      'environment': 'purple',
      'math-mode': 'pink',
      'brace': 'indigo',
      'file-not-found': 'amber',
      'bibliography': 'cyan',
      'font': 'teal',
      'system': 'gray',
      'general': 'red'
    };
    return colors[category] || 'red';
  };

  return (
    <div className={`border rounded ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
      <div 
        className={`flex items-center justify-between p-3 border-b cursor-pointer ${isDarkMode ? 'bg-gray-700 border-gray-600 hover:bg-gray-600' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-slate-700'}`}>Compiler Log</h3>
          {hasErrors && (
            <span className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-red-900 text-red-300' : 'bg-red-100 text-red-800'}`}>
              {errors.length} Error{errors.length !== 1 ? 's' : ''}
            </span>
          )}
          {hasWarnings && (
            <span className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-yellow-900 text-yellow-300' : 'bg-yellow-100 text-yellow-800'}`}>
              {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {log && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  copyLog();
                }}
                className={`px-2 py-1 text-xs border rounded ${isDarkMode ? 'bg-gray-600 border-gray-500 text-gray-300 hover:bg-gray-500' : 'bg-white border-gray-300 hover:bg-gray-100'}`}
                title="Copy Log"
              >
                Copy
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  downloadLog();
                }}
                className={`px-2 py-1 text-xs border rounded ${isDarkMode ? 'bg-gray-600 border-gray-500 text-gray-300 hover:bg-gray-500' : 'bg-white border-gray-300 hover:bg-gray-100'}`}
                title="Download Log"
              >
                Download
              </button>
            </>
          )}
          <svg 
            className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
      
      {isExpanded && (
        <div className="p-3">
          {!log && errors.length === 0 && warnings.length === 0 ? (
            <div className={`text-sm italic ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              Compiler log will appear here after you click "Compile".
            </div>
          ) : (
            <div className="space-y-4">
              {/* Separate .bib file errors */}
              {errors.filter(e => e.file && e.file.endsWith('.bib')).length > 0 && (
                <div className="mb-4">
                  <h4 className={`text-sm font-semibold mb-2 ${isDarkMode ? 'text-cyan-300' : 'text-cyan-700'}`}>
                    📚 Bibliography File Errors
                  </h4>
                  <div className="space-y-2">
                    {errors.filter(e => e.file && e.file.endsWith('.bib')).map((error, index) => (
                      <div key={`bib-${error.id || index}`} className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-cyan-600' : 'border-cyan-200'}`}>
                        <div className={`bg-cyan-600 text-white px-4 py-2`}>
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-sm">
                              <span className="capitalize">{error.category || 'error'}</span>
                              {error.file && (
                                <span className="ml-2 text-xs opacity-90">
                                  {error.file.split(/[/\\]/).pop()}
                                  {error.line && `:${error.line}`}
                                </span>
                              )}
                            </div>
                            {error.engine === 'bibtex-error-detector' && (
                              <span className="text-xs bg-cyan-800 px-2 py-1 rounded">.bib File</span>
                            )}
                          </div>
                        </div>
                        <div className={`px-4 py-2 ${isDarkMode ? 'bg-gray-800' : 'bg-white'}`}>
                          <div className={`text-sm ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
                            {error.message}
                          </div>
                          {error.text && (
                            <div className={`mt-2 text-xs font-mono ${isDarkMode ? 'bg-gray-900 text-red-300' : 'bg-gray-100 text-red-600'} px-2 py-1 rounded`}>
                              {error.text}
                            </div>
                          )}
                          {error.context && error.context.length > 0 && (
                            <details className="mt-2">
                              <summary className={`text-xs cursor-pointer ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                Show context
                              </summary>
                              <pre className={`mt-1 text-xs font-mono p-2 rounded ${isDarkMode ? 'bg-gray-900 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                                {error.context.join('\n')}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Grouped errors (if available) */}
              {errorGroups && errorGroups.length > 0 && errorGroups.map((group, groupIndex) => {
                const isGroupExpanded = expandedGroups.has(group.id);
                const primaryError = group.primary;
                const relatedErrors = group.related || [];
                
                return (
                  <div key={group.id || `group-${groupIndex}`} className="mb-4">
                    {/* Primary Error */}
                    <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-red-600' : 'border-red-200'}`}>
                      <div className="bg-red-600 text-white px-4 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {relatedErrors.length > 0 && (
                              <button
                                onClick={() => {
                                  const newExpanded = new Set(expandedGroups);
                                  if (isGroupExpanded) {
                                    newExpanded.delete(group.id);
                                  } else {
                                    newExpanded.add(group.id);
                                  }
                                  setExpandedGroups(newExpanded);
                                }}
                                className="text-xs bg-red-700 hover:bg-red-800 px-2 py-1 rounded"
                              >
                                {isGroupExpanded ? '−' : '+'} {relatedErrors.length} related
                              </button>
                            )}
                            <div className="font-medium text-sm">
                              <span className="capitalize">{primaryError.category || 'error'}</span>
                              {group.rootCause && group.rootCause !== primaryError.category && (
                                <span className="ml-2 text-xs opacity-75">(Root: {group.rootCause})</span>
                              )}
                              {primaryError.file && primaryError.line && (
                                <span className="ml-2 text-red-200">
                                  {primaryError.file}:{primaryError.line}
                                </span>
                              )}
                            </div>
                          </div>
                          {primaryError.line && onErrorLineClick && (
                            <button
                              onClick={() => onErrorLineClick(primaryError.line, primaryError.file)}
                              className="text-xs bg-red-700 hover:bg-red-800 px-2 py-1 rounded"
                            >
                              Go to Line
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Primary Error Content */}
                      <div className={`p-4 ${isDarkMode ? 'bg-red-900' : 'bg-red-50'}`}>
                        <div className={`text-sm mb-3 ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>
                          <div className="font-semibold mb-1">{primaryError.message}</div>
                          {group.fixAction && (
                            <div className={`mt-2 text-xs ${isDarkMode ? 'bg-red-800 text-yellow-300' : 'bg-yellow-100 text-yellow-800'} px-2 py-1 rounded inline-block`}>
                              💡 Fix: {group.fixAction}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Related Errors (collapsible) */}
                    {isGroupExpanded && relatedErrors.length > 0 && (
                      <div className="ml-4 mt-2 space-y-2">
                        {relatedErrors.map((relatedError, relIndex) => (
                          <div key={relatedError.id || `related-${relIndex}`} className={`border rounded ${isDarkMode ? 'border-red-700 bg-red-950' : 'border-red-300 bg-red-100'}`}>
                            <div className="px-3 py-2">
                              <div className={`text-xs ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
                                {relatedError.message}
                                {relatedError.file && relatedError.line && (
                                  <span className="ml-2 opacity-75">
                                    {relatedError.file}:{relatedError.line}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              
              {/* Ungrouped errors (fallback if no groups) */}
              {(!errorGroups || errorGroups.length === 0) && errors.filter(e => !e.file || !e.file.endsWith('.bib')).map((error, index) => (
                <div key={error.id || index}>
                  <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-red-600' : 'border-red-200'}`}>
                    {/* Error Header */}
                    <div className="bg-red-600 text-white px-4 py-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">
                          <span className="capitalize">{error.category || 'error'}</span>
                          {error.file && error.line && (
                            <span className="ml-2 text-red-200">
                              {error.file}:{error.line}
                            </span>
                          )}
                          {error.line && !error.file && (
                            <span className="ml-2 text-red-200">
                              Line {error.line}
                            </span>
                          )}
                        </div>
                        {error.line && onErrorLineClick && (
                          <button
                            onClick={() => onErrorLineClick(error.line, error.file)}
                            className="text-xs bg-red-700 hover:bg-red-800 px-2 py-1 rounded"
                          >
                            Go to Line
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* Error Description */}
                    <div className={`p-4 ${isDarkMode ? 'bg-red-900' : 'bg-red-50'}`}>
                      <div className={`text-sm mb-3 ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>
                        <div className="font-semibold mb-1">{error.message}</div>
                        {error.engine && error.engine !== 'pdflatex' && (
                          <div className="text-xs opacity-75">Engine: {error.engine}</div>
                        )}
                      </div>
                      
                      {/* Suggestions */}
                      {error.suggestions && error.suggestions.length > 0 && (
                        <div className="mt-3">
                          <div className={`text-xs font-semibold mb-2 ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
                            Suggestions:
                          </div>
                          <ul className={`text-xs list-disc list-inside space-y-1 ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                            {error.suggestions.map((suggestion, idx) => (
                              <li key={idx}>{suggestion}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {/* Context */}
                      {error.context && error.context.length > 0 && (
                        <details className="mt-3">
                          <summary className={`text-xs cursor-pointer ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-800'}`}>
                            Show context ({error.context.length} lines)
                          </summary>
                          <div className={`mt-2 p-3 border rounded text-xs font-mono ${isDarkMode ? 'bg-gray-800 border-red-600 text-gray-300' : 'bg-white border-red-200 text-gray-800'}`}>
                            <div className="whitespace-pre-wrap">{error.context.join('\n')}</div>
                          </div>
                        </details>
                      )}
                      
                      {/* Raw Message */}
                      {error.rawMessage && error.rawMessage !== error.message && (
                        <details className="mt-3">
                          <summary className={`text-xs cursor-pointer ${isDarkMode ? 'text-red-400 hover:text-red-300' : 'text-red-600 hover:text-red-800'}`}>
                            Show raw log message
                          </summary>
                          <div className={`mt-2 p-3 border rounded text-xs font-mono ${isDarkMode ? 'bg-gray-800 border-red-600 text-gray-300' : 'bg-white border-red-200 text-gray-800'}`}>
                            <div className="whitespace-pre-wrap">{error.rawMessage}</div>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                  
                  {/* Horizontal separator between errors */}
                  {index < errors.length - 1 && (
                    <div className="my-4 flex items-center">
                      <div className="flex-1 border-t border-gray-300"></div>
                      <div className="px-3 text-xs text-gray-500">Error {index + 2}</div>
                      <div className="flex-1 border-t border-gray-300"></div>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Warnings */}
              {warnings.map((warning, index) => (
                <div key={warning.id || index} className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-yellow-600' : 'border-yellow-200'}`}>
                  <div className="bg-yellow-600 text-white px-4 py-2">
                    <div className="font-medium text-sm">
                      Warning: {warning.category || 'general'}
                      {warning.file && warning.line && (
                        <span className="ml-2 text-yellow-200">
                          {warning.file}:{warning.line}
                        </span>
                      )}
                      {warning.line && !warning.file && (
                        <span className="ml-2 text-yellow-200">
                          Line {warning.line}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={`p-4 ${isDarkMode ? 'bg-yellow-900' : 'bg-yellow-50'}`}>
                    <div className={`text-sm ${isDarkMode ? 'text-yellow-300' : 'text-yellow-800'}`}>
                      {warning.message}
                    </div>
                    {warning.suggestions && warning.suggestions.length > 0 && (
                      <div className="mt-2">
                        <div className={`text-xs font-semibold mb-1 ${isDarkMode ? 'text-yellow-400' : 'text-yellow-700'}`}>
                          Suggestions:
                        </div>
                        <ul className={`text-xs list-disc list-inside space-y-1 ${isDarkMode ? 'text-yellow-300' : 'text-yellow-700'}`}>
                          {warning.suggestions.map((suggestion, idx) => (
                            <li key={idx}>{suggestion}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Raw Log Section (collapsible) */}
              {log && (
                <div className="mt-4">
                  <button
                    onClick={() => setShowRawLog(!showRawLog)}
                    className={`w-full text-left px-4 py-2 rounded ${isDarkMode ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}
                  >
                    <span className="text-sm font-medium">
                      {showRawLog ? '▼' : '▶'} Raw Compilation Log
                    </span>
                  </button>
                  {showRawLog && (
                    <div className={`mt-2 p-3 border rounded text-xs font-mono max-h-64 overflow-auto ${isDarkMode ? 'bg-gray-900 border-gray-600 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-800'}`}>
                      <div className="whitespace-pre-wrap">{log}</div>
                    </div>
                  )}
                </div>
              )}
              
              {/* No PDF Section */}
              {hasErrors && !compilationSuccess && (
                <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-red-600' : 'border-red-200'}`}>
                  <div className="bg-red-600 text-white px-4 py-2">
                    <div className="font-medium text-sm">No PDF</div>
                  </div>
                  <div className={`p-4 ${isDarkMode ? 'bg-red-900' : 'bg-red-50'}`}>
                    <div className={`text-sm mb-3 ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>
                      This compile didn't produce a PDF. This can happen if:
                    </div>
                    <ul className={`text-sm list-disc list-inside space-y-1 ${isDarkMode ? 'text-red-400' : 'text-red-700'}`}>
                      <li>There is an unrecoverable LaTeX error. If there are LaTeX errors shown above, please try to fix them and compile again.</li>
                      <li>The document environment contains no content. If it's empty, please add some content and compile again.</li>
                      <li>This project contains a file called output.pdf. If that file exists, please rename it and compile again.</li>
                    </ul>
                  </div>
                </div>
              )}
              
              {/* Success Message */}
              {compilationSuccess && !hasErrors && !hasWarnings && (
                <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-green-600' : 'border-green-200'}`}>
                  <div className="bg-green-600 text-white px-4 py-2">
                    <div className="font-medium text-sm">Compilation Successful</div>
                  </div>
                  <div className={`p-4 ${isDarkMode ? 'bg-green-900' : 'bg-green-50'}`}>
                    <div className={`text-sm ${isDarkMode ? 'text-green-300' : 'text-green-800'}`}>
                      Your LaTeX document compiled successfully. The PDF has been generated.
                    </div>
                  </div>
                </div>
              )}
              
              {/* Failure Message */}
              {!compilationSuccess && hasErrors && (
                <div className={`border rounded-lg overflow-hidden ${isDarkMode ? 'border-red-600' : 'border-red-200'}`}>
                  <div className="bg-red-600 text-white px-4 py-2">
                    <div className="font-medium text-sm">Compilation Failed</div>
                  </div>
                  <div className={`p-4 ${isDarkMode ? 'bg-red-900' : 'bg-red-50'}`}>
                    <div className={`text-sm ${isDarkMode ? 'text-red-300' : 'text-red-800'}`}>
                      LaTeX compilation failed. Check the errors above and fix them before compiling again.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
