// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MonacoEditor from '@monaco-editor/react';
import PDFViewer from '@/components/PDFViewer';
import FileTree from '@/components/FileTree';
import ErrorLogPanel from '@/components/ErrorLogPanel';
import EditorToolbar from '@/components/EditorToolbar';
import ThemeToggle from '@/components/ThemeToggle';
import { debounce } from 'lodash';

export default function EditorPage({ params }) {
  const { projectId } = params;
  const router = useRouter();

  // Editor state
  const [code, setCode] = useState('');
  const [currentFile, setCurrentFile] = useState(null);
  const [fileViewMode, setFileViewMode] = useState('editor');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [compileTarget, setCompileTarget] = useState(null);
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(true);
  
  // Compilation state
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilationSuccess, setCompilationSuccess] = useState(false);
  const [pdfExists, setPdfExists] = useState(false);
  const [pdfBust, setPdfBust] = useState(0);
  const [log, setLog] = useState('');
  
  // Error tracking
  const [compilationErrors, setCompilationErrors] = useState([]);
  const [allErrors, setAllErrors] = useState([]);
  const errorDecorationsRef = useRef([]);
  const warningDecorationsRef = useRef([]);

  // Refs
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const autoSaveTimeoutRef = useRef(null);

  // Toggle dark/light mode
  const toggleDarkMode = useCallback(() => {
    setIsDarkMode(prev => !prev);
  }, []);

  // Highlight error and warning lines in Monaco editor using diagnostics
  const highlightErrorLines = useCallback((errors) => {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Check if editor has a model
    if (!editor.getModel()) {
      return;
    }

    // Clear previous decorations
    if (errorDecorationsRef.current.length > 0) {
      errorDecorationsRef.current = editor.deltaDecorations(errorDecorationsRef.current, []);
    }
    if (warningDecorationsRef.current.length > 0) {
      warningDecorationsRef.current = editor.deltaDecorations(warningDecorationsRef.current, []);
    }

    // Create Monaco diagnostic markers
    const markers = [];
    const errorDecorations = [];
    const warningDecorations = [];

    // Filter errors and warnings
    const actualErrors = errors.filter(e => e.type === 'error' || e.severity === 'error');
    const warnings = errors.filter(e => e.type === 'warning' || e.severity === 'warning');

    // Process errors
    actualErrors.forEach((error) => {
      if (error.line && error.line > 0) {
        const lineContent = editor.getModel().getLineContent(error.line);
        
        // Create Monaco diagnostic marker
        const marker = {
          startLineNumber: error.line,
          endLineNumber: error.line,
          startColumn: 1,
          endColumn: lineContent.length + 1,
          message: error.message,
          severity: monaco.MarkerSeverity.Error,
          source: error.engine || 'pdflatex'
        };

        // If we have specific problematic text, try to highlight it
        if (error.text && lineContent.includes(error.text)) {
          const textStart = lineContent.indexOf(error.text);
          const textEnd = textStart + error.text.length;
          marker.startColumn = textStart + 1;
          marker.endColumn = textEnd + 1;
        }

        markers.push(marker);

        // Create decoration for visual highlighting
        const decoration = {
          range: new monaco.Range(error.line, marker.startColumn, error.line, marker.endColumn),
          options: {
            isWholeLine: marker.startColumn === 1 && marker.endColumn === lineContent.length + 1,
            className: 'error-line-highlight',
            glyphMarginClassName: 'error-line-glyph',
            minimap: { color: '#ff0000', position: monaco.editor.MinimapPosition.Inline },
            overviewRuler: { color: '#ff0000', position: monaco.editor.OverviewRulerLane.Full },
            hoverMessage: { value: error.message }
          }
        };
        errorDecorations.push(decoration);
      }
    });

    // Process warnings
    warnings.forEach((warning) => {
      if (warning.line && warning.line > 0) {
        const lineContent = editor.getModel().getLineContent(warning.line);
        
        // Create Monaco diagnostic marker
        const marker = {
          startLineNumber: warning.line,
          endLineNumber: warning.line,
          startColumn: 1,
          endColumn: lineContent.length + 1,
          message: warning.message,
          severity: monaco.MarkerSeverity.Warning,
          source: warning.engine || 'pdflatex'
        };

        markers.push(marker);

        // Create decoration for visual highlighting
        const decoration = {
          range: new monaco.Range(warning.line, 1, warning.line, lineContent.length + 1),
          options: {
            isWholeLine: true,
            className: 'warning-line-highlight',
            glyphMarginClassName: 'warning-line-glyph',
            minimap: { color: '#ffc107', position: monaco.editor.MinimapPosition.Inline },
            overviewRuler: { color: '#ffc107', position: monaco.editor.OverviewRulerLane.Full },
            hoverMessage: { value: warning.message }
          }
        };
        warningDecorations.push(decoration);
      }
    });

    // Apply Monaco diagnostic markers
    monaco.editor.setModelMarkers(editor.getModel(), 'latex-errors', markers);

    // Apply decorations
    errorDecorationsRef.current = editor.deltaDecorations([], errorDecorations);
    warningDecorationsRef.current = editor.deltaDecorations([], warningDecorations);
  }, []);

  // Helper function to check if current file is LaTeX
  const isCurrentFileLaTeX = useCallback(() => {
    return currentFile && currentFile.endsWith('.tex');
  }, [currentFile]);

  // Function to auto-compile LaTeX files (always compile, don't check PDF existence)
  const autoCompileLaTeX = useCallback(async (targetFile = compileTarget) => {
    if (!isCurrentFileLaTeX() || !autoCompileEnabled) return;
    
    console.log(`📄 Auto-compiling LaTeX file: ${targetFile}`);
    await compile();
  }, [projectId, compileTarget, isCurrentFileLaTeX, autoCompileEnabled]);

  // Function to handle new LaTeX file creation
  const handleNewLaTeXFile = useCallback(async (filePath) => {
    if (!filePath.endsWith('.tex')) return;
    
    console.log(`📄 New LaTeX file created: ${filePath}, auto-compiling...`);
    setCompileTarget(filePath);
    setCurrentFile(filePath);
    setFileViewMode('editor');
    
    // Load the file content
    await loadFile(filePath);
    
    // Auto-compile after a short delay
    setTimeout(() => {
      compile();
    }, 1000);
  }, []);

  // Function to handle file renaming
  const handleFileRename = useCallback(async (oldPath, newPath) => {
    if (!oldPath.endsWith('.tex') || !newPath.endsWith('.tex')) return;
    
    // If the renamed file is the current compile target, update it
    if (compileTarget === oldPath) {
      console.log(`📄 LaTeX file renamed: ${oldPath} -> ${newPath}, updating compile target...`);
      setCompileTarget(newPath);
      
      // If it's also the current file, update that too
      if (currentFile === oldPath) {
        setCurrentFile(newPath);
      }
    }
  }, [compileTarget, currentFile]);

  // Load file content
  const loadFile = useCallback(async (filePath) => {
    try {
      const response = await fetch(`/api/files/${projectId}/${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const content = await response.text();
        setCode(content);
        setCurrentFile(filePath);
        
        // Auto-compile if it's a LaTeX file
        if (filePath.endsWith('.tex')) {
          setCompileTarget(filePath);
          setTimeout(() => autoCompileLaTeX(filePath), 500);
        }
      }
    } catch (error) {
      console.error('Error loading file:', error);
    }
  }, [projectId, autoCompileLaTeX]);

  // Compile LaTeX
  const compile = useCallback(async () => {
    if (!compileTarget) return;

    setIsCompiling(true);
    try {
      const res = await fetch(`/api/compile/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: compileTarget })
      });
      const data = await res.json();

      setLog(data.log || '');

      // Store compilation errors
      const tecErrors = data.errors || [];
      setCompilationErrors(tecErrors);
      setAllErrors(tecErrors);

      // Highlight error lines in editor
      setTimeout(() => {
        highlightErrorLines(tecErrors);
      }, 100); // Small delay to ensure editor is ready

      if (data.ok) {
        setPdfBust((b) => b + 1);
        setCompilationSuccess(true);
        setPdfExists(true); // PDF was successfully created
      } else {
        setCompilationSuccess(false);
        setPdfExists(false);
      }
    } catch (error) {
      console.error('Compilation error:', error);
      setCompilationSuccess(false);
      setPdfExists(false);
    } finally {
      setIsCompiling(false);
    }
  }, [projectId, compileTarget, highlightErrorLines]);

  // Handle editor mount
  const handleEditorDidMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Set up auto-save and error removal on content change
    editor.onDidChangeModelContent(() => {
      // Auto-save
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        if (currentFile) {
          saveFile(currentFile, editor.getValue());
        }
      }, 1000);

      // Remove error highlights when user modifies problematic lines
      const model = editor.getModel();
      if (model) {
        const lineNumber = editor.getPosition().lineNumber;
        const lineContent = model.getLineContent(lineNumber);
        
        // Check if this line had errors and the content has changed
        const hasErrors = errorDecorationsRef.current.some(decorationId => {
          const decoration = editor.getModel().getDecorationRange(decorationId);
          return decoration && decoration.startLineNumber === lineNumber;
        });
        
        if (hasErrors) {
          // Re-highlight errors to update decorations
          setTimeout(() => {
            highlightErrorLines(allErrors);
          }, 100);
        }
      }
    });
  }, [currentFile, allErrors, highlightErrorLines]);

  // Save file
  const saveFile = useCallback(async (filePath, content) => {
    try {
      await fetch(`/api/files/${projectId}/${encodeURIComponent(filePath)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: content
      });
    } catch (error) {
      console.error('Error saving file:', error);
    }
  }, [projectId]);

  // Apply Monaco theme
  const applyMonacoTheme = useCallback(() => {
    if (!monacoRef.current) return;
    
    try {
      const monaco = monacoRef.current;
      
      // Define custom theme
      monaco.editor.defineTheme('genlatex-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#ffffff',
          'editor.foreground': '#000000',
          'editorLineNumber.foreground': '#666666',
          'editorLineNumber.activeForeground': '#000000',
          'editorGutter.background': '#f8f9fa',
          'editorBracketMatch.background': '#e1e4e8',
          'editorBracketMatch.border': '#d1d5da'
        }
      });

      monaco.editor.defineTheme('genlatex-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': '#1a1a1a',
          'editor.foreground': '#e6e6e6',
          'editorLineNumber.foreground': '#666666',
          'editorLineNumber.activeForeground': '#e6e6e6',
          'editorGutter.background': '#2d2d2d',
          'editorBracketMatch.background': '#404040',
          'editorBracketMatch.border': '#555555'
        }
      });

      // Apply theme
      const theme = isDarkMode ? 'genlatex-dark' : 'genlatex-light';
      monaco.editor.setTheme(theme);
      
    } catch (error) {
      console.error('❌ Error applying Monaco theme:', error);
    }
  }, [isDarkMode]);

  // Real-time error checking as user types (faster response)
  const checkErrors = useCallback(debounce((code) => {
    console.log('checkErrors called with code length:', code.length);
    if (!editorRef.current || (typeof window !== 'undefined' && !window.monaco)) {
      console.log('Editor or Monaco not ready for error checking');
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;

    // Basic LaTeX syntax checking
    const lines = code.split('\n');
    const markers = [];

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      
      // Check for common LaTeX errors
      if (line.includes('\\begsin{') && !line.includes('\\begin{')) {
        markers.push({
          startLineNumber: lineNumber,
          endLineNumber: lineNumber,
          startColumn: line.indexOf('\\begsin{') + 1,
          endColumn: line.indexOf('\\begsin{') + 8,
          message: 'Did you mean \\begin{?',
          severity: monaco.MarkerSeverity.Error,
          source: 'LaTeX Syntax Checker'
        });
      }
      
      if (line.includes('\\end{') && !line.includes('\\begin{')) {
        markers.push({
          startLineNumber: lineNumber,
          endLineNumber: lineNumber,
          startColumn: line.indexOf('\\end{') + 1,
          endColumn: line.indexOf('\\end{') + 5,
          message: '\\end{ without matching \\begin{',
          severity: monaco.MarkerSeverity.Warning,
          source: 'LaTeX Syntax Checker'
        });
      }
    });

    // Apply markers
    monaco.editor.setModelMarkers(editor.getModel(), 'latex-syntax', markers);
  }, 500), []);

  // Handle code change
  const handleCodeChange = useCallback((value) => {
    setCode(value);
    checkErrors(value);
  }, [checkErrors]);

  // Load project on mount
  useEffect(() => {
    if (!projectId) return;

    // Load the first .tex file as default
    fetch(`/api/files/${projectId}/tree`)
      .then(res => res.json())
      .then(data => {
        const texFiles = data.files?.filter(f => f.endsWith('.tex')) || [];
        if (texFiles.length > 0) {
          loadFile(texFiles[0]);
        }
      })
      .catch(error => {
        console.error('Error loading project:', error);
      });
  }, [projectId, loadFile]);

  // Apply theme when it changes
  useEffect(() => {
    applyMonacoTheme();
  }, [applyMonacoTheme]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
              Editor - {projectId}
            </h1>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleDarkMode} />
            <EditorToolbar
              onCompile={compile}
              isCompiling={isCompiling}
              compilationSuccess={compilationSuccess}
              autoCompileEnabled={autoCompileEnabled}
              onToggleAutoCompile={() => setAutoCompileEnabled(!autoCompileEnabled)}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-73px)]">
        {/* File Tree */}
        <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
          <FileTree
            projectId={projectId}
            onFileSelect={loadFile}
            currentFile={currentFile}
            onNewLaTeXFile={handleNewLaTeXFile}
            onFileRename={handleFileRename}
          />
        </div>

        {/* Editor and PDF Viewer */}
        <div className="flex-1 flex">
          {/* Editor */}
          <div className="flex-1 min-h-screen">
            <MonacoEditor
              height="100%"
              language="latex"
              value={code}
              onChange={handleCodeChange}
              onMount={handleEditorDidMount}
              theme={isDarkMode ? 'genlatex-dark' : 'genlatex-light'}
              options={{
                fontSize: 14,
                lineNumbers: 'on',
                minimap: { enabled: true },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                wordWrap: 'on',
                renderWhitespace: 'selection',
                glyphMargin: true,
                folding: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3
              }}
            />
          </div>

          {/* PDF Viewer */}
          <div className="w-1/2 min-h-screen border-l border-gray-200 dark:border-gray-700">
            <PDFViewer
              projectId={projectId}
              pdfBust={pdfBust}
              compilationError={compilationErrors.filter(e => e.type === 'error' || e.severity === 'error')}
              log={log}
            />
          </div>
        </div>

        {/* Error Log Panel */}
        <div className="w-80 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 overflow-y-auto">
          <ErrorLogPanel
            errors={allErrors}
            log={log}
            onGoToLine={(lineNumber) => {
              if (editorRef.current) {
                editorRef.current.revealLineInCenter(lineNumber);
                editorRef.current.setPosition({ lineNumber, column: 1 });
                editorRef.current.focus();
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
