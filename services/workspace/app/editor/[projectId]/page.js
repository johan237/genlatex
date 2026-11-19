// SPDX-License-Identifier: MIT

'use client';

import React, { Suspense, use, useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import PDFViewer from '../../../components/PDFViewer';
import EditorToolbar from '../../../components/EditorToolbar';
import ErrorLogPanel from '../../../components/ErrorLogPanel';
import FileTree from '../../../components/FileTree';
import DocumentStats from '../../../components/DocumentStats';
import ExportOptions from '../../../components/ExportOptions';
import FileViewer from '../../../components/FileViewer';
import TiptapEditor from '../../../components/TiptapEditor';
import CommandBar from '../../../components/CommandBar';
import AIGenerationLoading from '../../../components/AIGenerationLoading';
import ChatPopup from '../../../components/ChatPopup';
import LimitWarningModal from '../../../components/LimitWarningModal';
import SettingsModal from '../../../components/SettingsModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/Dialog';
import { useSearchParams, useRouter } from 'next/navigation';
import { getErrorLines } from '@/lib/error-parser';
import { parseProjectMetadata } from '@/lib/json-recovery.js';
import { checkSyntax } from '@/lib/syntax-checker';
import { getQuickFixes, needsAIFix } from '@/lib/quick-fixes';
import { generateCodeSummary, generateToolCallSummary } from '@/lib/chat-summary.js';
import Script from 'next/script';
import { getLanguageFromFile as getMonacoLanguage, isEditableFile } from '@/lib/hooks/useMonacoSync.js';
import { normalizeFilePath as normalizeFilePathUtil } from '@/lib/file-manager.js';
import { Button, TextField, Flex, Text, Box, RadioGroup, Switch, Select } from '@radix-ui/themes';
import { EyeOpenIcon, Pencil1Icon } from '@radix-ui/react-icons';
import { useToast, useConfirm } from '../../../components/Toast';
import { PageLoading } from '../../../components/LoadingSpinner';
import { SectionErrorBoundary } from '../../../components/ErrorBoundary';

// Configure Monaco workers for Next.js - prevent "Unexpected usage" from breaking the app
// Monaco worker errors don't affect LaTeX editing. We handle them via event listeners only
// (no console.error override - that conflicts with Next.js/Turbopack error overlay).
if (typeof window !== 'undefined') {
  // Handle unhandled promise rejections from Monaco workers
  window.addEventListener('unhandledrejection', function(event) {
    if (event.reason?.message === 'Unexpected usage') {
      event.preventDefault();
      return;
    }
  });

  // Handle window errors
  window.addEventListener('error', function(event) {
    if (event.message === 'Unexpected usage' || event.error?.message === 'Unexpected usage') {
      event.preventDefault();
      return;
    }
  });

  // Provide a stub worker that responds to Monaco's protocol
  window.MonacoEnvironment = {
    getWorker: function() {
      const workerCode = `
        self.onmessage = function(e) {
          // Respond to Monaco's initialization request
          if (e.data && e.data.type === 'init') {
            self.postMessage({ type: 'initialized' });
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      return new Worker(URL.createObjectURL(blob));
    }
  };
}

function EditorPageContent({ params }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.projectId;
  const { theme, setTheme } = useTheme();
  const isDarkMode = theme === 'dark';
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  // When redirected from project creation with ?aiGenerating=true, show loading immediately (avoids race with metadata write)
  const aiGeneratingParam = searchParams.get('aiGenerating') === 'true';
  const [showAILoading, setShowAILoading] = useState(aiGeneratingParam);
  const [aiStatusResolving, setAiStatusResolving] = useState(!aiGeneratingParam);
  const aiStatusCheckedRef = useRef(false); // Track if we've checked AI status
  
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const disposablesRef = useRef([]);
  const fileVersionsRef = useRef(new Map());
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [compiling, setCompiling] = useState(false);
  const [log, setLog] = useState('');
  const [pdfBust, setPdfBust] = useState(0);
  const [compilationSuccess, setCompilationSuccess] = useState(false);
  const [currentFile, setCurrentFile] = useState(null);
  const [pdfExists, setPdfExists] = useState(false);
  const [compilationMessage, setCompilationMessage] = useState('');
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(true);
  const [showFileTree, setShowFileTree] = useState(true);
  const [compileTarget, setCompileTarget] = useState(null);
  const [fileViewMode, setFileViewMode] = useState('editor'); // 'editor' or 'viewer'
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [showExportOptions, setShowExportOptions] = useState(false);
  const [chatMode, setChatMode] = useState('execute'); // 'execute' or 'chat'
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showZoomMenu, setShowZoomMenu] = useState(false);
  const [pdfZoom, setPdfZoom] = useState('fit');
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(1);
  const [fileTreeRefreshKey, setFileTreeRefreshKey] = useState(0);
  const [tabs] = useState([{ id: 'file-main', type: 'file' }]);
  const [activeTabId, setActiveTabId] = useState('file-main');
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatContextFiles, setChatContextFiles] = useState([]); // Files highlighted for chat context
  const [chatContextSelection, setChatContextSelection] = useState(null); // Pinned LaTeX selection: { filePath, name, startLine, endLine, startColumn?, endColumn?, text }
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [editorType, setEditorType] = useState('latex'); // 'latex' or 'tiptap'
  const [projectMetadata, setProjectMetadata] = useState(null);
  const autoSaveTimeoutRef = useRef(null);
  const autoCompileTimeoutRef = useRef(null); // Debounced auto-compile on edit
  const lastCompileTimeRef = useRef(0); // Track last compilation time to prevent too-frequent compilations
  const skipAutoSaveRef = useRef(false);
  const projectMenuRef = useRef(null);
  const addMenuRef = useRef(null);
  const zoomMenuRef = useRef(null);
  const zoomTriggerRef = useRef(null);
  const zoomDropdownRef = useRef(null);
  const [zoomMenuPosition, setZoomMenuPosition] = useState({ top: 0, left: 0 });
  const fileUploadInputRef = useRef(null);
  const directoryUploadInputRef = useRef(null);
  const loadFileRef = useRef(null);
  const loadingFileRef = useRef(null); // Track which file is currently being loaded
  const loadAbortControllerRef = useRef(null); // AbortController for canceling stale requests
  const pdfViewerRef = useRef(null); // Ref for PDF page navigation (goToPage)
  const compilationInProgressRef = useRef(false); // Track if compilation is in progress
  const hasCompiledOnLoadRef = useRef(false); // Track if we've already compiled on this page load
  const citationKeysRef = useRef([]); // Citation keys from .bib for \cite{} completion

  // Configuration constants
  const AUTO_COMPILE_DELAY_MS = 2000; // Debounce delay for auto-compile on edit (2 seconds after typing stops)
  const AUTO_SAVE_DELAY_MS = 1000; // Debounce delay for auto-save
  const MIN_COMPILE_INTERVAL_MS = 5000; // Minimum time between compilations (5 seconds)

  // Share dialog state
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [shareEmails, setShareEmails] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [sharePermission, setSharePermission] = useState('view'); // 'view' or 'edit'
  const [shareRecipients, setShareRecipients] = useState([]);
  const [documentOutline, setDocumentOutline] = useState([]);

  // Rename project dialog state
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  // Create file/folder dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createType, setCreateType] = useState('file'); // 'file' or 'folder'
  const [createName, setCreateName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Handle share project
  async function handleShareProject() {
    if (!shareEmails.trim()) {
      toast.warning('Please enter at least one email address');
      return;
    }

    const emails = shareEmails.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    if (emails.length === 0) {
      toast.warning('Please enter valid email addresses');
      return;
    }

    setShareLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
          projectId: projectId,
          permission: sharePermission
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success(`Project shared successfully with ${emails.length} user(s)! They will have ${sharePermission} access.`);
          setShowShareDialog(false);
          setShareEmails('');
          setSharePermission('view');
        } else {
          toast.error('Failed to share project: ' + (data.error || 'Unknown error'));
        }
      } else {
        const error = await res.json();
        toast.error('Failed to share project: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error sharing project:', error);
      toast.error('Failed to share project. Please try again.');
    } finally {
      setShareLoading(false);
    }
  }

  // Toggle dark/light mode
  const toggleDarkMode = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  // Extract sections from LaTeX content
  const extractDocumentSections = useCallback((latex) => {
    if (!latex) return [];
    
    const sections = [];
    const lines = latex.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match \section, \subsection, \subsubsection commands
      let match;
      if ((match = line.match(/\\section\*?\{([^}]+)\}/))) {
        sections.push({ level: 1, title: match[1], line: i + 1 });
      } else if ((match = line.match(/\\subsection\*?\{([^}]+)\}/))) {
        sections.push({ level: 2, title: match[1], line: i + 1 });
      } else if ((match = line.match(/\\subsubsection\*?\{([^}]+)\}/))) {
        sections.push({ level: 3, title: match[1], line: i + 1 });
      } else if (line.match(/\\begin\{abstract\}/)) {
        sections.push({ level: 0, title: 'Abstract', line: i + 1 });
      }
    }
    
    return sections;
  }, []);

  // Update document outline when content changes
  useEffect(() => {
    if (content && currentFile && currentFile.endsWith('.tex')) {
      const sections = extractDocumentSections(content);
      setDocumentOutline(sections);
    }
  }, [content, currentFile, extractDocumentSections]);

  // Error tracking
  const [compilationErrors, setCompilationErrors] = useState([]);
  const [errorGroups, setErrorGroups] = useState([]);
  const [compilationWarnings, setCompilationWarnings] = useState([]);
  const [allErrors, setAllErrors] = useState([]);

  // Helper to find section boundaries more accurately
  const findSectionBoundaries = useCallback((lines, startLineIndex) => {
    let endLineIndex = lines.length;
    
    // Look for next section, subsection, or document end
    for (let j = startLineIndex + 1; j < lines.length; j++) {
      const nextLine = lines[j].trim();
      if (nextLine.startsWith('\\section{') || 
          nextLine.startsWith('\\section*{') ||
          nextLine.startsWith('\\subsection{') || 
          nextLine.startsWith('\\subsection*{') ||
          nextLine === '\\end{document}' ||
          nextLine.startsWith('\\bibliography{') ||
          nextLine === '\\newpage' ||
          nextLine.startsWith('\\appendix')) {
        endLineIndex = j;
        break;
      }
    }
    
    return endLineIndex;
  }, []);

  // Helper to find environment boundaries
  const findEnvironmentBoundaries = useCallback((lines, envName, startLineIndex) => {
    let depth = 1;
    let endLineIndex = -1;
    
    for (let j = startLineIndex + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.includes(`\\begin{${envName}}`)) {
        depth++;
      } else if (line.includes(`\\end{${envName}}`)) {
        depth--;
        if (depth === 0) {
          endLineIndex = j;
          break;
        }
      }
    }
    
    return endLineIndex;
  }, []);

  // Find section by keyword (more flexible matching)
  const findSectionByKeyword = useCallback((lines, keyword) => {
    const lowerKeyword = keyword.toLowerCase();
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lowerLine = line.toLowerCase();
      
      // Check if this is a section command
      if (line.startsWith('\\section{') || line.startsWith('\\section*{') ||
          line.startsWith('\\subsection{') || line.startsWith('\\subsection*{')) {
        
        // Extract section name from command
        const sectionMatch = line.match(/\\section\*?\{([^}]+)\}|\\subsection\*?\{([^}]+)\}/);
        if (sectionMatch) {
          const sectionName = (sectionMatch[1] || sectionMatch[2]).toLowerCase();
          
          // Check if keyword matches section name (exact or contains)
          if (sectionName === lowerKeyword || sectionName.includes(lowerKeyword) || lowerKeyword.includes(sectionName)) {
            const startLine = i + 1; // Convert to 1-based
            
            // Find the end of this section
            const endLine = findSectionBoundaries(lines, i);
            
            return { startLine, endLine: endLine + 1 }; // Convert to 1-based
          }
        }
      }
    }
    
    return null;
  }, [findSectionBoundaries]);

  // Find the line number of \end{document}
  const findEndDocumentLine = useCallback((lines) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === '\\end{document}') {
        return i + 1; // Convert to 1-based line numbers
      }
    }
    return lines.length; // Fallback to end of document
  }, []);

  // Intelligent LaTeX modification analyzer - enhanced with better structure parsing
  const analyzeAndPlaceLaTeXModification = useCallback((fullText, code, userMessage) => {
    const lines = fullText.split('\n');
    const lowerMessage = userMessage.toLowerCase();
    
    // FIRST: Check if user or AI specified a specific line number to modify
    const lineMatch = userMessage.match(/(?:line|error on line|modified line|fix line)[\s:]*(\d+)(?:\s*-\s*(\d+))?/i);
    if (lineMatch) {
      const targetLine = parseInt(lineMatch[1]);
      const endLine = lineMatch[2] ? parseInt(lineMatch[2]) : targetLine;
      
      if (targetLine > 0 && targetLine <= lines.length && endLine >= targetLine && endLine <= lines.length) {
        // Calculate column positions
        const startColumn = 1;
        const endColumn = lines[endLine - 1].length + 1;
        
        return {
          lineNumber: targetLine,
          column: startColumn,
          endLineNumber: endLine,
          endColumn: endColumn,
          text: code,
          isReplacement: true
        };
      } else {
        console.warn(`⚠️ Invalid line range ${targetLine}-${endLine} (document has ${lines.length} lines)`);
      }
    }
    
    // SECOND: Check for section names in user message (more flexible matching)
    const sectionPatterns = [
      { keywords: ['conflict of interest', 'conflicts of interest'], name: 'Conflict of Interest' },
      { keywords: ['introduction'], name: 'Introduction' },
      { keywords: ['methodology', 'methods'], name: 'Methodology' },
      { keywords: ['results', 'findings'], name: 'Results' },
      { keywords: ['discussion'], name: 'Discussion' },
      { keywords: ['conclusion', 'conclusions'], name: 'Conclusion' },
      { keywords: ['abstract'], name: 'Abstract' },
      { keywords: ['acknowledgment', 'acknowledgements', 'acknowledgment'], name: 'Acknowledgments' },
      { keywords: ['references', 'bibliography'], name: 'References' }
    ];
    
    for (const pattern of sectionPatterns) {
      if (pattern.keywords.some(kw => lowerMessage.includes(kw))) {
        // Try exact section name match first
        let section = findSectionByKeyword(lines, pattern.name.toLowerCase());
        
        // If not found, try keyword matching
        if (!section) {
          for (const keyword of pattern.keywords) {
            section = findSectionByKeyword(lines, keyword);
            if (section) break;
          }
        }
        
        if (section) {
          return {
            lineNumber: section.startLine,
            column: 1,
            endLineNumber: section.endLine,
            endColumn: lines[section.endLine - 1].length + 1,
            text: code,
            isReplacement: true
          };
        }
      }
    }
    
    // THIRD: Check for environment names (equation, figure, table, etc.)
    const envPatterns = [
      { keywords: ['equation', 'eqn'], name: 'equation' },
      { keywords: ['figure'], name: 'figure' },
      { keywords: ['table'], name: 'table' },
      { keywords: ['algorithm'], name: 'algorithm' },
      { keywords: ['theorem'], name: 'theorem' }
    ];
    
    for (const pattern of envPatterns) {
      if (pattern.keywords.some(kw => lowerMessage.includes(kw))) {
        // Find environment start
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`\\begin{${pattern.name}}`)) {
            const endLine = findEnvironmentBoundaries(lines, pattern.name, i);
            if (endLine !== -1) {
              return {
                lineNumber: i + 1,
                column: 1,
                endLineNumber: endLine + 1,
                endColumn: lines[endLine].length + 1,
                text: code,
                isReplacement: true
              };
            }
          }
        }
      }
    }
    
    // FOURTH: Check if code itself contains section markers - try to match
    if (code.includes('\\section{') || code.includes('\\subsection{')) {
      const codeSectionMatch = code.match(/\\section\*?\{([^}]+)\}|\\subsection\*?\{([^}]+)\}/);
      if (codeSectionMatch) {
        const sectionName = (codeSectionMatch[1] || codeSectionMatch[2]).toLowerCase();
        const section = findSectionByKeyword(lines, sectionName);
        if (section) {
          return {
            lineNumber: section.startLine,
            column: 1,
            endLineNumber: section.endLine,
            endColumn: lines[section.endLine - 1].length + 1,
            text: code,
            isReplacement: true
          };
        }
      }
    }
    
    // FIFTH: Default to inserting before \end{document} for new content
    const endDocumentLine = findEndDocumentLine(lines);
    return {
      lineNumber: endDocumentLine,
      column: 1,
      text: code,
      isReplacement: false
    };
  }, [findSectionBoundaries, findEnvironmentBoundaries, findSectionByKeyword, findEndDocumentLine]);

  // Find conflict of interest section (now uses helper)
  const findConflictOfInterestSection = useCallback((lines) => {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Look for conflict of interest section
      if (line.includes('\\section{Conflict of Interest}') || 
          line.includes('\\section*{Conflict of Interest}') ||
          (line.toLowerCase().includes('conflict of interest') && 
           (line.startsWith('\\section{') || line.startsWith('\\section*{')))) {
        const startLine = i + 1;
        const endLine = findSectionBoundaries(lines, i);
        return { startLine, endLine: endLine + 1 };
      }
    }
    
    return null;
  }, [findSectionBoundaries]);

  // Fetch user session on mount; redirect to login if unauthenticated
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        if (data.user) {
          setUser(data.user);
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('Failed to fetch session:', error);
        router.push('/login');
      }
    };
    fetchSession();
  }, [router]);

  // Load chat messages on mount (after user is loaded)
  useEffect(() => {
    const loadChatHistory = async () => {
      if (!user?.id || !projectId) return;

      try {
        const response = await fetch(`/api/chat/${projectId}/messages`);
        const data = await response.json();

        if (data.success && data.messages && data.messages.length > 0) {
          // Format messages for frontend state
          const formattedMessages = data.messages.map(msg => ({
            id: msg.id || msg.sequenceNumber,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            messageType: msg.messageType,
            metadata: msg.metadata || {}
          }));

          setChatMessages(formattedMessages);
          console.log(`✅ Restored ${formattedMessages.length} chat messages`);
        }
      } catch (error) {
        console.warn('⚠️ Failed to load chat history:', error);
        // Don't show error to user - just continue without history
      }
    };

    loadChatHistory();
  }, [user?.id, projectId]);

  // Selection chat state - MUST BE DECLARED BEFORE handleSelectionAIRequest
  const [showSelectionChat, setShowSelectionChat] = useState(false);
  const [showChatLimitModal, setShowChatLimitModal] = useState(false);
  // Unified selection state: { text, range, requestId }
  const [selectionState, setSelectionState] = useState(null);
  // Legacy states for backward compatibility (will be removed)
  const [selectedText, setSelectedText] = useState('');
  const [selectionRange, setSelectionRange] = useState(null);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // Cursor position state for AI insertion at cursor
  const [cursorPosition, setCursorPosition] = useState(null);
  
  // Code application state to prevent double application
  const codeApplicationStateRef = useRef({ applied: false, requestId: null });

  // Handle selection-based AI requests
  const handleSelectionAIRequest = useCallback(async ({ message }) => {
    if (!selectedText || !selectionRange || !editorRef.current) {
      console.warn('⚠️ handleSelectionAIRequest called without selection');
      return;
    }

    console.log('🎯 handleSelectionAIRequest called:', {
      message,
      selectedTextLength: selectedText.length,
      selectionRange
    });

    const editor = editorRef.current;
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          projectId,
          currentDocument: content,
          mode: 'execute',
          mentionedFiles: [],
          stream: false,
          context: {
            activeFile: currentFile,
            selection: {
              start: selectionRange.startLineNumber,
              end: selectionRange.endLineNumber,
              text: selectedText
            },
            selectedText,
            current_document: content
          }
        })
      });

      const data = await response.json();

      console.log('✅ Selection AI response:', {
        success: data.success,
        hasCode: !!data.code,
        codeLength: data.code?.length || 0
      });

      if (data.success && data.code && editorRef.current) {
        // Replace the selected text with AI-generated content
        editor.executeEdits('selection-ai-edit', [{
          range: new window.monaco.Range(
            selectionRange.startLineNumber,
            selectionRange.startColumn,
            selectionRange.endLineNumber,
            selectionRange.endColumn
          ),
          text: data.code,
          forceMoveMarkers: true
        }]);

        console.log('✅ Selection replaced successfully');

        // Close selection chat
        setShowSelectionChat(false);

        // Clear selection state
        setSelectedText('');
        setSelectionRange(null);
      }

      // Add exchange to main chat and persist (so selection actions appear in history)
      if (data.success && (data.code || data.response)) {
        const reqId = Date.now();
        const userMsg = { id: reqId, role: 'user', content: message, timestamp: new Date() };
        const assistantContent = data.response || (data.code ? 'Applied edit to selection.' : '');
        const assistantMsg = {
          id: reqId + 1,
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date(),
          messageType: data.code ? 'code_modification' : 'text_response',
          metadata: data.code ? { filesModified: currentFile ? [currentFile] : [] } : {}
        };
        setChatMessages(prev => [...prev, userMsg, assistantMsg]);
        if (user?.id && projectId) {
          fetch(`/api/chat/${projectId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'user',
              content: message,
              messageType: 'user_message',
              metadata: { mode: 'execute' }
            })
          }).catch(err => console.warn('⚠️ Failed to save selection user message:', err));
          fetch(`/api/chat/${projectId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: 'assistant',
              content: assistantContent,
              messageType: assistantMsg.messageType,
              metadata: assistantMsg.metadata
            })
          }).catch(err => console.warn('⚠️ Failed to save selection assistant message:', err));
        }
      }
    } catch (error) {
      console.error('❌ Error in selection AI request:', error);
      toast.error('Failed to process AI request. Please try again.');
    } finally {
      setIsChatLoading(false);
    }
  }, [selectedText, selectionRange, content, projectId, user, currentFile, toast]);
  
  // Helper function to detect code type
  const detectCodeType = useCallback((code) => {
    if (!code || typeof code !== 'string') return 'unknown';
    
    const trimmed = code.trim();
    
    // Full document: contains \documentclass and \begin{document} and \end{document}
    if (trimmed.includes('\\documentclass') && 
        trimmed.includes('\\begin{document}') && 
        trimmed.includes('\\end{document}')) {
      return 'full';
    }
    
    // Partial: contains LaTeX commands but not full document structure
    if (trimmed.includes('\\') || trimmed.includes('\\begin{') || trimmed.includes('\\section')) {
      return 'partial';
    }
    
    return 'unknown';
  }, []);

  // Helper function to extract code from response text
  const extractCodeFromResponse = useCallback((responseText) => {
    if (!responseText) return null;
    
    // Try to extract ALL code blocks (handle multiple blocks - use the last/largest one)
    const codeBlockMatches = responseText.matchAll(/```(?:latex|bibtex|text)?\s*([\s\S]*?)```/g);
    const codeBlocks = Array.from(codeBlockMatches).map(match => match[1].trim());
    
    if (codeBlocks.length > 0) {
      // If multiple blocks, use the largest one (likely the complete file)
      const largestBlock = codeBlocks.reduce((a, b) => a.length > b.length ? a : b);
      console.log(`📦 Found ${codeBlocks.length} code block(s), using largest (${largestBlock.length} chars)`);
      return largestBlock;
    }
    
    // Check if the entire response is code-like (contains LaTeX commands)
    if (responseText.includes('\\documentclass') || responseText.includes('\\begin{document}') || responseText.includes('\\begin{')) {
      console.log('📦 Detected LaTeX code in response (no code blocks)');
      return responseText.trim();
    }
    
    return null;
  }, []);

  // Helper function to normalize file paths for comparison
  const normalizeFilePath = (filePath) => {
    if (!filePath) return '';
    // Remove leading/trailing slashes and normalize
    return filePath.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '').replace(/\\/g, '/');
  };

  /** Returns true if the path is within the project (not a system path like texlive/sty files). */
  const isPathInProject = (filePath) => {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, '/').replace(/^[\/]+/, '');
    // Reject paths with directory traversal
    const segments = normalized.split('/').filter(Boolean);
    if (segments.some(s => s === '..')) return false;
    // Reject system TeX paths
    if (normalized.includes('texlive/') || normalized.includes('texmf-dist/') || normalized.includes('texmf-local/')) return false;
    return true;
  };

  const getFileVersion = (filePath) => {
    const normalized = normalizeFilePath(filePath);
    return fileVersionsRef.current.get(normalized) || null;
  };

  const setFileVersion = (filePath, version) => {
    if (!filePath || !version) return;
    const normalized = normalizeFilePath(filePath);
    fileVersionsRef.current.set(normalized, version);
  };

  // Helper function to apply partial code with smart placement (from AI)
  // Uses forceOverwrite to avoid version conflicts since AI-generated code should always be saved
  const applyPartialCode = useCallback((code, selection, userMessage, fullText) => {
    if (!editorRef.current || !code) return false;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return false;

    // Clear any pending auto-save to prevent overwriting changes
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    skipAutoSaveRef.current = true;

    try {
      // If selection exists, replace it
      if (selection && selection.range &&
          selection.range.startLineNumber && selection.range.endLineNumber) {
        const range = new window.monaco.Range(
          selection.range.startLineNumber,
          selection.range.startColumn || 1,
          selection.range.endLineNumber,
          selection.range.endColumn || 1
        );
        editor.executeEdits('ai-partial-selection', [{
          range: range,
          text: code,
          forceMoveMarkers: true
        }]);

        // Update content state
        const newContent = model.getValue();
        setContent(newContent);

        console.log('✅ Applied partial code to selection (AI)');

        // Save the file with forceOverwrite to avoid version conflicts
        const fileToSave = currentFile;
        if (fileToSave) {
          setTimeout(async () => {
            try {
              const result = await saveCurrentFile(fileToSave, newContent, { forceOverwrite: true });
              if (result?.ok) {
                console.log(`💾 Saved AI partial code to ${fileToSave}`);
              }
            } catch (error) {
              console.error('❌ Failed to save AI partial code:', error);
            }
          }, 500);
        }

        setTimeout(() => {
          skipAutoSaveRef.current = false;
        }, 2000);

        return true;
      }

      // Otherwise use intelligent placement
      const modification = analyzeAndPlaceLaTeXModification(fullText || model.getValue(), code, userMessage || '');

      if (!modification || !modification.lineNumber) {
        console.warn('⚠️ Invalid modification object from analyzeAndPlaceLaTeXModification');
        return false;
      }

      let range;
      if (modification.isReplacement) {
        range = new window.monaco.Range(
          modification.lineNumber,
          modification.column || 1,
          modification.endLineNumber || modification.lineNumber,
          modification.endColumn || 1
        );
      } else {
        range = new window.monaco.Range(
          modification.lineNumber,
          modification.column || 1,
          modification.lineNumber,
          modification.column || 1
        );
      }

      editor.executeEdits('ai-partial-placement', [{
        range: range,
        text: modification.text || code,
        forceMoveMarkers: true
      }]);

      // Update content state
      const newContent = model.getValue();
      setContent(newContent);

      console.log('✅ Applied partial code with intelligent placement (AI)');

      // Save the file with forceOverwrite to avoid version conflicts
      const fileToSave = currentFile;
      if (fileToSave) {
        setTimeout(async () => {
          try {
            const result = await saveCurrentFile(fileToSave, newContent, { forceOverwrite: true });
            if (result?.ok) {
              console.log(`💾 Saved AI partial code to ${fileToSave}`);
            }
          } catch (error) {
            console.error('❌ Failed to save AI partial code:', error);
          }
        }, 500);
      }

      setTimeout(() => {
        skipAutoSaveRef.current = false;
      }, 2000);

      return true;
    } catch (error) {
      console.error('❌ Error applying partial code:', error);
      skipAutoSaveRef.current = false;
      return false;
    }
  }, [analyzeAndPlaceLaTeXModification, currentFile, projectId, saveCurrentFile]);

  // Helper function to apply full document (from AI)
  // Uses forceOverwrite to avoid version conflicts since AI-generated code should always be saved
  const applyFullDocument = useCallback((codeContent, filePath = null) => {
    if (!editorRef.current || !codeContent) {
      console.warn('⚠️ Cannot apply code: editor or codeContent missing');
      return false;
    }

    const editor = editorRef.current;
    const model = editor.getModel();

    if (!model) {
      console.warn('⚠️ Cannot apply code: editor model missing');
      return false;
    }

    // Check if this code is for the current file or a different file
    const targetFile = filePath ? normalizeFilePath(filePath) : null;
    const normalizedCurrentFile = currentFile ? normalizeFilePath(currentFile) : null;

    // If code is for a different file, switch to that file first
    if (targetFile && normalizedCurrentFile && targetFile !== normalizedCurrentFile) {
      console.log(`🔄 Code is for different file (${targetFile} vs ${normalizedCurrentFile}), switching to ${targetFile}`);

      if (loadFileRef.current) {
        loadFileRef.current(targetFile).then(() => {
          setTimeout(() => {
            if (editorRef.current && monacoRef.current) {
              const editor = editorRef.current;
              const model = editor.getModel();
              if (model) {
                const fullRange = model.getFullModelRange();
                editor.executeEdits('ai-code-update', [{
                  range: fullRange,
                  text: codeContent,
                  forceMoveMarkers: true
                }]);
                setContent(codeContent);

                // Save with forceOverwrite to avoid version conflicts for AI-applied code
                setTimeout(async () => {
                  try {
                    const result = await saveCurrentFile(targetFile, codeContent, { forceOverwrite: true });
                    if (result?.ok) {
                      console.log(`💾 Saved AI-applied code to ${targetFile}`);
                    }
                  } catch (error) {
                    console.error('❌ Failed to save AI-applied code:', error);
                  }
                }, 500);
              }
            }
          }, 500);
        });
        return true;
      } else {
        console.warn('⚠️ loadFileRef.current is not available, cannot switch files');
        return false;
      }
    }

    // Clear any pending auto-save to prevent overwriting server changes
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }

    skipAutoSaveRef.current = true;

    try {
      // Replace entire document
      const fullRange = model.getFullModelRange();
      editor.executeEdits('ai-code-update', [{
        range: fullRange,
        text: codeContent,
        forceMoveMarkers: true
      }]);

      setContent(codeContent);
      console.log('✅ Editor updated with full document (AI)');

      // Save the file with forceOverwrite to avoid version conflicts for AI-applied code
      const fileToSave = targetFile || currentFile;
      if (fileToSave) {
        setTimeout(async () => {
          try {
            const result = await saveCurrentFile(fileToSave, codeContent, { forceOverwrite: true });
            if (result?.ok) {
              console.log(`💾 Saved AI-applied code to ${fileToSave}`);
            }
          } catch (error) {
            console.error('❌ Failed to save AI-applied code:', error);
          }
        }, 500);
      }

      setTimeout(() => {
        skipAutoSaveRef.current = false;
      }, 3000);

      return true;
    } catch (error) {
      console.error('❌ Error applying code to editor:', error);
      skipAutoSaveRef.current = false;
      return false;
    }
  }, [currentFile, projectId, saveCurrentFile]);

  // Unified code application function
  const applyCodeToEditor = useCallback((codeContent, options = {}) => {
    const { filePath = null, selection = null, userMessage = '', requestId = null } = options;
    
    // Check if code was already applied for this request
    if (requestId && codeApplicationStateRef.current.requestId === requestId && codeApplicationStateRef.current.applied) {
      console.log('⚠️ Code already applied for this request, skipping');
      return false;
    }
    
    if (!editorRef.current || !codeContent) {
      console.warn('⚠️ Cannot apply code: editor or codeContent missing');
      return false;
    }
    
    const codeType = detectCodeType(codeContent);
    console.log(`📝 Applying code (type: ${codeType})`, {
      codeLength: codeContent.length,
      hasSelection: !!selection
    });
    
    let result = false;
    
    if (codeType === 'full') {
      result = applyFullDocument(codeContent, filePath);
    } else if (codeType === 'partial') {
      const fullText = editorRef.current.getModel()?.getValue() || '';
      result = applyPartialCode(codeContent, selection, userMessage, fullText);
    } else {
      // Unknown type - try as partial first
      console.warn('⚠️ Unknown code type, trying as partial');
      const fullText = editorRef.current.getModel()?.getValue() || '';
      result = applyPartialCode(codeContent, selection, userMessage, fullText);
    }
    
    // Mark as applied if successful
    if (result && requestId) {
      codeApplicationStateRef.current = { applied: true, requestId };
    }
    
    return result;
  }, [detectCodeType, applyFullDocument, applyPartialCode]);
  
  /**
   * handleChatSend - Unified AI chat handler with single code application path
   * 
   * Uses unified code application system with clear precedence:
   * 1. Selection-based edits (if selection exists)
   * 2. Action-modified files (if files were modified by actions)
   * 3. Direct code field (data.code)
   * 4. Extracted code from response
   * 
   * Code type detection (full vs partial) determines application method.
   */
  
  // Helper function to save AI message to database
  const saveAIMessage = useCallback(async (content, messageType, metadata = {}) => {
    if (!user?.id || !projectId) return;

    try {
      await fetch(`/api/chat/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'assistant',
          content,
          messageType,
          metadata
        })
      });
    } catch (err) {
      console.warn('⚠️ Failed to save AI message:', err);
      // Don't block user flow if save fails
    }
  }, [user?.id, projectId]);

  const handleChatSend = useCallback(async ({ message, mode, mentionedFiles, taggedImportedFileIds }) => {
    // Generate unique request ID for this request
    const requestId = Date.now();
    
    // Use pinned selection (Add to Chat) when set, else current editor selection
    const currentSelection = selectionRange || (editorRef.current ? editorRef.current.getSelection() : null);
    const currentSelectedText = selectedText || (editorRef.current ? editorRef.current.getModel()?.getValueInRange(currentSelection) || '' : '');
    const selectionForRequest = chatContextSelection
      ? {
          startLineNumber: chatContextSelection.startLine,
          endLineNumber: chatContextSelection.endLine,
          startColumn: chatContextSelection.startColumn ?? 1,
          endColumn: chatContextSelection.endColumn ?? 1
        }
      : currentSelection;
    const selectedTextForRequest = chatContextSelection?.text ?? currentSelectedText;
    
    // Store selection state with request ID (for apply-edits flow)
    if (selectionForRequest && selectedTextForRequest) {
      setSelectionState({
        text: selectedTextForRequest,
        range: selectionForRequest,
        requestId: requestId
      });
    }

    console.log('🎯 handleChatSend called with:', {
      message,
      mode,
      requestId,
      hasPinnedSelection: !!chatContextSelection,
      hasSelection: !!selectedTextForRequest,
      selectionLength: selectedTextForRequest?.length || 0
    });

    const userMessage = {
      id: requestId,
      role: 'user',
      content: message,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setIsChatLoading(true);
    
    // Save user message to database (fire-and-forget)
    if (user?.id && projectId) {
      fetch(`/api/chat/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: message,
          messageType: 'user_message',
          metadata: {
            mode,
            mentionedFiles: mentionedFiles || []
          }
        })
      }).catch(err => {
        console.warn('⚠️ Failed to save user message:', err);
        // Don't block user flow if save fails
      });
    }
    
    // Reset code application state for new request
    codeApplicationStateRef.current = { applied: false, requestId: null };
    const requestController = new AbortController();
    const CHAT_REQUEST_IDLE_TIMEOUT_MS = 180000;
    const CHAT_REQUEST_MAX_TIMEOUT_MS = 600000;
    const REQUEST_TIMEOUT_CHECK_MS = 5000;
    const requestStartedAt = Date.now();
    let lastActivityAt = Date.now();
    let requestAbortReason = null;
    const markRequestActivity = () => {
      lastActivityAt = Date.now();
    };
    const requestTimeoutId = setInterval(() => {
      const now = Date.now();
      const totalElapsed = now - requestStartedAt;
      const idleElapsed = now - lastActivityAt;
      if (totalElapsed >= CHAT_REQUEST_MAX_TIMEOUT_MS) {
        requestAbortReason = 'max_timeout';
        try { requestController.abort(); } catch {}
        return;
      }
      if (idleElapsed >= CHAT_REQUEST_IDLE_TIMEOUT_MS) {
        requestAbortReason = 'idle_timeout';
        try { requestController.abort(); } catch {}
      }
    }, REQUEST_TIMEOUT_CHECK_MS);

    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: requestController.signal,
          body: JSON.stringify({
            message,
            projectId,
            currentDocument: content,
            mode,
            mentionedFiles,
            taggedImportedFileIds: taggedImportedFileIds || [],
            stream: true,  // Enable streaming
            context: {
              activeFile: currentFile,
              highlighted_files: mentionedFiles || [],
              tagged_imported_file_ids: taggedImportedFileIds || [],
              selection: selectionForRequest && selectedTextForRequest ? {
                start: selectionForRequest.startLineNumber,
                end: selectionForRequest.endLineNumber,
                text: selectedTextForRequest
              } : null,
              cursor_position: cursorPosition || null,
              selectedText: selectedTextForRequest,
              current_document: content
            }
        }),
      });

      if (!response.ok) {
        let errData = {};
        try {
          errData = await response.json();
        } catch {
          errData = { error: 'Failed to send message' };
        }
        const isLimit = response.status === 429 && (errData.error === 'daily_chat_limit' || (errData.message || '').toLowerCase().includes('limit'));
        if (isLimit) {
          setShowChatLimitModal(true);
        }
        const errorContent = errData.message || errData.error || 'Failed to send message. Please try again.';
        setChatMessages(prev => [...prev, {
          id: requestId + 1,
          role: 'assistant',
          content: errorContent,
          timestamp: new Date(),
          isError: true
        }]);
        return;
      }

      // Check if streaming response (SSE)
      const contentType = response.headers.get('content-type');
      markRequestActivity();
      
      if (contentType?.includes('text/event-stream')) {
        // Handle streaming SSE response
        console.log('📡 Processing SSE stream...');
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastEventType = 'message';
        let responseText = '';
        let toolCalls = [];
        const MAX_TOOL_CALLS = 6;
        const updateAssistantMessage = (updates) => {
          setChatMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], ...updates };
            }
            return updated;
          });
        };
        let filesModified = [];
        
        // Create initial assistant message
        const aiMessage = {
          id: requestId + 1,
          role: 'assistant',
          content: '',
          toolCalls: [],
          timestamp: new Date()
        };
        setChatMessages(prev => [...prev, aiMessage]);
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          markRequestActivity();
          
          buffer += decoder.decode(value, { stream: true });
          
          // Parse SSE events from buffer
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer
          
          for (const line of lines) {
            if (line.startsWith('event:')) {
              lastEventType = line.replace(/^event:\s*/, '').trim() || 'message';
            } else if (line.startsWith('data:')) {
              try {
                const eventType = lastEventType;
                let data;
                try {
                  data = JSON.parse(line.slice(5).trim());
                } catch (_) {
                  buffer = line + '\n' + buffer;
                  continue;
                }
                if (data != null && typeof data !== 'object') data = {};
                if (data == null) data = {};
                // Handle different event types
                switch (eventType) {
                  case 'status':
                    console.log('📊 Status:', data.message);
                    toolCalls.push({ type: 'status', message: data.message });
                    if (toolCalls.length > MAX_TOOL_CALLS) {
                      toolCalls = toolCalls.slice(-MAX_TOOL_CALLS);
                    }
                    updateAssistantMessage({ content: responseText, toolCalls });
                    break;
                    
                  case 'tool_call':
                    console.log('🔧 Tool call:', data.tool);
                    toolCalls.push({ type: 'tool', tool: data.tool, params: data.params });
                    if (toolCalls.length > MAX_TOOL_CALLS) {
                      toolCalls = toolCalls.slice(-MAX_TOOL_CALLS);
                    }
                    updateAssistantMessage({ content: responseText, toolCalls });
                    break;
                    
                  case 'tool_result':
                    console.log('📦 Tool result:', data.tool, data.success ? '✓' : '✗');
                    toolCalls.push({ type: 'result', tool: data.tool, success: data.success });
                    if (toolCalls.length > MAX_TOOL_CALLS) {
                      toolCalls = toolCalls.slice(-MAX_TOOL_CALLS);
                    }
                    updateAssistantMessage({ content: responseText, toolCalls });
                    break;
                    
                  case 'text':
                    responseText += data.content || '';
                    // Update message content
                    updateAssistantMessage({ content: responseText, toolCalls });
                    break;
                    
                  case 'code':
                    // Legacy: Code is now written directly by Python backend
                    // This event is informational only
                    console.log('📄 Code event received (file already saved by backend)');
                    if (data.file_path) {
                      filesModified.push(data.file_path);
                    }
                    break;
                    
                  case 'file_saved':
                    // File was saved directly by Python backend - reload it with undo support
                    console.log('💾 File saved on server:', data.file_path, data.version ? `(v: ${data.version.substring(0, 8)}...)` : '');
                    if (data.file_path) {
                      filesModified.push(data.file_path);
                      toolCalls.push({ type: 'file_saved', file_path: data.file_path });
                      if (toolCalls.length > MAX_TOOL_CALLS) {
                        toolCalls = toolCalls.slice(-MAX_TOOL_CALLS);
                      }
                      updateAssistantMessage({ content: responseText, toolCalls });

                      // CRITICAL: Clear any pending auto-save to prevent conflicts
                      if (autoSaveTimeoutRef.current) {
                        clearTimeout(autoSaveTimeoutRef.current);
                        autoSaveTimeoutRef.current = null;
                        console.log('🛑 Cancelled pending auto-save to prevent conflict');
                      }

                      // Temporarily disable auto-save during AI file operations
                      skipAutoSaveRef.current = true;

                      // If backend provided version hash, update our cache IMMEDIATELY
                      // This prevents "File was changed on server" conflicts
                      if (data.version && setFileVersion) {
                        setFileVersion(data.file_path, data.version);
                        console.log('📝 Updated version cache from backend:', data.file_path, data.version.substring(0, 8));
                      }

                      // Try to reload with undo support first (preserves Ctrl+Z history)
                      // Falls back to standard reload if file is not currently open. fromServer: true = cache-bust.
                      const reloadWithUndo = reloadFileWithUndoRef.current;
                      const fromServer = { fromServer: true };
                      if (reloadWithUndo) {
                        reloadWithUndo(data.file_path, fromServer).then((success) => {
                          if (success) {
                            console.log('✅ Reloaded file with undo support:', data.file_path);
                            // Show notification that file was updated by AI
                            toast.info(`📝 ${data.file_path} updated by AI`, { duration: 3000 });
                            // Re-enable auto-save after successful reload
                            setTimeout(() => {
                              skipAutoSaveRef.current = false;
                            }, 1000);
                          } else if (loadFileRef.current) {
                            loadFileRef.current(data.file_path, fromServer).then(() => {
                              console.log('✅ Reloaded file (standard):', data.file_path);
                              toast.info(`📝 ${data.file_path} updated by AI`, { duration: 3000 });
                              setTimeout(() => {
                                skipAutoSaveRef.current = false;
                              }, 1000);
                            }).catch(err => {
                              console.error('❌ Failed to reload file:', err);
                              skipAutoSaveRef.current = false;
                            });
                          }
                        }).catch(err => {
                          console.error('❌ Failed to reload file with undo:', err);
                          skipAutoSaveRef.current = false;
                          if (loadFileRef.current) {
                            loadFileRef.current(data.file_path, fromServer).catch(() => {});
                          }
                        });
                      } else if (loadFileRef.current) {
                        loadFileRef.current(data.file_path, fromServer).then(() => {
                          console.log('✅ Reloaded file after server save:', data.file_path);
                          toast.info(`📝 ${data.file_path} updated by AI`, { duration: 3000 });
                          setTimeout(() => {
                            skipAutoSaveRef.current = false;
                          }, 1000);
                        }).catch(err => {
                          console.error('❌ Failed to reload file:', err);
                          skipAutoSaveRef.current = false;
                        });
                      }
                    }
                    break;
                    
                  case 'done':
                    filesModified = data.files_modified || filesModified;
                    console.log('✅ Stream done, files modified:', filesModified);
                    if (Array.isArray(filesModified) && filesModified.length > 0) {
                      setFileTreeRefreshKey((prev) => prev + 1);
                    }
                    break;
                    
                  case 'error':
                    const errMsg = (data && typeof data === 'object' && data.error != null)
                      ? String(data.error)
                      : 'Stream error';
                    console.error('❌ Stream error:', errMsg);
                    responseText += `\n\nError: ${errMsg}`;
                    break;
                }
              } catch (parseError) {
                // Partial data line: put back so next chunk can complete it
                buffer = line + '\n' + buffer;
                console.debug('Parse error (may be partial):', parseError.message);
              }
            }
          }
        }
        
        // Note: Files are now saved directly by Python backend.
        // The 'file_saved' event handler already reloads modified files with undo support.
        // Fallback: ensure every modified file is reloaded (e.g. if an event was missed).
        if (filesModified.length > 0) {
          console.log('📁 Ensuring files are reloaded (fallback):', filesModified);
          await new Promise(resolve => setTimeout(resolve, 150));
          const reloadWithUndo = reloadFileWithUndoRef.current;
          const loadFile = loadFileRef.current;
          const fromServer = { fromServer: true };
          for (const filePath of filesModified) {
            if (reloadWithUndo) {
              const success = await reloadWithUndo(filePath, fromServer);
              if (!success && loadFile) await loadFile(filePath, fromServer).catch(() => {});
            } else if (loadFile) {
              await loadFile(filePath, fromServer).catch(() => {});
            }
          }
        }
        
        // Apply streamed AI output to the editor only when the backend did NOT write files.
        // When file_saved events were received, the backend already wrote .tex/.bib to disk
        // and we reloaded them; applying responseText here would overwrite with chat text.
        const storedSelection = (selectionForRequest && selectedTextForRequest)
          ? { text: selectedTextForRequest, range: selectionForRequest }
          : null;
        const looksLikeLatexOrBib = (text) => {
          if (!text || typeof text !== 'string') return false;
          const t = text.trim();
          return t.length > 20 && (
            /\\begin\s*\{/.test(t) || /\\end\s*\{/.test(t) || /\\item\b/.test(t) ||
            /\\section\b|\\subsection\b|\\cite\s*\{/.test(t) || /@\s*\{?\s*(article|book|inbook)/.test(t)
          );
        };
        const backendWroteFiles = filesModified.length > 0;
        if (!backendWroteFiles && responseText && (mode === 'execute' || looksLikeLatexOrBib(responseText))) {
          const extracted = extractCodeFromResponse(responseText);
          const codeToApply = (extracted && extracted.length > 30) ? extracted : responseText.trim();
          if (codeToApply.length > 10) {
            const applied = applyCodeToEditor(codeToApply, {
              filePath: currentFile || undefined,
              selection: storedSelection,
              userMessage: message,
              requestId
            });
            if (applied) {
              console.log('✅ Streamed response applied to editor');
            }
          }
        }
        
        // Save AI message to database
        if (user?.id && projectId) {
          // Determine message type
          let messageType = 'text_response';
          let summary = responseText;
          
          if (filesModified.length > 0) {
            messageType = 'code_modification';
            // Generate summary for code modifications
            summary = generateCodeSummary(filesModified, '', responseText);
          } else if (toolCalls.length > 0) {
            messageType = 'tool_call';
            // Generate summary for tool calls
            const toolSummary = generateToolCallSummary(toolCalls);
            summary = toolSummary || responseText || 'Executed tool operations';
          }
          
          // Build metadata
          const metadata = {
            mode,
            filesModified: filesModified.length > 0 ? filesModified : undefined,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            codeSummary: messageType === 'code_modification' ? summary : undefined,
            toolSummary: messageType === 'tool_call' ? summary : undefined
          };
          
          // Save message (always save full responseText for display; summary is in metadata.codeSummary)
          await saveAIMessage(responseText, messageType, metadata);
        }
        
        return; // Done with streaming
      }
      
      // Non-streaming response (fallback)
      const data = await response.json();
      
      if (data.success) {
        const aiMessage = {
          id: requestId + 1,
          role: 'assistant',
          content: data.response,
          timestamp: new Date()
        };

        setChatMessages(prev => [...prev, aiMessage]);

        // Get selection state for this request (may have changed, but we use stored one)
        const storedSelection = selectionState && selectionState.requestId === requestId 
          ? { text: selectionState.text, range: selectionState.range }
          : null;

        let codeApplied = false;
        
        console.log('🔍 Processing AI response for code application:', {
          requestId,
          hasModifiedFiles: !!(data.modifiedFiles && data.modifiedFiles.length > 0),
          hasCode: !!(data.code && data.code.length > 0),
          hasResponse: !!data.response,
          agent: data.agent,
          intent: data.intent,
          mode,
          hasStoredSelection: !!storedSelection
        });

        // UNIFIED CODE APPLICATION - Single path with clear precedence
        
        // 1. Handle action-modified files (if files were modified by action executor)
        if (data.modifiedFiles && data.modifiedFiles.length > 0 && data.code) {
          const modifiedFile = data.modifiedFiles[0]?.path || data.modifiedFiles[0];
          console.log('📝 Applying code from action-modified file:', modifiedFile);
          
          codeApplied = applyCodeToEditor(data.code, {
            filePath: modifiedFile,
            selection: storedSelection,
            userMessage: message,
            requestId: requestId
          });
          
          if (!codeApplied) {
            // Fallback: reload file if application failed (with undo support)
            console.log('🔄 Reloading modified file as fallback');
            const reloadWithUndo = reloadFileWithUndoRef.current;
            if (reloadWithUndo) {
              const success = await reloadWithUndo(modifiedFile);
              if (!success && loadFileRef.current) {
                await loadFileRef.current(modifiedFile);
              }
            } else if (loadFileRef.current) {
              await loadFileRef.current(modifiedFile);
            }
            codeApplied = true;
          }
        }
        
        // 2. Handle direct code field (genlatex-agent responses, etc.)
        if (!codeApplied && data.code && typeof data.code === 'string' && data.code.length > 0) {
          console.log('📝 Applying code from data.code field');
          codeApplied = applyCodeToEditor(data.code, {
            selection: storedSelection,
            userMessage: message,
            requestId: requestId
          });
        }
        
        // 3. Extract and apply code from response text
        if (!codeApplied && data.response && mode === 'execute') {
          const extractedCode = extractCodeFromResponse(data.response);
          if (extractedCode && extractedCode.length > 50) {
            console.log('📦 Extracting and applying code from response');
            codeApplied = applyCodeToEditor(extractedCode, {
              selection: storedSelection,
              userMessage: message,
              requestId: requestId
            });
            
            if (codeApplied) {
              // Clean response for display
              const cleanedResponse = data.response.replace(/```(?:latex|bibtex|text)?\s*[\s\S]*?```/g, '').trim();
              const updatedMessage = {
                ...aiMessage,
                content: cleanedResponse || '✅ Code has been applied to the editor.'
              };
              setChatMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = updatedMessage;
                return updated;
              });
            }
          }
        }
        
        // Handle genlatex-agent specific responses (citations, etc.)
        if (data.agent === 'genlatex-agent' && editorRef.current) {
          const editor = editorRef.current;
          const model = editor.getModel();
          
          // Handle citations for make_paper or add_citation
          if ((data.intent === 'make_paper' || data.intent === 'add_citation') && data.citations && data.citations.length > 0) {
            console.log('📚 Handling citations:', data.citations.length);
            
            // Build BibTeX content
            let bibtexContent = data.intent === 'make_paper' 
              ? '% Generated by GenLaTeX AI\n\n'
              : '\n% Added by GenLaTeX AI\n\n';
            
            data.citations.forEach(citation => {
              if (citation.bibtex) {
                bibtexContent += citation.bibtex + '\n\n';
              } else if (citation.citation_key) {
                bibtexContent += `@article{${citation.citation_key},\n`;
                bibtexContent += `  title={${citation.title || 'Unknown'}},\n`;
                bibtexContent += `  author={${citation.authors || 'Unknown'}},\n`;
                bibtexContent += `  year={${citation.year || 'Unknown'}}\n`;
                bibtexContent += `}\n\n`;
              }
            });
            
            // Save or append to references.bib (use forceOverwrite since this is AI-generated)
            if (data.intent === 'make_paper') {
              saveCurrentFile('references.bib', bibtexContent, { forceOverwrite: true })
                .catch(err => console.error('❌ Error saving references.bib:', err));
            } else {
              // Append for add_citation
              loadFileContent('references.bib').then(({ content }) => {
                const existingContent = content || '% References\n\n';
                return saveCurrentFile('references.bib', existingContent + bibtexContent, { forceOverwrite: true });
              }).catch(err => console.error('❌ Error updating references.bib:', err));
            }
            
            // Insert citation command in document for add_citation
            if (data.intent === 'add_citation' && model) {
              const selection = editor.getSelection();
              const citationKeys = data.citations.map(c => c.citation_key || c.key).filter(Boolean);
              const citeCmd = storedSelection && storedSelection.text.trim() 
                ? ` \\cite{${citationKeys[0]}}`
                : `\\cite{${citationKeys[0]}} `;
              
              const range = storedSelection && storedSelection.text.trim()
                ? new window.monaco.Range(
                    selection.endLineNumber,
                    selection.endColumn,
                    selection.endLineNumber,
                    selection.endColumn
                  )
                : new window.monaco.Range(
                    selection.startLineNumber,
                    selection.startColumn,
                    selection.startLineNumber,
                    selection.startColumn
                  );
              
              editor.executeEdits('add-citation', [{
                range: range,
                text: citeCmd,
                forceMoveMarkers: true
              }]);
            }
            
          }
        }
        
        // Clear selection state and pinned selection pill after successful application
        if (codeApplied && storedSelection) {
          setSelectionState(null);
          setSelectedText('');
          setSelectionRange(null);
          setChatContextSelection(null);
        }
        
        // Log final status
        if (codeApplied) {
          console.log('✅✅✅ CODE SUCCESSFULLY APPLIED TO EDITOR ✅✅✅');
        } else if (mode === 'execute') {
          console.warn('⚠️⚠️⚠️ NO CODE WAS APPLIED TO EDITOR ⚠️⚠️⚠️');
        }
        
        // Save AI message to database
        if (user?.id && projectId) {
          // Determine message type and generate summary
          let messageType = 'text_response';
          let summary = data.response || '';
          const filesModified = data.files_modified || data.modifiedFiles || [];
          const toolCalls = []; // Non-streaming doesn't track tool calls separately
          
          if (filesModified.length > 0) {
            messageType = 'code_modification';
            // Generate summary for code modifications
            summary = generateCodeSummary(filesModified, data.code || '', data.response || '');
          } else if (data.intent && (data.intent === 'make_paper' || data.intent === 'add_citation')) {
            // Special handling for citation intents
            messageType = 'code_modification';
            if (data.citations && data.citations.length > 0) {
              summary = `Added ${data.citations.length} citation${data.citations.length > 1 ? 's' : ''} to references.bib`;
            }
          }
          
          // Build metadata
          const metadata = {
            mode,
            filesModified: filesModified.length > 0 ? filesModified : undefined,
            intent: data.intent,
            agent: data.agent,
            codeSummary: messageType === 'code_modification' ? summary : undefined
          };
          
          // Save message (always save full response for display; summary is in metadata.codeSummary)
          await saveAIMessage(data.response || summary, messageType, metadata);
        }
      } else {
        throw new Error(data.error || 'Failed to process request');
      }
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      if (isAbort) {
        console.warn('Chat request aborted:', requestAbortReason || 'user_or_network_abort');
      } else {
        console.error('Error sending message:', error);
      }
      const errorContent = isAbort
        ? (
            requestAbortReason === 'idle_timeout'
              ? 'Generation is taking too long without progress updates. Please retry.'
              : requestAbortReason === 'max_timeout'
                ? 'Generation reached the maximum allowed duration. Please retry with a shorter instruction.'
                : 'Generation was interrupted. Please retry.'
          )
        : 'Sorry, there was an error processing your request. Please try again.';
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last?.id === requestId + 1) {
          return [...prev.slice(0, -1), { ...last, content: errorContent, isError: true }];
        }
        return [...prev, {
          id: requestId + 1,
          role: 'assistant',
          content: errorContent,
          timestamp: new Date(),
          isError: true
        }];
      });
    } finally {
      clearInterval(requestTimeoutId);
      setIsChatLoading(false);
    }
  }, [chatContextSelection, selectionState, selectedText, selectionRange, content, chatMessages, projectId, user, cursorPosition, currentFile, applyCodeToEditor, extractCodeFromResponse, saveAIMessage]);
  
  /**
   * handleFixErrorWithAI - Fix a compilation error using AI
   * Constructs a detailed error message and sends it to the AI chat system
   */
  const handleFixErrorWithAI = useCallback(async (error, allErrors = null) => {
    // Build comprehensive error message for AI
    let errorMessage = `Fix this LaTeX compilation error:\n\n`;
    errorMessage += `Error: ${error.message}\n`;
    
    if (error.file) {
      errorMessage += `File: ${error.file}\n`;
    }
    
    if (error.line) {
      errorMessage += `Line: ${error.line}\n`;
    }
    
    if (error.category) {
      errorMessage += `Category: ${error.category}\n`;
    }
    
    if (error.engine) {
      errorMessage += `Engine: ${error.engine}\n`;
    }
    
    if (error.context && error.context.length > 0) {
      errorMessage += `\nContext:\n${error.context.join('\n')}\n`;
    }
    
    if (error.suggestions && error.suggestions.length > 0) {
      errorMessage += `\nSuggestions:\n${error.suggestions.map(s => `- ${s}`).join('\n')}\n`;
    }
    
    // If fixing all errors, mention that
    if (allErrors && allErrors.length > 1) {
      errorMessage += `\nNote: This is error ${allErrors.indexOf(error) + 1} of ${allErrors.length} errors. Fix this one.`;
    }
    
    errorMessage += `\nPlease fix this error in the LaTeX document.`;
    
    // Determine active file - use error file if in project, otherwise current file
    const targetFile = (error.file && isPathInProject(error.file)) ? error.file : currentFile;
    
    // Switch to the error file if it's different from current (only project files)
    if (targetFile && targetFile !== currentFile && loadFileRef.current) {
      await loadFileRef.current(targetFile);
    }
    
    // Navigate to error line if available
    if (error.line && editorRef.current) {
      const editor = editorRef.current;
      const model = editor.getModel();
      if (model) {
        editor.setPosition({ lineNumber: error.line, column: 1 });
        editor.revealLineInCenter(error.line);
      }
    }
    
    // Send to AI chat with execute mode
    await handleChatSend({
      message: errorMessage,
      mode: 'execute',
      mentionedFiles: targetFile ? [targetFile] : []
    });
  }, [handleChatSend, currentFile, isPathInProject]);

  /**
   * handleFixAllErrorsWithAI - Fix all compilation errors using AI
   */
  const handleFixAllErrorsWithAI = useCallback(async () => {
    const criticalErrors = compilationErrors.filter(e => e.type === 'error' || e.severity === 'error');
    
    if (criticalErrors.length === 0) {
      console.log('No errors to fix');
      return;
    }
    
    // Fix errors one by one
    for (let i = 0; i < criticalErrors.length; i++) {
      const error = criticalErrors[i];
      console.log(`Fixing error ${i + 1}/${criticalErrors.length}: ${error.message}`);
      
      await handleFixErrorWithAI(error, criticalErrors);
      
      // Wait a bit between fixes to allow AI to process
      if (i < criticalErrors.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }, [compilationErrors, handleFixErrorWithAI]);
  
  // Panel resizing state
  const [editorWidth, setEditorWidth] = useState(40); // Percentage
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef(null);

  // Handle panel resizing
  const handleMouseDown = useCallback((e) => {
    console.log('🖱️ Resize handle mousedown');
    setIsResizing(true);
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isResizing) return;
    
    // Get the container element (the main flex container)
    // Try multiple selectors to find the container
    const container = document.querySelector('.flex-1.flex.min-h-0') || 
                     document.querySelector('.flex-1.flex') ||
                     resizeRef.current?.parentElement;
    
    if (!container) {
      console.warn('⚠️ Resize container not found');
      return;
    }
    
    const containerRect = container.getBoundingClientRect();
    const relativeX = e.clientX - containerRect.left;
    const newEditorWidth = (relativeX / containerRect.width) * 100;
    
    // Constrain between 20% and 80%
    const constrainedWidth = Math.min(Math.max(newEditorWidth, 20), 80);
    console.log('📏 Resizing to:', constrainedWidth.toFixed(1) + '%');
    setEditorWidth(constrainedWidth);
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    console.log('🖱️ Resize handle mouseup');
    setIsResizing(false);
  }, []);

  // Add event listeners for resizing
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  // Highlight error and warning lines in Monaco editor using diagnostics
  const applyErrorMarkers = useCallback((errors) => {
    if (!editorRef.current || !monacoRef.current) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor.getModel();

    if (!model) {
      return;
    }

    // Filter errors for current file only (support multi-file)
    const currentFileErrors = errors.filter(err => {
      if (!err.line) return false;
      // If error has a file, check if it matches current file
      if (err.file) {
        // Normalize file paths for comparison
        const errorFile = err.file.replace(/\\/g, '/');
        const current = currentFile ? currentFile.replace(/\\/g, '/') : '';
        return errorFile === current || errorFile.endsWith(current) || current.endsWith(errorFile);
      }
      // If no file specified, assume it's for current file
      return true;
    });

    // Convert errors to Monaco markers
    const totalLines = model.getLineCount();
    const markers = currentFileErrors
      .filter(err => {
        // Validate line number is within valid range
        const lineNum = parseInt(err.line);
        if (!lineNum || lineNum < 1 || lineNum > totalLines) {
          console.warn(`Invalid line number ${err.line} (valid range: 1-${totalLines}), skipping error:`, err.message);
          return false;
        }
        return true;
      })
      .map(err => {
        const lineNum = parseInt(err.line);
        const lineContent = model.getLineContent(lineNum);
      
        // Determine column range: prefer locating err.text in the line (exact then normalized)
        let startColumn = err.column ?? 1;
        let endColumn = err.endColumn ?? model.getLineMaxColumn(lineNum);

        if (err.text && err.text.length > 0) {
          let textIndex = lineContent.indexOf(err.text);
          let matchLen = 0;
          if (textIndex !== -1) {
            matchLen = err.text.length;
          } else {
            const normalized = err.text.replace(/^["']|["']$/g, '').trim();
            if (normalized.length > 0) {
              textIndex = lineContent.indexOf(normalized);
              if (textIndex !== -1) matchLen = normalized.length;
            }
          }
          if (textIndex !== -1 && matchLen > 0) {
            startColumn = textIndex + 1;
            endColumn = textIndex + matchLen + 1;
          } else if (startColumn === 1 && err.endColumn != null && err.endColumn <= (err.text?.length ?? 0) + 1) {
            // Parser gave length-based range but text didn't match; highlight whole line for visibility
            endColumn = model.getLineMaxColumn(lineNum);
          }
        }
      
      // Check if this is a related error (not primary)
      const isRelated = err.isPrimary === false;
      const relatedCount = err.relatedCount || 0;
      
      // Build hover message with context and suggestions
      const hoverParts = [err.message];
      if (isRelated) {
        hoverParts.push('\n(Related error - fix primary error to resolve)');
      }
      if (relatedCount > 0) {
        hoverParts.push(`\n[${relatedCount} related error(s)]`);
      }
      if (err.engine && err.engine !== 'pdflatex') {
        hoverParts.push(`\nEngine: ${err.engine}`);
      }
      if (err.category) {
        hoverParts.push(`\nCategory: ${err.category}`);
      }
      if (err.context && err.context.length > 0) {
        hoverParts.push('\n\nContext:');
        hoverParts.push(...err.context.slice(0, 3).map(line => `  ${line}`));
      }
      if (err.suggestions && err.suggestions.length > 0) {
        hoverParts.push('\n\nSuggestions:');
        hoverParts.push(...err.suggestions.slice(0, 3).map(s => `  • ${s}`));
      }
      
      // Use lighter severity for related errors
      let severity = err.severity === 'error' 
        ? monaco.MarkerSeverity.Error 
        : err.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Info;
      
      // Related errors get warning severity (lighter) even if they're errors
      if (isRelated && severity === monaco.MarkerSeverity.Error) {
        severity = monaco.MarkerSeverity.Warning;
      }
      
        return {
          startLineNumber: lineNum,
          endLineNumber: lineNum,
          startColumn: startColumn,
          endColumn: endColumn,
          message: hoverParts.join('\n'),
          severity: severity,
          source: 'latex-compilation',
          code: err.category || 'general',
          tags: err.isIgnorable ? [monaco.MarkerTag.Unnecessary] : (isRelated ? [monaco.MarkerTag.Unnecessary] : undefined)
        };
      });

    // Apply markers using Monaco's diagnostic API
    monaco.editor.setModelMarkers(model, 'latex-compilation', markers);
    
    // Clear syntax markers when compilation markers are applied (compilation is more accurate)
    if (markers.length > 0) {
      monaco.editor.setModelMarkers(model, 'latex-syntax', []);
    }
  }, [currentFile, editorRef, monacoRef]);


  // Helper function to check if current file is LaTeX
  const isCurrentFileLaTeX = useCallback(() => {
    return currentFile && currentFile.endsWith('.tex');
  }, [currentFile]);

  // Helper function to check if a file is editable (text-based files)
  const isEditableFile = useCallback((filePath) => {
    if (!filePath) return false;
    const editableExtensions = ['.tex', '.bib', '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv', '.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.css', '.html', '.sh', '.bat', '.ps1'];
    const lowerPath = filePath.toLowerCase();
    return editableExtensions.some(ext => lowerPath.endsWith(ext));
  }, []);

  // Helper function to check if current file is editable
  const isCurrentFileEditable = useCallback(() => {
    return isEditableFile(currentFile);
  }, [currentFile, isEditableFile]);

  const isTexFile = useCallback(() => {
    return !!currentFile && currentFile.toLowerCase().endsWith('.tex');
  }, [currentFile]);

  // Helper function to get Monaco language ID based on file extension
  const getLanguageFromFile = useCallback((filePath) => {
    if (!filePath) return 'plaintext';
    const lowerPath = filePath.toLowerCase();
    
    if (lowerPath.endsWith('.tex')) return 'latex';
    if (lowerPath.endsWith('.bib')) return 'latex'; // BibTeX uses LaTeX syntax
    if (lowerPath.endsWith('.js')) return 'javascript';
    if (lowerPath.endsWith('.ts')) return 'typescript';
    if (lowerPath.endsWith('.py')) return 'python';
    if (lowerPath.endsWith('.java')) return 'java';
    if (lowerPath.endsWith('.cpp') || lowerPath.endsWith('.cxx') || lowerPath.endsWith('.cc')) return 'cpp';
    if (lowerPath.endsWith('.c')) return 'c';
    if (lowerPath.endsWith('.h') || lowerPath.endsWith('.hpp')) return 'cpp';
    if (lowerPath.endsWith('.css')) return 'css';
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) return 'html';
    if (lowerPath.endsWith('.json')) return 'json';
    if (lowerPath.endsWith('.xml')) return 'xml';
    if (lowerPath.endsWith('.yaml') || lowerPath.endsWith('.yml')) return 'yaml';
    if (lowerPath.endsWith('.md')) return 'markdown';
    if (lowerPath.endsWith('.sh') || lowerPath.endsWith('.bash')) return 'shell';
    if (lowerPath.endsWith('.bat')) return 'bat';
    if (lowerPath.endsWith('.ps1')) return 'powershell';
    if (lowerPath.endsWith('.csv')) return 'csv';
    
    return 'plaintext';
  }, []);

  // Function to auto-compile LaTeX files (always compile, don't check PDF existence)
  const autoCompileLaTeX = useCallback(async (targetFile = compileTarget) => {
    if (!isCurrentFileLaTeX() || !autoCompileEnabled) return;
    
    console.log(`📄 Auto-compiling LaTeX file: ${targetFile}`);
    await compile();
  }, [projectId, compileTarget, isCurrentFileLaTeX, autoCompileEnabled]);


  // Function to handle new LaTeX file creation
  const handleNewLaTeXFile = useCallback(async (filePath) => {
    if (!filePath.endsWith('.tex')) return;
    
    // Cancel any pending auto-compile
    if (autoCompileTimeoutRef.current) {
      clearTimeout(autoCompileTimeoutRef.current);
      autoCompileTimeoutRef.current = null;
    }
    
    console.log(`📄 New LaTeX file created: ${filePath}, auto-compiling...`);
    setCompileTarget(filePath);
    setFileViewMode('editor');
    
    // Load the file content (loadFile will set currentFile after content is loaded)
    await loadFile(filePath);
    
    // Auto-compile after a short delay
    setTimeout(() => {
      compile();
    }, 1000);
  }, []);

  // Function to handle file renaming
  const handleFileRename = useCallback(async (oldPath, newPath) => {
    if (!oldPath.endsWith('.tex') || !newPath.endsWith('.tex')) return;
    
    // Cancel any pending auto-compile
    if (autoCompileTimeoutRef.current) {
      clearTimeout(autoCompileTimeoutRef.current);
      autoCompileTimeoutRef.current = null;
    }
    
    // If the renamed file is the current compile target, update it
    if (compileTarget === oldPath) {
      console.log(`📄 LaTeX file renamed: ${oldPath} -> ${newPath}, updating compile target...`);
      setCompileTarget(newPath);
      
      // Auto-compile the renamed file
      setTimeout(() => {
        autoCompileLaTeX(newPath);
      }, 500);
    }
  }, [compileTarget]);

  // Function to handle file deletion
  const handleFileDelete = useCallback(async (deletedPath) => {
    // Remove from chat context if highlighted
    setChatContextFiles(prev => prev.filter(f => f.path !== deletedPath));
    
    if (!deletedPath.endsWith('.tex')) return;
    
    // If the deleted file is the current compile target, switch to another .tex or clear
    if (compileTarget === deletedPath) {
      try {
        const res = await fetch(`/api/files/${projectId}/tree`);
        const { files } = res.ok ? await res.json() : { files: [] };
        function flattenPaths(items) {
          if (!items || !Array.isArray(items)) return [];
          const paths = [];
          for (const item of items) {
            if (item.type === 'file') paths.push(item.path);
            else if (item.children) paths.push(...flattenPaths(item.children));
          }
          return paths;
        }
        const texPaths = flattenPaths(files).filter(p => p.toLowerCase().endsWith('.tex') && p !== deletedPath).sort();
        const nextTex = texPaths.length > 0
          ? (texPaths.includes('main.tex') ? 'main.tex' : (() => {
              try {
                const cached = typeof localStorage !== 'undefined' && localStorage.getItem(`genlatex-last-tex-${projectId}`);
                return (cached && texPaths.includes(cached)) ? cached : texPaths[0];
              } catch (e) { return texPaths[0]; }
            })())
          : null;
        setCompileTarget(nextTex);
        if (nextTex) {
          setFileViewMode('editor');
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(`genlatex-last-tex-${projectId}`, nextTex);
          } catch (e) { /* ignore */ }
          if (loadFileRef.current) await loadFileRef.current(nextTex);
          setTimeout(() => autoCompileLaTeX(nextTex), 500);
        } else {
          setFileViewMode('editor');
          setCurrentFile(null);
          setContent('');
        }
      } catch (e) {
        console.warn('Failed to resolve next .tex after delete:', e);
        setCompileTarget(null);
        setCurrentFile(null);
        setContent('');
      }
    }
  }, [compileTarget, projectId, autoCompileLaTeX]);
  
  // Debounce utility
  const debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Robust theme application function
  const applyMonacoTheme = useCallback((darkMode) => {
    if (!editorRef.current || typeof window === 'undefined' || !window.monaco) {
      console.log('⚠️ Monaco editor not ready for theme application');
      return;
    }

    // Additional safety check
    if (!window.monaco.editor || typeof window.monaco.editor.setTheme !== 'function') {
      console.error('❌ Monaco editor.setTheme is not available');
      return;
    }

    const theme = darkMode ? 'latex-dark' : 'latex-light';
    console.log('🎨 Applying Monaco theme:', theme, 'darkMode:', darkMode);
    
    try {
      // Define themes to ensure they exist
      window.monaco.editor.defineTheme('latex-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '0000FF', fontStyle: 'bold' },
          { token: 'comment', foreground: '008000' },
          { token: 'string', foreground: '800080' },
          { token: 'number', foreground: 'FF0000' },
          { token: 'text', foreground: '000000' },
          { token: 'delimiter.bracket', foreground: '000000' },
          { token: 'delimiter.square', foreground: '000000' },
          { token: 'white', foreground: '000000' },
        ],
        colors: {
          'editor.background': '#FFFFFF',
          'editor.foreground': '#000000',
          'editorLineNumber.foreground': '#999999',
          'editorLineNumber.activeForeground': '#000000',
          'editor.selectionBackground': '#4A90E2',
          'editor.selectionForeground': '#FFFFFF',
          'editor.inactiveSelectionBackground': '#B3D7FF',
          'editor.inactiveSelectionForeground': '#000000',
          'editor.selectionHighlightBackground': '#4A90E240',
          'editor.lineHighlightBackground': '#F0F0F0',
          'editor.lineHighlightBorder': '#F0F0F0',
        }
      });

      window.monaco.editor.defineTheme('latex-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '569CD6', fontStyle: 'bold' },
          { token: 'comment', foreground: '6A9955' },
          { token: 'string', foreground: 'CE9178' },
          { token: 'number', foreground: 'B5CEA8' },
          { token: 'text', foreground: 'D4D4D4' },
          { token: 'delimiter.bracket', foreground: 'D4D4D4' },
          { token: 'delimiter.square', foreground: 'D4D4D4' },
          { token: '', foreground: 'D4D4D4' },
        ],
        colors: {
          'editor.background': '#1E1E1E',
          'editor.foreground': '#D4D4D4',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#C6C6C6',
          'editor.selectionBackground': '#5A9FD4',
          'editor.selectionForeground': '#FFFFFF',
          'editor.inactiveSelectionBackground': '#3A3D41',
          'editor.inactiveSelectionForeground': '#D4D4D4',
          'editor.selectionHighlightBackground': '#5A9FD440',
          'editorCursor.foreground': '#AEAFAD',
          'editorWhitespace.foreground': '#3B3A32',
          'editor.lineHighlightBackground': '#282828',
          'editor.lineHighlightBorder': '#282828',
          'editorGutter.background': '#1E1E1E',
          'editorGutter.modifiedBackground': '#1B81A8',
          'editorGutter.addedBackground': '#629755',
          'editorGutter.deletedBackground': '#CC7832',
          'editorWidget.background': '#252526',
          'editorWidget.foreground': '#CCCCCC',
          'editorSuggestWidget.background': '#252526',
          'editorSuggestWidget.foreground': '#CCCCCC',
        }
      });
      
      // Apply the theme multiple times to ensure it sticks
      window.monaco.editor.setTheme(theme);
      console.log('✅ Theme applied successfully:', theme);
      
      // Force theme application again after a short delay
      setTimeout(() => {
        window.monaco.editor.setTheme(theme);
        console.log('🔄 Theme reapplied after delay');
      }, 50);
      
      // Force layout update
      setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.layout();
          console.log('🔄 Editor layout refreshed after theme change');
        }
      }, 100);
      
    } catch (error) {
      console.error('❌ Error applying Monaco theme:', error);
    }
  }, []);

  // Real-time error checking as user types (faster response)
  const checkErrors = useCallback(debounce((code) => {
    if (!editorRef.current || !monacoRef.current || !code) {
      return;
    }

    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor.getModel();

    if (!model) return;

    // Only check LaTeX files
    if (!currentFile || !currentFile.endsWith('.tex')) {
      // Clear syntax markers for non-LaTeX files
      monaco.editor.setModelMarkers(model, 'latex-syntax', []);
      return;
    }

    // Skip if compilation just ran (compilation errors are more accurate)
    // This is handled by clearing syntax markers when compilation markers are applied

    // Check syntax using lightweight checker
    const syntaxErrors = checkSyntax(code, { file: currentFile });

    // Convert to Monaco markers
    const markers = syntaxErrors.map(err => ({
      startLineNumber: err.line || 1,
      endLineNumber: err.line || 1,
      startColumn: err.column || 1,
      endColumn: err.endColumn || (err.column ? err.column + (err.text?.length || 1) : 1),
      message: err.message,
      severity: err.severity === 'error' 
        ? monaco.MarkerSeverity.Error 
        : monaco.MarkerSeverity.Warning,
      source: 'LaTeX Syntax Checker',
      code: err.category || 'syntax',
      // Store error data for quick fixes
      relatedInformation: err.quickFix ? [{
        resource: model.uri,
        startLineNumber: err.line || 1,
        startColumn: err.column || 1,
        endLineNumber: err.line || 1,
        endColumn: err.endColumn || 1,
        message: `Quick fix available: ${err.quickFix.text}`
      }] : undefined
    }));

    // Apply markers with source 'latex-syntax' (different from compilation markers)
    monaco.editor.setModelMarkers(model, 'latex-syntax', markers);
  }, 300), [currentFile, editorRef, monacoRef]);

  // File loading and saving functions
  // Second arg: AbortSignal or { signal?, cacheBust? }. Use cacheBust when reloading after backend file_saved.
  const loadFileContent = async (filePath, signalOrOptions = null) => {
    let signal = null;
    let cacheBust = false;
    if (signalOrOptions != null) {
      if (typeof signalOrOptions.abort === 'function') {
        signal = signalOrOptions;
      } else if (typeof signalOrOptions === 'object') {
        signal = signalOrOptions.signal ?? null;
        cacheBust = !!signalOrOptions.cacheBust;
      }
    }
    try {
      const requestId = crypto.randomUUID();
      const q = new URLSearchParams({ file: filePath });
      if (cacheBust) q.set('_', String(Date.now()));
      const res = await fetch(`/api/files/${projectId}?${q.toString()}`, {
        cache: 'no-store',
        signal,
        headers: {
          'x-request-id': requestId,
          ...(cacheBust ? { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } : {})
        }
      });
      const data = res.ok ? await res.json() : { content: '' };
      if (data.version) {
        setFileVersion(filePath, data.version);
      }
      return {
        content: data.content || '',
        version: data.version || null
      };
    } catch (error) {
      // Don't log error if it was aborted (expected behavior)
      if (error.name !== 'AbortError') {
        const requestId = error.requestId || 'unknown';
        console.error(`Failed to load file content [${requestId}]:`, error);
      }
      return { content: '', version: null };
    }
  };

  /** Fetch references.bib / reference.bib, parse citation keys, store in citationKeysRef for \\cite{} completion. */
  const refreshCitationKeys = useCallback(async () => {
    if (!projectId) return;
    try {
      let bib = (await loadFileContent('references.bib')).content || '';
      if (!bib.trim()) bib = (await loadFileContent('reference.bib')).content || '';
      const re = /@\w+\s*\{\s*([^,\s\}]+)/g;
      const keys = [];
      let m;
      while ((m = re.exec(bib)) !== null) keys.push(m[1]);
      citationKeysRef.current = [...new Set(keys)];
    } catch (_) {
      citationKeysRef.current = [];
    }
  }, [projectId, loadFileContent]);

  // Save current file content
  // Options:
  //   - forceOverwrite: Skip version check (for AI-applied code that should always save)
  //   - retryOnConflict: Auto-retry with fresh version on conflict (default: true for user/auto-saves)
  //   - maxRetries: Max retry attempts for conflict resolution (default: 2)
  async function saveCurrentFile(filePath, content, options = {}) {
    const { forceOverwrite = false, retryOnConflict = true, maxRetries = 2 } = options;

    if (!filePath) return;
    if (/\.(png|jpe?g|gif|webp|bmp|tiff|svg|pdf|zip|pptx?|docx?|xlsx?|xls)$/i.test(filePath)) {
      console.log(`Skipping text save for non-text file: ${filePath}`);
      return { ok: false, skipped: true, reason: 'non_text_file' };
    }

    // Prevent saving empty content (unless explicitly intended)
    if (!content || content.trim() === '') {
      console.warn(`⚠️ Skipping save - content is empty for ${filePath}`);
      return { ok: false, error: 'Empty content' };
    }

    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const requestId = crypto.randomUUID();
        const isRetry = attempt > 0;
        console.log(`💾 ${isRetry ? 'Retrying' : 'Saving'} file: ${filePath} [${requestId}]${forceOverwrite ? ' (force)' : ''}`);

        // For forceOverwrite, don't send expectedVersion to skip conflict check
        const expectedVersion = forceOverwrite ? null : getFileVersion(filePath);

        const res = await fetch(`/api/files/${projectId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': requestId
          },
          body: JSON.stringify({
            content: content,
            file: filePath,
            expectedVersion: expectedVersion
          })
        });

        if (res.status === 409) {
          const data = await res.json().catch(() => ({}));

          // Update our cached version with server's current version
          if (data.currentVersion) {
            setFileVersion(filePath, data.currentVersion);
          }

          // If retryOnConflict is enabled and we have retries left, retry immediately
          if (retryOnConflict && attempt < maxRetries) {
            console.log(`🔄 Conflict detected, retrying save (attempt ${attempt + 1}/${maxRetries}) [${requestId}]`);
            attempt++;
            // Small delay before retry to allow any pending operations to complete
            await new Promise(resolve => setTimeout(resolve, 100));
            continue;
          }

          // No retry - show conflict to user
          // Reload file to get latest version
          try {
            const { content: latestContent } = await loadFileContent(filePath);
            if (editorRef.current) {
              const model = editorRef.current.getModel();
              if (model && filePath === currentFile) {
                model.setValue(latestContent);
                console.log(`🔄 Reloaded ${filePath} with latest version`);
              }
            }
          } catch (reloadError) {
            console.error(`Failed to reload file after conflict:`, reloadError);
          }

          // Show user-friendly notification
          toast.warning('File was changed on server. Your changes were not saved. Please review the updated content and try again.', { duration: 8000 });

          console.error(`⚠️ Save conflict for ${filePath}: file changed on server [${requestId}]`);
          return { ok: false, conflict: true };
        }

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.version) {
            setFileVersion(filePath, data.version);
          }
          if (filePath.toLowerCase().endsWith('.bib')) {
            refreshCitationKeys().catch(() => {});
          }
          console.log(`✅ Saved: ${filePath} [${requestId}]`);
          return { ok: true, version: data.version };
        }

        console.error(`❌ Failed to save ${filePath}: ${res.status} [${requestId}]`);
        return { ok: false };
      } catch (error) {
        const requestId = error.requestId || 'unknown';
        console.error(`❌ Failed to save ${filePath} [${requestId}]:`, error);
        return { ok: false };
      }
    }

    return { ok: false, error: 'Max retries exceeded' };
  }

  // ============================================================
  // reloadFileWithUndo - Reload file content preserving undo history
  // Used when AI backend modifies a file - applies changes as undoable edit
  // options.fromServer: use cache-bust so we get fresh content after backend write
  // ============================================================
  const reloadFileWithUndo = useCallback(async (filePath, options = {}) => {
    const normalizedPath = normalizeFilePathUtil(filePath);
    if (!normalizedPath) return false;

    // Only works if this is the currently open file
    if (normalizedPath !== currentFile) {
      console.log(`📄 File ${normalizedPath} is not currently open, using standard reload`);
      return false;
    }

    if (!editorRef.current || !monacoRef.current) {
      console.warn('⚠️ Editor not ready for undo-preserving reload');
      return false;
    }

    try {
      // Fetch the new content from server (cacheBust when reloading after backend file_saved)
      const { content: newContent, version } = await loadFileContent(normalizedPath, {
        cacheBust: !!options.fromServer
      });

      const editor = editorRef.current;
      const model = editor.getModel();

      if (!model) {
        console.warn('⚠️ No model available for undo-preserving reload');
        return false;
      }

      const currentContent = model.getValue();

      // If content is the same, nothing to do
      if (currentContent === newContent) {
        console.log('📄 File content unchanged, skipping reload');
        return true;
      }

      // Apply the change as an undoable edit
      // This replaces the entire document content but keeps it in the undo stack
      const fullRange = model.getFullModelRange();

      editor.executeEdits('ai-file-reload', [{
        range: fullRange,
        text: newContent,
        forceMoveMarkers: true
      }]);

      // Update version tracking
      if (version) {
        setFileVersion(normalizedPath, version);
      }

      // Update React state
      setContent(newContent);

      console.log('✅ Reloaded file with undo support:', normalizedPath);
      return true;
    } catch (error) {
      console.error('❌ Failed to reload file with undo:', error);
      return false;
    }
  }, [currentFile, loadFileContent, setFileVersion]);

  // Ref for reloadFileWithUndo so it can be used in event handlers
  const reloadFileWithUndoRef = useRef(null);
  useEffect(() => {
    reloadFileWithUndoRef.current = reloadFileWithUndo;
  }, [reloadFileWithUndo]);

  // ============================================================
  // loadFile - Direct API approach for reliable file switching
  // Uses loadFileContent directly, disposes stale Monaco models
  // ============================================================
  const loadFile = useCallback(async (filePath, options = {}) => {
    const normalizedPath = normalizeFilePathUtil(filePath);
    
    if (!normalizedPath) {
      console.warn('⚠️ Cannot load file: empty file path');
      return false;
    }

    // Cancel any in-flight load
    if (loadAbortControllerRef.current) {
      loadAbortControllerRef.current.abort();
      loadAbortControllerRef.current = null;
    }
    
    const abortController = new AbortController();
    loadAbortControllerRef.current = abortController;
    loadingFileRef.current = normalizedPath;
    setIsLoadingFile(true);
    
    try {
      // Save current file before switching (if different file and we have content)
      if (currentFile && normalizedPath !== currentFile && editorRef.current) {
        const editor = editorRef.current;
        const model = editor.getModel();
        if (model) {
          const modelPath = model.uri.path.replace(/^\//, '');
          if (modelPath === currentFile.replace(/\\/g, '/')) {
            const currentContent = editor.getValue();
            if (currentContent && currentContent.trim()) {
              await saveCurrentFile(currentFile, currentContent);
            }
          }
        }
      }
      
      // Clear any pending auto-save
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      
      // Load file content directly from API (cacheBust when reloading after backend file_saved)
      const { content: fileContent } = await loadFileContent(normalizedPath, {
        signal: abortController.signal,
        cacheBust: !!options.fromServer
      });
      
      // Stale load - user switched again
      if (abortController.signal.aborted || loadingFileRef.current !== normalizedPath) {
        return false;
      }
      
      if (!editorRef.current || !monacoRef.current) {
        return false;
      }
      
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      
      // Dispose ALL other Monaco models to prevent stale content / memory issues
      const currentUri = monaco.Uri.parse(`file:///${normalizedPath}`);
      const allModels = monaco.editor.getModels();
      for (const m of allModels) {
        if (m.uri.toString() !== currentUri.toString()) {
          m.dispose();
        }
      }
      
      // Dispose existing model for this file if any, then create fresh one
      const existingModel = monaco.editor.getModel(currentUri);
      if (existingModel) {
        existingModel.dispose();
      }
      
      const language = getLanguageFromFile(normalizedPath);
      const model = monaco.editor.createModel(fileContent ?? '', language, currentUri);
      editor.setModel(model);
      
      // Update state
      setContent(fileContent ?? '');
      setCurrentFile(normalizedPath);
      
      if (normalizedPath.endsWith('.tex')) {
        setTimeout(() => checkErrors(fileContent ?? ''), 100);
      }
      
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Failed to load file:', error);
      }
      return false;
    } finally {
      if (loadingFileRef.current === normalizedPath) {
        loadingFileRef.current = null;
        loadAbortControllerRef.current = null;
        setIsLoadingFile(false);
      }
    }
  }, [currentFile, projectId, loadFileContent, saveCurrentFile, getLanguageFromFile, checkErrors]);

  // Update loadFileRef when loadFile changes
  useEffect(() => {
    loadFileRef.current = loadFile;
  }, [loadFile]);

  // Check AI generation status on mount - show loading if generation is in progress
  // Skip when aiGenerating=true (we already show loading; AIGenerationLoading handles polling)
  useEffect(() => {
    if (aiGeneratingParam) {
      aiStatusCheckedRef.current = true;
      setAiStatusResolving(false);
      return; // AIGenerationLoading is already shown and will poll
    }

    const checkAIStatus = async () => {
      setAiStatusResolving(true);
      try {
        const response = await fetch(`/api/projects/${projectId}/ai-status`);
        if (response.ok) {
          const data = await response.json();
          const statusValue = String(data.status || '').toLowerCase();
          const isNotReady = statusValue === 'not_ready' && data.retriable === true;

          // Show loading screen if generation is actively in progress
          if (
            (data.hasAIGeneration && (statusValue === 'in_progress' || statusValue === 'processing' || statusValue === 'pending')) ||
            isNotReady
          ) {
            setShowAILoading(true);
            console.log('✅ AI generation in progress, showing loading screen', data);
            router.replace(`/editor/${projectId}?aiGenerating=true`, { scroll: false });
          } else {
            console.log('ℹ️  AI generation not active (status:', data.status, ')');
            setShowAILoading(false);
            if (searchParams.get('aiGenerating') === 'true') {
              router.replace(`/editor/${projectId}`, { scroll: false });
            }
          }
        } else {
          console.log('ℹ️  AI status API error', response.status);
          setShowAILoading(false);
        }
      } catch (error) {
        console.error('Error checking AI status:', error);
        setShowAILoading(false);
      } finally {
        aiStatusCheckedRef.current = true;
        setAiStatusResolving(false);
      }
    };

    checkAIStatus();
  }, [projectId, router, searchParams, aiGeneratingParam]);

  useEffect(() => {
    if (showAILoading || aiStatusResolving) return;
    let disposed = false;

    /** Flatten tree from /api/files/[projectId]/tree to list of file paths */
    function flattenFilePaths(items) {
      if (!items || !Array.isArray(items)) return [];
      const paths = [];
      for (const item of items) {
        if (item.type === 'file') paths.push(item.path);
        else if (item.children) paths.push(...flattenFilePaths(item.children));
      }
      return paths;
    }

    /** Resolve initial LaTeX file: main.tex if present, else cached last-tex for project, else first .tex */
    async function resolveInitialLaTeXFile() {
      try {
        const res = await fetch(`/api/files/${projectId}/tree`);
        if (!res.ok) return null;
        const { files } = await res.json();
        const allPaths = flattenFilePaths(files);
        const texPaths = allPaths.filter(p => p.toLowerCase().endsWith('.tex')).sort();
        if (texPaths.length === 0) return null;
        if (texPaths.includes('main.tex')) return 'main.tex';
        try {
          const cached = typeof localStorage !== 'undefined' && localStorage.getItem(`genlatex-last-tex-${projectId}`);
          if (cached && texPaths.includes(cached)) return cached;
        } catch (e) { /* ignore */ }
        return texPaths[0];
      } catch (e) {
        console.warn('Failed to resolve initial LaTeX file:', e);
        return null;
      }
    }

    async function init() {
      setLoading(true);
      
      // Load project metadata first to determine editor type
      const metadata = await loadProjectMetadata();
      const editorType = metadata?.editor || 'latex';
      const fileName = editorType === 'tiptap' ? 'main.md' : await resolveInitialLaTeXFile();
      
      if (editorType === 'latex') {
        // Wait for DOM element to be available
        const container = document.getElementById('monaco-container');
        if (!container) {
          setTimeout(init, 100);
          return;
        }
        
        const monaco = await import('monaco-editor');
        monacoRef.current = monaco;
        if (disposed) return;
        
        refreshCitationKeys().catch(() => {});
        
        // Disable Monaco's default worker-based language services to prevent "Unexpected usage" errors
        // These services aren't needed for LaTeX editing
        monaco.languages.typescript?.typescriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
        monaco.languages.typescript?.javascriptDefaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
        monaco.languages.json?.jsonDefaults?.setDiagnosticsOptions({ enableSchemaRequest: false });
        
        // Load the initial file content (or empty if no .tex in project)
        const initialContent = fileName
          ? (await loadFileContent(fileName)).content ?? ''
          : '';
        console.log(`📂 Loading initial file: ${fileName ?? '(none - no .tex in project)'}`);
        setContent(initialContent);
        setCurrentFile(fileName);
        if (fileName && fileName.endsWith('.tex')) {
          setCompileTarget(fileName);
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem(`genlatex-last-tex-${projectId}`, fileName);
          } catch (e) { /* ignore */ }
        } else {
          setCompileTarget(null);
        }
      
      console.log('🎨 Creating Monaco editor...');
      
      // CRITICAL: Dispose ALL existing Monaco models on initialization to prevent stale content
      // This is especially important for hot reloads in development
      const existingModels = monaco.editor.getModels();
      if (existingModels.length > 0) {
        console.log(`🗑️ Disposing ${existingModels.length} stale model(s) on initialization`);
        existingModels.forEach(model => model.dispose());
      }
      
      // Apply theme first to ensure it's defined
      applyMonacoTheme(isDarkMode);
      
      const editorTheme = isDarkMode ? 'latex-dark' : 'latex-light';
      console.log('🎨 Creating Monaco editor with theme:', editorTheme, 'isDarkMode:', isDarkMode);
      
      // Create fresh model for initial file with URI (or untitled when no .tex in project)
      const effectivePath = fileName || 'untitled.tex';
      const fileUri = monaco.Uri.parse(`file:///${effectivePath}`);
      const initialLanguage = getLanguageFromFile(effectivePath);
      
      // Always create a fresh model (we already disposed any stale ones above)
      console.log('📄 Creating fresh model for:', fileName ?? '(untitled)', '(content length:', initialContent.length, ')');
      const initialModel = monaco.editor.createModel(initialContent, initialLanguage, fileUri);
      
      const editor = monaco.editor.create(container, {
        model: initialModel,
        theme: editorTheme,
        automaticLayout: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        readOnly: false,
        scrollBeyondLastLine: false,
        fontSize: 14,
        tabSize: 2,
        insertSpaces: true,
        lineNumbers: 'on',
        glyphMargin: true, // Enable glyph margin for error markers
        bracketPairColorization: { enabled: true },
        guides: {
          bracketPairs: true,
          indentation: true
        },
        // Enhanced LaTeX-specific settings
        suggest: {
          showKeywords: true,
          showSnippets: true,
          showFunctions: true,
          showConstructors: true,
          showFields: true,
          showVariables: true,
          showClasses: true,
          showStructs: true,
          showInterfaces: true,
          showModules: true,
          showProperties: true,
          showEvents: true,
          showOperators: true,
          showUnits: true,
          showValues: true,
          showConstants: true,
          showEnums: true,
          showEnumMembers: true,
          showColors: true,
          showFiles: true,
          showReferences: true,
          showFolders: true,
          showTypeParameters: true,
          showIssues: true,
          showUsers: true,
          showWords: true
        },
        quickSuggestions: {
          other: true,
          comments: false,
          strings: true
        },
        parameterHints: {
          enabled: true
        },
        hover: {
          enabled: true
        },
        folding: {
          enabled: true
        },
        renderWhitespace: 'selection',
        renderControlCharacters: true,
        cursorBlinking: 'blink',
        cursorSmoothCaretAnimation: true,
        smoothScrolling: true
      });
      
      editorRef.current = editor;

      // Clear any previous disposables
      disposablesRef.current.forEach(d => {
        try {
          if (d && typeof d.dispose === 'function') {
            d.dispose();
          }
        } catch (err) {
          console.error('Error disposing:', err);
        }
      });
      disposablesRef.current = [];

       // Verify editor has the required methods
       if (!editor || typeof editor.onDidChangeCursorSelection !== 'function') {
         console.error('❌ Editor does not have onDidChangeCursorSelection method. Editor:', editor);
         console.error('❌ Available methods:', Object.keys(editor || {}));
         return;
       }

       console.log('✅ Monaco editor created successfully with required methods');

       // Add selection change listener to track selections AND cursor position
       try {
         const selectionDisposable = editor.onDidChangeCursorSelection((e) => {
          try {
            const selection = editor.getSelection();
            const model = editor.getModel();
            if (!model) return;

            const selectedText = model.getValueInRange(selection) || '';

            // Always update cursor position (where the cursor currently is)
            const cursorPos = editor.getPosition();
            if (cursorPos) {
              // Get the text content around cursor for context
              const lineContent = model.getLineContent(cursorPos.lineNumber) || '';
              const textBeforeCursor = lineContent.substring(0, cursorPos.column - 1);
              const textAfterCursor = lineContent.substring(cursorPos.column - 1);

              setCursorPosition({
                lineNumber: cursorPos.lineNumber,
                column: cursorPos.column,
                // Also include character offset from start of document
                offset: model.getOffsetAt(cursorPos),
                // Context around cursor
                lineContent: lineContent,
                textBeforeCursor: textBeforeCursor,
                textAfterCursor: textAfterCursor
              });
            }

            // Update selection state
            if (selectedText.trim() && selectedText !== '') {
              setSelectedText(selectedText);
              setSelectionRange(selection);
            } else {
              setSelectedText('');
              setSelectionRange(null);
            }
          } catch (error) {
            console.error('Error in onDidChangeSelection handler:', error);
          }
         });

         if (selectionDisposable) {
           disposablesRef.current.push(selectionDisposable);
           console.log('✅ Selection and cursor position listener registered');
         }
       } catch (error) {
         console.error('❌ Failed to register onDidChangeCursorSelection:', error);
       }
      
      // Add context menu (right-click) handler
      const editorDiv = container.querySelector('.monaco-editor');
      if (editorDiv) {
        editorDiv.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          if (!currentFile || !currentFile.toLowerCase().endsWith('.tex')) {
            return;
          }
          const selection = editor.getSelection();
          const selectedText = editor.getModel()?.getValueInRange(selection) || '';

          console.log('🖱️ Right-click context menu triggered:', {
            hasSelection: !!selectedText.trim(),
            selectionLength: selectedText.length,
            selectionPreview: selectedText.substring(0, 50),
            selection
          });

          if (selectedText.trim()) {
            setShowContextMenu(true);
            setContextMenuPosition({ x: e.clientX, y: e.clientY });
            setSelectedText(selectedText);
            setSelectionRange(selection);
            console.log('✅ Selection stored in state');
          }
        });
      }
      
      // Add content change listener for smart error removal and auto-save
      try {
        const contentChangeDisposable = editor.onDidChangeModelContent((e) => {
          try {
            const val = editor.getValue();
            setContent(val);
        
        // Check for errors in real-time (immediate response)
        checkErrors(val);
        
        // Smart error removal logic
        e.changes.forEach(change => {
          const changedLine = change.range.startLineNumber;
          
          // Clear markers on edited lines - they will be re-applied on next compilation
          // This prevents stale error markers from showing after user fixes the error
          const model = editor.getModel();
          if (model) {
            const markers = monaco.editor.getModelMarkers({ resource: model.uri });
            const markersOnLine = markers.filter(m => 
              m.startLineNumber === changedLine || m.endLineNumber === changedLine
            );
            
            if (markersOnLine.length > 0) {
              // Clear markers on edited lines - they'll be refreshed on next check/compilation
              const currentMarkers = monaco.editor.getModelMarkers({ resource: model.uri });
              
              // Clear compilation markers on this line
              const compilationMarkersToKeep = currentMarkers.filter(m => 
                (m.startLineNumber !== changedLine && m.endLineNumber !== changedLine) ||
                m.source !== 'latex-compilation'
              );
              monaco.editor.setModelMarkers(model, 'latex-compilation', compilationMarkersToKeep);
              
              // Clear syntax markers on this line
              const syntaxMarkersToKeep = currentMarkers.filter(m => 
                (m.startLineNumber !== changedLine && m.endLineNumber !== changedLine) ||
                m.source !== 'LaTeX Syntax Checker'
              );
              monaco.editor.setModelMarkers(model, 'latex-syntax', syntaxMarkersToKeep);
            }
          }
        });
        
        // Auto-save with debouncing (only if not loading a file and not skipped)
        if (autoSaveEnabled && currentFile && !isLoadingFile && !skipAutoSaveRef.current && !loading) {
          if (autoSaveTimeoutRef.current) {
            clearTimeout(autoSaveTimeoutRef.current);
          }

          // CRITICAL: Capture current file at timeout creation time
          // This prevents saving content to the wrong file if user switches files during the timeout
          const fileAtSaveStart = currentFile;

          autoSaveTimeoutRef.current = setTimeout(async () => {
            // Check again if we should skip (might have been updated during timeout)
            if (skipAutoSaveRef.current) {
              console.log('⏭️ Skipping auto-save - programmatic update in progress');
              return;
            }

            try {
              // CRITICAL: Check if file changed during timeout window
              // If user switched files, do NOT save - the content in the editor is for a different file
              if (fileAtSaveStart !== currentFile) {
                console.log(`⏭️ Skipping auto-save - file changed from ${fileAtSaveStart} to ${currentFile}`);
                return;
              }

              const model = editor.getModel();
              if (fileAtSaveStart && editorRef.current && model) {
                // CRITICAL: Verify model URI matches the file we're trying to save
                const modelUri = model.uri.toString();
                const expectedUri = `file:///${fileAtSaveStart}`;
                
                if (modelUri !== expectedUri) {
                  console.error(`❌ AUTO-SAVE MODEL URI MISMATCH! Not saving to prevent corruption.`);
                  console.error(`   Expected URI: ${expectedUri}`);
                  console.error(`   Actual URI: ${modelUri}`);
                  return;
                }
                
                const contentToSave = editor.getValue();
                // Don't save if content is empty
                if (!contentToSave || contentToSave.trim() === '') {
                  console.log('⏭️ Skipping auto-save - content is empty');
                  return;
                }
                await saveCurrentFile(fileAtSaveStart, contentToSave);
                console.log(`💾 Auto-saved: ${fileAtSaveStart}`);
              }
            } catch (error) {
              console.error('Auto-save failed:', error);
            }
          }, AUTO_SAVE_DELAY_MS); // Auto-save after configured delay
        } else if (skipAutoSaveRef.current) {
          console.log('⏭️ Skipping auto-save - programmatic update in progress');
        }

        // Debounced auto-compile on edit (only for LaTeX files when auto-compile is enabled)
        if (autoCompileEnabled && currentFile && currentFile.endsWith('.tex') && !isLoadingFile && !skipAutoSaveRef.current) {
          if (autoCompileTimeoutRef.current) {
            clearTimeout(autoCompileTimeoutRef.current);
          }
          
          // Capture current file in closure to check later
          const fileAtTimeoutStart = currentFile;
          
          autoCompileTimeoutRef.current = setTimeout(async () => {
            // Check conditions again after the delay
            if (skipAutoSaveRef.current || !autoCompileEnabled) {
              autoCompileTimeoutRef.current = null;
              return;
            }

            // Only compile if this is still the same LaTeX file and we're not already compiling
            if (fileAtTimeoutStart && fileAtTimeoutStart.endsWith('.tex') && 
                fileAtTimeoutStart === currentFile && 
                !compilationInProgressRef.current) {
              
              // Check minimum interval since last compilation
              const timeSinceLastCompile = Date.now() - lastCompileTimeRef.current;
              if (timeSinceLastCompile < MIN_COMPILE_INTERVAL_MS) {
                console.log(`⏸️ Auto-compile skipped - too soon since last compile (${Math.round(timeSinceLastCompile / 1000)}s ago)`);
                autoCompileTimeoutRef.current = null;
                return;
              }
              
              console.log('🔄 Auto-compile triggered by edit');
              compile();
            }
            autoCompileTimeoutRef.current = null;
          }, AUTO_COMPILE_DELAY_MS); // Auto-compile after configured delay (2 seconds)
        }
          } catch (error) {
            console.error('Error in onDidChangeModelContent handler:', error);
          }
        });

        if (contentChangeDisposable) {
          disposablesRef.current.push(contentChangeDisposable);
          console.log('✅ Content change listener registered');
        }
      } catch (error) {
        console.error('❌ Failed to register onDidChangeModelContent:', error);
      }

      // Force theme application after editor creation
      setTimeout(() => {
        console.log('🎨 Force applying theme after editor creation');
        applyMonacoTheme(isDarkMode);
      }, 100);
      
      // Set up keyboard shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        compile();
      });
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
        insertLaTeXCommand('textbf', 'bold text');
      });
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
        insertLaTeXCommand('textit', 'italic text');
      });
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU, () => {
        insertLaTeXCommand('underline', 'underlined text');
      });
      
      // Undo/Redo shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
        editor.trigger('keyboard', 'undo', null);
      });
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY, () => {
        editor.trigger('keyboard', 'redo', null);
      });
      
      // Search and Replace shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
        editor.trigger('keyboard', 'actions.find', null);
      });
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
        editor.trigger('keyboard', 'editor.action.startFindReplaceAction', null);
      });
      
      // Register LaTeX language with enhanced syntax highlighting
      monaco.languages.register({ id: 'latex' });
      
      // Define LaTeX tokens for syntax highlighting
      monaco.languages.setMonarchTokensProvider('latex', {
        tokenizer: {
          root: [
            // Comments (green) - must come first
            [/%.*$/, 'comment'],
            
            // LaTeX commands (blue) - \command or \command[opt]{arg}
            [/\\[a-zA-Z@]+/, 'keyword'],
            
            // Math mode delimiters (blue)
            [/\$\$/, 'keyword'],
            [/\$/, 'keyword'],
            
            // Environments (blue)
            [/\\begin\{[^}]+\}/, 'keyword'],
            [/\\end\{[^}]+\}/, 'keyword'],
            
            // Special LaTeX characters (blue)
            [/\\[{}&%#_]/, 'keyword'],
            
            // Curly braces (black)
            [/[{}]/, 'delimiter.bracket'],
            
            // Square brackets (black)
            [/[\[\]]/, 'delimiter.square'],
            
            // Numbers (red)
            [/\d+/, 'number'],
            
            // Strings in quotes (purple)
            [/"[^"]*"/, 'string'],
            [/'[^']*'/, 'string'],
            
            // Regular text (black) - catch all
            [/[^\s\\%{}[\]$"']+/, 'text'],
            
            // Whitespace
            [/\s+/, 'white'],
          ]
        }
      });
      
      // Add LaTeX snippets and \cite{} completion
      monaco.languages.registerCompletionItemProvider('latex', {
        triggerCharacters: ['\\', '{', ','],
        provideCompletionItems: (model, position) => {
          const line = model.getLineContent(position.lineNumber) || '';
          const textBefore = line.substring(0, position.column - 1);
          const suggestions = [];
          const citeMatch = textBefore.match(/\\cite\s*\{([^}]*)$/);
          const inCite = !!citeMatch;
          const citePrefix = (citeMatch && citeMatch[1]) || '';
          if (inCite && citationKeysRef.current) {
            const keys = citationKeysRef.current.filter(k => k.toLowerCase().startsWith(citePrefix.toLowerCase()));
            for (const key of keys) {
              suggestions.push({
                label: key,
                kind: monaco.languages.CompletionItemKind.Reference,
                insertText: key,
                documentation: `Cite ${key}`
              });
            }
          }
          const snippets = [
            { label: 'documentclass', insert: '\\documentclass{${1:article}}\n\\usepackage[utf8]{inputenc}\n\\title{${2:Title}}\n\\author{${3:Author}}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n${4}\n\n\\end{document}', doc: 'Complete LaTeX document structure' },
            { label: 'section', insert: '\\section{${1:Section Title}}\n\n${2}', doc: 'Section heading' },
            { label: 'subsection', insert: '\\subsection{${1:Subsection Title}}\n\n${2}', doc: 'Subsection heading' },
            { label: 'figure', insert: '\\begin{figure}[h!]\n\\centering\n\\includegraphics[width=${1:0.8\\textwidth}]{${2:images/example.png}}\n\\caption{${3:Caption}}\n\\label{fig:${4:label}}\n\\end{figure}', doc: 'Figure environment' },
            { label: 'table', insert: '\\begin{table}[h!]\n\\centering\n\\caption{${1:Caption}}\n\\begin{tabular}{${2:c|c}}\n\\hline\n${3:Header 1} & ${4:Header 2} \\\\\n\\hline\n${5:Data 1} & ${6:Data 2} \\\\\n\\hline\n\\end{tabular}\n\\end{table}', doc: 'Table environment' },
            { label: 'equation', insert: '\\begin{equation}\n${1}\n\\end{equation}', doc: 'Numbered equation' },
            { label: 'itemize', insert: '\\begin{itemize}\n\\item ${1:First item}\n\\item ${2:Second item}\n\\end{itemize}', doc: 'Bullet list' },
            { label: 'enumerate', insert: '\\begin{enumerate}\n\\item ${1:First item}\n\\item ${2:Second item}\n\\end{enumerate}', doc: 'Numbered list' },
            { label: 'abstract', insert: '\\begin{abstract}\n${1}\n\\end{abstract}', doc: 'Abstract environment' },
            { label: 'cite', insert: '\\cite{${1:key}}', doc: 'Citation' },
            { label: 'ref', insert: '\\ref{${1:label}}', doc: 'Reference to label' },
            { label: 'label', insert: '\\label{${1:sec:label}}', doc: 'Label' },
            { label: 'textbf', insert: '\\textbf{${1:text}}', doc: 'Bold text' },
            { label: 'textit', insert: '\\textit{${1:text}}', doc: 'Italic text' },
            { label: 'emph', insert: '\\emph{${1:text}}', doc: 'Emphasized text' },
            { label: 'bibliography', insert: '\\bibliography{${1:references}}\n\\bibliographystyle{${2:plain}}', doc: 'Bibliography' },
            { label: 'includegraphics', insert: '\\includegraphics[width=${1:0.8\\textwidth}]{${2:path}}', doc: 'Include image' },
            { label: 'include', insert: '\\include{${1:file}}', doc: 'Include file' },
            { label: 'input', insert: '\\input{${1:file}}', doc: 'Input file' }
          ];
          for (const s of snippets) {
            suggestions.push({
              label: s.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: s.insert,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: s.doc
            });
          }
          return { suggestions };
        }
      });
      
      // Register code action provider for quick fixes and AI fixes
      monaco.languages.registerCodeActionProvider('latex', {
        provideCodeActions: async (model, range, context) => {
          const actions = [];
          const markers = context.markers || [];
          
          // Get all errors/warnings at cursor/selection
          for (const marker of markers) {
            // Only process our markers (syntax and compilation)
            if (marker.source !== 'LaTeX Syntax Checker' && marker.source !== 'latex-compilation') {
              continue;
            }
            
            // Reconstruct error object from marker
            const error = {
              type: marker.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
              severity: marker.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
              engine: marker.source === 'LaTeX Syntax Checker' ? 'syntax-checker' : 'pdflatex',
              message: marker.message,
              line: marker.startLineNumber,
              column: marker.startColumn,
              endColumn: marker.endColumn,
              category: marker.code || 'syntax',
              text: null,
              file: currentFile
            };
            
            const code = model.getValue();
            
            // Get quick fixes for simple errors
            const quickFixes = getQuickFixes(error, code, marker.startLineNumber, model);
            quickFixes.forEach(fix => {
              actions.push({
                title: fix.title,
                kind: 'quickfix',
                isPreferred: fix.isPreferred || false,
                edit: fix.edit,
                diagnostics: [marker]
              });
            });
            
            // For complex errors, add AI fix option
            if (needsAIFix(error) && projectId) {
              // Add AI fix action (will be loaded asynchronously)
              actions.push({
                title: '🤖 AI Smart Fix',
                kind: 'quickfix',
                isPreferred: false,
                command: {
                  id: 'ai-fix-error',
                  title: 'Get AI fix for this error',
                  arguments: [error, code, { projectId, filePath: currentFile }]
                },
                diagnostics: [marker]
              });
            }
          }
          
          return {
            actions: actions,
            dispose: () => {}
          };
        },
        resolveCodeAction: async (codeAction, token) => {
          // If this is an AI fix command, resolve it
          if (codeAction.command && codeAction.command.id === 'ai-fix-error') {
            try {
              const [error, code, context, modelUri] = codeAction.command.arguments;
              const aiFix = await getAIFix(error, code, context, modelUri);
              
              // Replace command with actual edit
              return {
                ...codeAction,
                edit: aiFix.edit,
                command: undefined
              };
            } catch (err) {
              console.error('❌ Error resolving AI fix:', err);
              // Return original action with error message
              return {
                ...codeAction,
                title: '❌ AI Fix Failed: ' + err.message
              };
            }
          }
          
          return codeAction;
        }
      });
      
      // Store monaco reference globally for toolbar access
      if (typeof window !== 'undefined') {
        window.monaco = monaco;
      }
      
      // Test error detection immediately after editor is ready
      setTimeout(() => {
        if (editorRef.current) {
          const currentContent = editorRef.current.getValue();
          console.log('Testing error detection with initial content');
          checkErrors(currentContent);
        }
      }, 1000);
      
      } else {
        // Initialize Tiptap editor - load file directly from API
        console.log(`📂 Loading initial file for Tiptap: ${fileName}`);
        const { content: initialContent } = await loadFileContent(fileName);
        setContent(initialContent ?? '');
        setCurrentFile(fileName);
      }
      
      setLoading(false);
    }
    
    // Small delay to ensure DOM is ready
    const timer = setTimeout(init, 100);
    return () => {
      clearTimeout(timer);
      disposed = true;

      // Dispose all Monaco listeners
      disposablesRef.current.forEach(d => {
        try {
          d.dispose();
        } catch (error) {
          console.error('Error disposing listener:', error);
        }
      });
      disposablesRef.current = [];

      // Dispose editor
      if (editorRef.current) {
        try {
          // Save current file before disposing
          const currentFileToSave = currentFile;
          const model = editorRef.current.getModel();
          
          // CRITICAL: Verify model URI matches before saving to prevent corruption
          if (model && currentFileToSave) {
            const modelUri = model.uri.toString();
            const expectedUri = `file:///${currentFileToSave}`;
            
            if (modelUri === expectedUri) {
              const currentContent = editorRef.current.getValue();
              if (currentContent !== undefined && currentContent !== null) {
                // Use a synchronous approach for cleanup - save without await
                saveCurrentFile(currentFileToSave, currentContent).catch(err => {
                  console.error('Failed to save file on cleanup:', err);
                });
              }
            } else {
              console.error(`❌ CLEANUP MODEL URI MISMATCH! Not saving to prevent corruption.`);
              console.error(`   Expected: ${expectedUri}, Got: ${modelUri}`);
            }
          }
          editorRef.current.dispose();
        } catch (error) {
          console.error('Error disposing editor:', error);
        }
        editorRef.current = null;
      }
      
      // CRITICAL: Dispose ALL Monaco models on unmount to prevent stale content on remount
      if (monacoRef.current) {
        try {
          const models = monacoRef.current.editor.getModels();
          console.log(`🗑️ Disposing ${models.length} model(s) on unmount`);
          models.forEach(model => model.dispose());
        } catch (error) {
          console.error('Error disposing models:', error);
        }
        monacoRef.current = null;
      }
    };
  }, [projectId, showAILoading, aiStatusResolving]);

  // Save file on page unload/beforeunload
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (currentFile && editorRef.current && !isLoadingFile) {
        const editor = editorRef.current;
        const model = editor.getModel();
        
        // CRITICAL: Verify model URI matches currentFile before saving
        if (model) {
          const modelUri = model.uri.toString();
          const expectedUri = `file:///${currentFile}`;
          
          if (modelUri !== expectedUri) {
            console.error(`❌ BEFOREUNLOAD MODEL URI MISMATCH! Not saving to prevent corruption.`);
            return;
          }
        }
        
        const content = editor.getValue();
        if (content !== undefined && content !== null) {
          // Use sendBeacon for reliable save on page unload
          const expectedVersion = getFileVersion(currentFile);
          const blob = new Blob([JSON.stringify({ 
            content: content,
            file: currentFile,
            expectedVersion: expectedVersion
          })], { type: 'application/json' });
          navigator.sendBeacon(`/api/files/${projectId}`, blob);
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentFile, projectId, isLoadingFile]);

  // Log memory JSON and hashes for debugging
  useEffect(() => {
    if (!projectId) return;

    async function logMemoryData() {
      // Memory system removed - no memory data to fetch
      console.log('⚠️ Memory system removed - no memory data available');
    }

    // Delay slightly to ensure project is loaded
    const timeoutId = setTimeout(logMemoryData, 2000);
    
    return () => clearTimeout(timeoutId);
  }, [projectId, currentFile]);

  // Update Monaco editor theme when dark mode changes
  useEffect(() => {
    console.log('🎨 Dark mode changed to:', isDarkMode);
    
    // Immediate theme application
    applyMonacoTheme(isDarkMode);
    
    // Multiple delayed applications to ensure it sticks
    const timeouts = [100, 300, 500, 1000, 2000];
    timeouts.forEach(delay => {
      setTimeout(() => {
        applyMonacoTheme(isDarkMode);
      }, delay);
    });
  }, [isDarkMode, applyMonacoTheme]);

  // Periodic theme reapplication to ensure it stays applied
  useEffect(() => {
    if (!editorRef.current || typeof window === 'undefined' || !window.monaco) return;
    
    const reapplyTheme = () => {
      try {
        console.log('🔄 Periodically reapplying theme for darkMode:', isDarkMode);
        applyMonacoTheme(isDarkMode);
      } catch (error) {
        console.error('❌ Error in periodic theme reapplication:', error);
      }
    };
    
    const interval = setInterval(reapplyTheme, 5000); // Reapply every 5 seconds
    
    return () => clearInterval(interval);
  }, [isDarkMode, applyMonacoTheme]);

  // Auto-compile on page load (only once, only for LaTeX files)
  useEffect(() => {
    // Only compile once per page load, when loading is complete, editor is ready, and file is LaTeX
    if (!loading && editorRef.current && isCurrentFileLaTeX() && !hasCompiledOnLoadRef.current) {
      // Prevent multiple triggers by marking as compiled immediately
      hasCompiledOnLoadRef.current = true;

      const clearInitialCompilationDiagnostics = () => {
        // Clear stale diagnostics so an existing valid PDF isn't blocked by old errors.
        setCompilationErrors([]);
        setCompilationWarnings([]);
        setAllErrors([]);
        setErrorGroups([]);
        setCompilationMessage('');

        if (editorRef.current && monacoRef.current) {
          const model = editorRef.current.getModel();
          if (model) {
            monacoRef.current.editor.setModelMarkers(model, 'latex-compilation', []);
            monacoRef.current.editor.setModelMarkers(model, 'latex-syntax', []);
          }
        }
      };
      
      // Check status first; if any PDF already exists, show it immediately.
      // This avoids transient first-load compile failures right after AI generation.
      const compileOnLoad = async () => {
        if (compilationInProgressRef.current) {
          console.log('⏸️ Compilation already in progress on page load, skipping');
          return;
        }
        try {
          const res = await fetch(`/api/compile/${projectId}/status?target=${encodeURIComponent(compileTarget)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.pdfExists) {
              setPdfExists(true);
              clearInitialCompilationDiagnostics();
              return;
            }
          }
        } catch (err) {
          console.warn('Status check failed, will compile:', err?.message);
        }
        await compile();
      };
      
      // Small delay to ensure everything is initialized
      const timeoutId = setTimeout(() => {
        compileOnLoad();
      }, 500);
      
      return () => clearTimeout(timeoutId);
    }
  }, [loading, projectId, compileTarget, currentFile, isCurrentFileLaTeX]);

  // Cleanup auto-compile timeout when file changes or component unmounts
  useEffect(() => {
    return () => {
      if (autoCompileTimeoutRef.current) {
        clearTimeout(autoCompileTimeoutRef.current);
        autoCompileTimeoutRef.current = null;
      }
    };
  }, [currentFile]); // Cleanup when file changes

  // Cleanup auto-compile timeout when auto-compile is disabled
  useEffect(() => {
    if (!autoCompileEnabled && autoCompileTimeoutRef.current) {
      clearTimeout(autoCompileTimeoutRef.current);
      autoCompileTimeoutRef.current = null;
    }
  }, [autoCompileEnabled]);

  // No need for periodic PDF checking - we always compile and generate PDF

  // Auto-save functionality
  // Note: This effect re-runs when currentFile changes (via dependency array),
  // which clears the old timeout - so stale closure is less of a risk here.
  // But we add explicit capture and validation for safety and consistency.
  useEffect(() => {
    // Don't auto-save if: disabled, loading, no file, or content is empty/undefined/null
    if (
      !autoSaveEnabled ||
      loading ||
      !currentFile ||
      fileViewMode !== 'editor' ||
      !isCurrentFileEditable() ||
      !content ||
      content.trim() === ''
    ) return;

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    // Capture file at effect creation time for safety
    const fileToSave = currentFile;
    const contentToSave = content;

    autoSaveTimeoutRef.current = setTimeout(async () => {
      try {
        // Verify file hasn't changed (extra safety - shouldn't happen due to dependency array)
        if (fileToSave !== currentFile) {
          console.log(`⏭️ useEffect auto-save skipped - file changed from ${fileToSave} to ${currentFile}`);
          return;
        }
        // Double-check content is still valid before saving
        if (!contentToSave || contentToSave.trim() === '') {
          console.log(`⏭️ useEffect auto-save skipped - content is empty`);
          return;
        }
        await saveCurrentFile(fileToSave, contentToSave);
      } catch (error) {
        console.error('Auto-save failed:', error);
      }
    }, 2000);

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [content, currentFile, autoSaveEnabled, projectId, saveCurrentFile, loading, fileViewMode, isCurrentFileEditable]);

  const loadProjectMetadata = async () => {
    try {
      const res = await fetch(`/api/files/${projectId}?file=project_metadata.json`);
      if (res.ok) {
        const data = await res.json();
        const raw = data?.content;
        const metadata = parseProjectMetadata(
          typeof raw === 'string' ? raw : (raw ? JSON.stringify(raw) : '{}'),
          `project ${projectId}/project_metadata.json`
        );
        setProjectMetadata(metadata);
        setEditorType(metadata?.editor || 'latex');
        return metadata;
      }
    } catch (error) {
      console.error('Failed to load project metadata:', error);
    }
    return null;
  };



  const compile = async () => {
    // Cancel any pending auto-compile when manual compile is triggered
    if (autoCompileTimeoutRef.current) {
      clearTimeout(autoCompileTimeoutRef.current);
      autoCompileTimeoutRef.current = null;
    }

    // Need an active LaTeX document to compile
    if (!compileTarget || !compileTarget.endsWith('.tex')) {
      console.log('Compilation requires an active LaTeX document (open a .tex file)');
      return;
    }
    if (!isCurrentFileLaTeX()) {
      console.log('Compilation only available for LaTeX files');
      return;
    }

    // Prevent multiple simultaneous compilations
    if (compilationInProgressRef.current) {
      console.log('⏸️ Compilation already in progress, skipping duplicate request');
      return;
    }

    // Check minimum interval since last compilation
    const timeSinceLastCompile = Date.now() - lastCompileTimeRef.current;
    if (timeSinceLastCompile < MIN_COMPILE_INTERVAL_MS) {
      console.log(`⏸️ Compilation skipped - too soon since last compile (${Math.round(timeSinceLastCompile / 1000)}s ago)`);
      return;
    }

    compilationInProgressRef.current = true;
    lastCompileTimeRef.current = Date.now(); // Update last compile time
    console.log('🔄 Starting LaTeX compilation...');
    setCompiling(true);
    setLog('');

    try {
      const res = await fetch(`/api/compile/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: compileTarget })
      });
      const data = await res.json();

      setLog(data.log || '');

      // For retryable errors (like lock contention), don't update error state
      // This preserves the previous compilation state and avoids confusing UI changes
      if (!data.retryable) {
        // Store compilation errors and warnings
        const tecErrors = data.errors || [];
        const tecWarnings = data.warnings || [];
        const allIssues = [...tecErrors, ...tecWarnings];
        
        setCompilationErrors(tecErrors);
        setCompilationWarnings(tecWarnings);
        setAllErrors(allIssues); // Include both errors and warnings
        setCompilationMessage(data.userMessage || ''); // Store user message

        // Highlight error and warning lines in editor (markers support both)
        setTimeout(() => {
          // Apply markers for both errors and warnings (Monaco markers API handles both)
          applyErrorMarkers(allIssues);
        }, 100); // Small delay to ensure editor is ready
      }

      if (data.ok) {
        setPdfBust((b) => b + 1);
        setCompilationSuccess(true);
        setPdfExists(true); // PDF was successfully created
        
        // Show user-friendly message
        if (data.userMessage) {
          console.log(data.userMessage);
        } else {
          console.log('✅ LaTeX compilation successful');
        }
        
        // Log stats if available
        if (data.stats) {
          console.log(`📊 Stats: ${data.stats.errors} errors, ${data.stats.warnings} warnings (${data.stats.ignorable} cosmetic)`);
        }
      } else {
        setCompilationSuccess(false);
        
        // Only set PDF as non-existent if server says so
        // For retryable errors (like lock contention), preserve existing PDF state
        if (data.retryable) {
          // Temporary issue - don't change PDF state, show as warning not error
          console.warn('⏳ ' + (data.userMessage || 'Compilation busy, please try again'));
          // Keep existing PDF visible if available
          if (data.pdfAvailable) {
            setPdfExists(true);
          }
        } else {
          setPdfExists(data.pdfAvailable || false);
          // Show user-friendly error message
          if (data.userMessage) {
            setLog(data.userMessage);
          } else {
            setLog('❌ LaTeX compilation failed');
          }
        }
      }
    } catch (error) {
      console.error('Compilation failed:', error);
      setLog('Compilation failed: ' + error.message);
      setCompilationSuccess(false);
      setPdfExists(false);
    } finally {
      setCompiling(false);
      compilationInProgressRef.current = false;
    }
  };

  /**
   * handleApplyImageFix - Apply "Did you mean" fix for image path typo (e.g. 417fd -> 417df)
   */
  const handleApplyImageFix = useCallback(async (error) => {
    const msg = error?.message || '';
    const wrongMatch = msg.match(/File\s+[`'"]?([^`'"]+?)[`'"]?\s*(?:not found|cannot find)/i);
    const didYouMean = (error?.suggestions || []).find(s => typeof s === 'string' && s.startsWith('Did you mean images/'));
    const correctMatch = didYouMean?.match(/Did you mean (images\/[^\s?]+)/);
    if (!wrongMatch || !correctMatch) return;

    const wrongPath = wrongMatch[1].trim();
    const correctPath = correctMatch[1].trim();
    if (wrongPath === correctPath) return;

    const fileToEdit = compileTarget || 'main.tex';
    try {
      const { content } = await loadFileContent(fileToEdit);
      const escapedWrong = wrongPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const newContent = content.replace(new RegExp(escapedWrong, 'g'), correctPath);
      if (newContent === content) return;

      const result = await saveCurrentFile(fileToEdit, newContent, { forceOverwrite: true });
      if (result?.ok) {
        setPdfBust((b) => b + 1);
        await compile();
      }
    } catch (err) {
      console.error('Apply image fix failed:', err);
    }
  }, [compileTarget, loadFileContent, saveCurrentFile, compile]);

  const insertLaTeXCommand = (command, placeholder = '') => {
    if (editorRef.current && typeof window !== 'undefined' && window.monaco) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      const range = new window.monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn
      );
      const text = `\\${command}{${placeholder}}`;
      const operation = {
        range: range,
        text: text,
        forceMoveMarkers: true
      };
      editor.executeEdits('insert-text', [operation]);
      editor.focus();
    }
  };

  const handleFileSelect = async (file) => {
    // Cancel any pending auto-compile when switching files
    if (autoCompileTimeoutRef.current) {
      clearTimeout(autoCompileTimeoutRef.current);
      autoCompileTimeoutRef.current = null;
    }

    if (file.type === 'file') {
      const isLaTeXFile = file.name.endsWith('.tex');
      const isImageFile = /\.(png|jpg|jpeg|gif|svg)$/i.test(file.name);
      const isPdfFile = /\.pdf$/i.test(file.name);
      const isEditable = isEditableFile(file.path);
      
      if (isLaTeXFile) {
        // For LaTeX files, load in editor mode and set as active compile target
        setFileViewMode('editor');
        setCompileTarget(file.path);
        try {
          if (typeof localStorage !== 'undefined') localStorage.setItem(`genlatex-last-tex-${projectId}`, file.path);
        } catch (e) { /* ignore */ }
        // loadFile will set currentFile after content is loaded (prevents race condition)
        await loadFile(file.path);
        
        // Auto-compile LaTeX file
        setTimeout(() => {
          autoCompileLaTeX(file.path);
        }, 500); // Small delay to ensure file is loaded
      } else if (isImageFile || isPdfFile) {
        // For image and PDF files, show in viewer mode
        setFileViewMode('viewer');
        setCurrentFile(file.path);
        // Don't change compile target for non-LaTeX files
      } else if (isEditable) {
        // For editable text files (like .bib, .txt, etc.), load in editor mode
        setFileViewMode('editor');
        // loadFile will set currentFile after content is loaded (prevents race condition)
        await loadFile(file.path);
        // Don't change compile target for non-LaTeX files
      } else {
        // For other non-editable files, show in viewer mode
        setFileViewMode('viewer');
        setCurrentFile(file.path);
        // Don't change compile target for non-LaTeX files
      }
    }
  };

  // Define scrollToLine function - must be before handleErrorLineClick
  const scrollToLine = useCallback((lineNumber) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📍 scrollToLine CALLED`);
    console.log(`   lineNumber: ${lineNumber}`);
    console.log(`   editorRef.current: ${!!editorRef.current}`);
    console.log(`   window.monaco: ${typeof window !== 'undefined' && !!window.monaco}`);
    
    if (!editorRef.current) {
      console.error('❌ editorRef.current is null - cannot navigate');
      return;
    }
    
    if (typeof window === 'undefined' || !window.monaco) {
      console.error('❌ Monaco not available - cannot navigate');
      return;
    }
    
    const editor = editorRef.current;
    const model = editor.getModel();
    
    if (!model) {
      console.error('❌ Editor model not available - cannot navigate');
      return;
    }
    
    // Validate line number before accessing
    const totalLines = model.getLineCount();
    console.log(`📊 Model info:`);
    console.log(`   Total lines: ${totalLines}`);
    console.log(`   Requested line: ${lineNumber}`);
    console.log(`   Current file: ${currentFile}`);
    
    if (lineNumber < 1 || lineNumber > totalLines) {
      console.warn(`⚠️ Invalid line number ${lineNumber}, total lines: ${totalLines}`);
      // Clamp to valid range instead of returning
      const originalLine = lineNumber;
      lineNumber = Math.max(1, Math.min(lineNumber, totalLines));
      console.log(`📍 Clamped line number from ${originalLine} to ${lineNumber}`);
    }
    
    // Get the full line content
    const lineContent = model.getLineContent(lineNumber);
    console.log(`📝 Line ${lineNumber} content: "${lineContent.substring(0, 80)}${lineContent.length > 80 ? '...' : ''}"`);
    
    // Create a range covering the entire line
    const range = new window.monaco.Range(lineNumber, 1, lineNumber, lineContent.length + 1);
    
    // Navigate and reveal - ensure editor is focused and visible
    console.log(`🎯 Setting editor position to line ${lineNumber}...`);
    editor.setPosition({ lineNumber, column: 1 });
    
    console.log(`👁️ Focusing editor...`);
    editor.focus();
    
    console.log(`📜 Revealing line ${lineNumber} in center...`);
    editor.revealLineInCenter(lineNumber);
    
    console.log(`🎨 Setting selection...`);
    editor.setSelection(range);
    
    // Add a decoration for visual highlight feedback with better styling
    const decorations = editor.deltaDecorations([], [{
      range: range,
      options: {
        isWholeLine: true,
        className: 'highlighted-line',
        stickiness: 1,
        inlineClassName: 'highlighted-line-inline',
        glyphMarginClassName: 'highlighted-line-glyph'
      }
    }]);
    
    console.log(`✅ Successfully navigated to line ${lineNumber} in editor`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    // Remove highlight after 3 seconds
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.deltaDecorations(decorations, []);
      }
    }, 3000);
  }, [editorRef, currentFile]);

  const handleErrorLineClick = useCallback(async (lineNumber, errorFile = null) => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📍 handleErrorLineClick CALLED`);
    console.log(`   lineNumber: ${lineNumber}`);
    console.log(`   errorFile: ${errorFile}`);
    console.log(`   currentFile: ${currentFile}`);
    console.log(`   compileTarget: ${compileTarget}`);
    console.log(`   editorRef.current: ${!!editorRef.current}`);
    console.log(`   loading: ${loading}`);
    console.log(`   editorType: ${editorType}`);
    
    // If error is in a different file, switch to that file first (only if it's a project file)
    if (errorFile && errorFile !== currentFile && isPathInProject(errorFile)) {
      try {
        // Normalize file paths for comparison
        const normalizedErrorFile = errorFile.replace(/\\/g, '/');
        const normalizedCurrentFile = currentFile ? currentFile.replace(/\\/g, '/') : '';
        
        // Only switch if files are actually different
        if (normalizedErrorFile !== normalizedCurrentFile && 
            !normalizedErrorFile.endsWith(normalizedCurrentFile) &&
            !normalizedCurrentFile.endsWith(normalizedErrorFile)) {
          console.log(`📂 Switching to file: ${errorFile} for line ${lineNumber}`);
          await loadFile(errorFile);
          // Wait a bit for file to load before scrolling
          setTimeout(() => {
            scrollToLine(lineNumber);
          }, 300);
          return;
        }
      } catch (error) {
        console.error('❌ Error switching to file:', error);
        // Fall through to scroll in current file
      }
    }
    
    // Ensure we're viewing the compile target for SyncTeX navigation
    if (!compileTarget) return;
    const targetFile = compileTarget;
    if (currentFile !== targetFile) {
      console.log(`📂 Switching to ${targetFile} for SyncTeX navigation`);
      try {
        await loadFile(targetFile);
        setTimeout(() => {
          scrollToLine(lineNumber);
        }, 300);
        return;
      } catch (error) {
        console.error('❌ Error switching to target file:', error);
        // Fall through to try scrolling in current file
      }
    }
    
    // Ensure editor is ready before scrolling
    if (!editorRef.current) {
      console.warn('⚠️ Editor not ready, waiting...');
      // Wait a bit and retry
      setTimeout(() => {
        if (editorRef.current) {
          console.log('✅ Editor ready after wait, scrolling...');
          scrollToLine(lineNumber);
        } else {
          console.error('❌ Editor still not ready after wait');
        }
      }, 100);
      return;
    }
    
    // Check if we're in LaTeX editor mode (not Tiptap)
    if (editorType !== 'latex') {
      console.warn(`⚠️ Editor type is "${editorType}", not "latex". Cannot navigate to line.`);
      console.warn(`   Switching to LaTeX editor mode...`);
      setEditorType('latex');
      // Wait for editor to switch, then scroll
      setTimeout(() => {
        if (editorRef.current && editorType === 'latex') {
          scrollToLine(lineNumber);
        }
      }, 300);
      return;
    }
    
    // Scroll to line in current file
    console.log(`📍 Scrolling to line ${lineNumber} in current file: ${currentFile}`);
    scrollToLine(lineNumber);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, [currentFile, loadFile, compileTarget, editorType, isPathInProject]);

  const handleTextSearch = (searchText) => {
    console.log(`🔍 handleTextSearch called with: "${searchText}"`);
    
    if (editorRef.current && searchText) {
      const editor = editorRef.current;
      const model = editor.getModel();
      
      console.log(`📝 Editor model available, searching for: "${searchText}"`);
      
      // Try to find the text in the current document
      const escapedText = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const searchPattern = `.*${escapedText}.*`;
      console.log(`🔎 Search pattern: ${searchPattern}`);
      
      const matches = model.findMatches(searchPattern, true, false, false, false);
      console.log(`🎯 Found ${matches.length} matches`);
      
      if (matches.length > 0) {
        // Navigate to the first match
        const match = matches[0];
        editor.setPosition(match.range.startLineNumber, match.range.startColumn);
        editor.focus();
        editor.revealLineInCenter(match.range.startLineNumber);
        
        // Highlight the match
        editor.setSelection(match.range);
        
        // Add a decoration for visual highlight feedback
        const decorations = editor.deltaDecorations([], [{
          range: match.range,
          options: {
            inlineClassName: 'highlighted-text',
            stickiness: 1
          }
        }]);
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
          editor.deltaDecorations(decorations, []);
        }, 3000);
        
        console.log(`✅ Navigated to "${searchText}" at line ${match.range.startLineNumber}`);
      } else {
        // Try searching for section/subsection/chapter commands (already escaped above)
        const commandPatterns = [
          { regex: `\\\\section\\*?\\{([^}]*${escapedText}[^}]*)\\}`, type: 'section' },
          { regex: `\\\\subsection\\*?\\{([^}]*${escapedText}[^}]*)\\}`, type: 'subsection' },
          { regex: `\\\\subsubsection\\*?\\{([^}]*${escapedText}[^}]*)\\}`, type: 'subsubsection' },
          { regex: `\\\\chapter\\*?\\{([^}]*${escapedText}[^}]*)\\}`, type: 'chapter' }
        ];
        
        for (const pattern of commandPatterns) {
          const commandMatches = model.findMatches(pattern.regex, true, false, false, false);
          
          if (commandMatches.length > 0) {
            const match = commandMatches[0];
            editor.setPosition(match.range.startLineNumber, match.range.startColumn);
            editor.focus();
            editor.revealLineInCenter(match.range.startLineNumber);
            editor.setSelection(match.range);
            
            // Add a decoration for visual highlight feedback
            const decorations = editor.deltaDecorations([], [{
              range: match.range,
              options: {
                inlineClassName: 'highlighted-text',
                stickiness: 1
              }
            }]);
            
            // Remove highlight after 3 seconds
            setTimeout(() => {
              editor.deltaDecorations(decorations, []);
            }, 3000);
            
            console.log(`📍 Found "${searchText}" in ${pattern.type} at line ${match.range.startLineNumber}`);
            return; // Stop after first match
          }
        }
        
        console.warn(`⚠️ Could not find "${searchText}" in the document`);
      }
    }
  };




  const downloadProject = () => {
    if (typeof window !== 'undefined') {
      window.open(`/api/files/${projectId}/download?type=project`, '_blank');
    }
  };

  const refreshFileTree = () => {
    setFileTreeRefreshKey((prev) => prev + 1);
  };

  const handleCreateFromSidebar = async (type) => {
    const label = type === 'folder' ? 'folder' : 'file';
    const name = window.prompt(`Enter ${label} name:`);
    if (!name || !name.trim()) return;
    try {
      const res = await fetch(`/api/files/${projectId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, name: name.trim(), path: '' })
      });
      if (!res.ok) {
        const errorText = await res.text();
        toast.error(`Failed to create ${label}: ${errorText}`);
        return;
      }
      toast.success(`${label} created successfully`);
      refreshFileTree();
    } catch (error) {
      console.error('Create error:', error);
      toast.error(`Failed to create ${label}.`);
    } finally {
      setShowAddMenu(false);
    }
  };

  const handleUploadFiles = async (files) => {
    if (!files || files.length === 0) return;
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => {
        formData.append('files', file);
      });
      const res = await fetch(`/api/files/${projectId}/upload`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!data.success) {
        toast.error(`Upload failed: ${data.error || 'Unknown error'}`);
        return;
      }
      toast.success(`${files.length} file(s) uploaded successfully`);
      refreshFileTree();
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Upload failed. Please try again.');
    } finally {
      setShowAddMenu(false);
    }
  };

  const downloadPdf = () => {
    if (typeof window === 'undefined' || !compileTarget) return;
    window.open(`/api/pdf/${projectId}?b=${Date.now()}&target=${encodeURIComponent(compileTarget)}`, '_blank');
  };

  const openRenameDialog = () => {
    setRenameName(projectMetadata?.name || '');
    setShowRenameDialog(true);
    setShowProjectMenu(false);
  };

  const handleRenameProjectSave = async () => {
    const name = renameName?.trim();
    if (!name) {
      toast.error('Please enter a project name');
      return;
    }
    setRenameLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.project?.name) {
        const newName = data.project.name;
        setProjectMetadata((prev) => ({ ...(prev || {}), name: newName }));
        setShowRenameDialog(false);
        // Project name and document title (main.tex \title, main.md # heading) are separate — do not modify
        toast.success('Project renamed successfully');
      } else {
        toast.error(data?.error || 'Failed to rename project');
      }
    } catch (error) {
      console.error('Rename project failed:', error);
      toast.error('Failed to rename project.');
    } finally {
      setRenameLoading(false);
    }
  };

  // Handle create file/folder from the + menu
  const handleCreateFileOrFolder = async () => {
    const name = createName?.trim();
    if (!name) {
      toast.error(`Please enter a ${createType} name`);
      return;
    }
    setCreateLoading(true);
    try {
      const response = await fetch(`/api/files/${projectId}/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: createType,
          name: name,
          path: '' // Create at root level
        })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        toast.success(`${createType === 'folder' ? 'Folder' : 'File'} created successfully`);
        setShowCreateDialog(false);
        setCreateName('');
        // Delay refresh to allow storage (FS/MinIO) to persist before tree fetch
        setTimeout(() => refreshFileTree(), 150);
        // If it's a .tex file, trigger auto-compile
        if (createType === 'file' && name.toLowerCase().endsWith('.tex')) {
          handleNewLaTeXFile(name);
        }
        // If it's a file, open it in the editor
        if (createType === 'file') {
          handleFileSelect({ path: name, name: name, type: 'file' });
        }
      } else {
        // If folder already exists, refresh tree so user can see it
        if (data?.error?.toLowerCase?.().includes('already exists')) {
          setTimeout(() => refreshFileTree(), 150);
        }
        toast.error(data?.error || `Failed to create ${createType}`);
      }
    } catch (error) {
      console.error('Create file/folder failed:', error);
      toast.error(`Failed to create ${createType}. Please try again.`);
    } finally {
      setCreateLoading(false);
    }
  };

  // Open create dialog for file or folder
  const openCreateDialog = (type) => {
    setCreateType(type);
    setCreateName(type === 'file' ? 'newfile.tex' : 'newfolder');
    setShowCreateDialog(true);
    setShowAddMenu(false);
  };

  const handleDeleteProject = async () => {
    const confirmed = await confirm({
      title: 'Delete Project',
      description: 'Are you sure you want to delete this project? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger'
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Project deleted');
        router.push('/dashboard');
      } else {
        const errorText = await res.text();
        toast.error(`Failed to delete project: ${errorText}`);
      }
    } catch (error) {
      console.error('Delete project failed:', error);
      toast.error('Failed to delete project.');
    } finally {
      setShowProjectMenu(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!projectMenuRef.current) return;
      if (!projectMenuRef.current.contains(event.target)) {
        setShowProjectMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!addMenuRef.current) return;
      if (!addMenuRef.current.contains(event.target)) {
        setShowAddMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const inTrigger = zoomMenuRef.current?.contains(event.target);
      const inDropdown = zoomDropdownRef.current?.contains(event.target);
      if (!inTrigger && !inDropdown) {
        setShowZoomMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const zoomOptions = [50, 75, 100, 150, 200, 300, 400];
  const zoomLabel = pdfZoom === 'fit' ? 'Zoom to fit' : `${pdfZoom}%`;

  const setZoomValue = (value) => {
    setPdfZoom(value);
    setShowZoomMenu(false);
  };

  const zoomToFit = () => {
    setPdfZoom('fit');
    setShowZoomMenu(false);
  };

  const zoomIn = () => {
    if (pdfZoom === 'fit') {
      setPdfZoom(100);
      setShowZoomMenu(false);
      return;
    }
    const current = Number(pdfZoom) || 100;
    const next = zoomOptions.find((opt) => opt > current);
    setPdfZoom(next || current);
    setShowZoomMenu(false);
  };

  const zoomOut = () => {
    if (pdfZoom === 'fit') {
      setPdfZoom(100);
      setShowZoomMenu(false);
      return;
    }
    const current = Number(pdfZoom) || 100;
    const next = [...zoomOptions].reverse().find((opt) => opt < current);
    setPdfZoom(next || current);
    setShowZoomMenu(false);
  };

  const pdfZoomRef = useRef(pdfZoom);
  pdfZoomRef.current = pdfZoom;

  // Keyboard shortcuts for PDF zoom (Ctrl+0, Ctrl+, Ctrl-)
  useEffect(() => {
    if (editorType !== 'latex') return;
    const zoomOpts = [50, 75, 100, 150, 200, 300, 400];
    const handleKeyDown = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === '0') {
        e.preventDefault();
        setPdfZoom('fit');
        setShowZoomMenu(false);
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        const currentZoom = pdfZoomRef.current;
        if (currentZoom === 'fit') setPdfZoom(100);
        else {
          const current = Number(currentZoom) || 100;
          const next = zoomOpts.find((opt) => opt > current);
          setPdfZoom(next || current);
        }
        setShowZoomMenu(false);
      } else if (e.key === '-') {
        e.preventDefault();
        const currentZoom = pdfZoomRef.current;
        if (currentZoom === 'fit') setPdfZoom(100);
        else {
          const current = Number(currentZoom) || 100;
          const next = [...zoomOpts].reverse().find((opt) => opt < current);
          setPdfZoom(next || current);
        }
        setShowZoomMenu(false);
      } else if (e.key === 'Escape') {
        setShowZoomMenu(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editorType]);

  const downloadFile = (filePath) => {
    if (typeof window !== 'undefined') {
      window.open(`/api/files/${projectId}/download?type=file&file=${encodeURIComponent(filePath)}`, '_blank');
    }
  };

  const handleTabClick = (tab) => {
    setActiveTabId(tab.id);
    setFileViewMode('editor');
    // Just re-layout the editor, don't reload the file (it's already loaded)
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.layout();
      }
    }, 50);
  };

  useEffect(() => {
    // Only handle editor layout, NOT content synchronization
    // Content synchronization is handled by loadFile to prevent race conditions
    const layoutEditor = () => {
      if (!editorRef.current) return;
      editorRef.current.layout();
    };
    const id = setTimeout(layoutEditor, 50);
    return () => clearTimeout(id);
  }, [activeTabId]);

  useEffect(() => {
    if (editorType !== 'latex') return;
    const id = requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.layout();
    });
    return () => cancelAnimationFrame(id);
  }, [activeTabId, editorType]);

  // Show AI loading screen ONLY during initial generation (when query param exists and status is active).
  // Rendered inside single return to avoid early-return hook violation.
  if (showAILoading) {
    return (
      <AIGenerationLoading 
        projectId={projectId} 
        onComplete={(status, options) => {
          setShowAILoading(false);
          if (options?.recovered) {
            toast.success('Generation completed! Refreshing project...');
          }
          if (options?.extractionFailed) {
            toast.warning('Generation completed but file extraction had issues. Refreshing project...', { duration: 5000 });
          }
          // Full navigation to editor (no query param) so the editor loads with generated LaTeX
          if (projectId) {
            window.location.href = `/editor/${projectId}`;
          } else {
            setShowAILoading(false);
            router.replace(`/editor/${projectId}`, { scroll: false });
            setTimeout(() => window.location.reload(), 150);
          }
        }}
      />
    );
  }

  return (
    <div className={`h-screen min-h-0 flex w-full overflow-hidden ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
      {/* Initial page loading overlay */}
      {loading && (
        <div
          className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center gap-3 ${
            isDarkMode ? 'bg-gray-900/95' : 'bg-gray-50/95'
          }`}
          aria-live="polite"
          aria-busy="true"
        >
          <svg
            className={`w-10 h-10 animate-spin ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
            <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
            Loading project...
          </p>
        </div>
      )}

      {/* Confirm Dialog */}
      {ConfirmDialog}
      
      {/* Load AI Integration Script */}
      <Script src="/js/aimodel-integration.js" strategy="afterInteractive" />
      
      
      {/* Left Sidebar */}
      <div className={`w-64 min-h-0 flex flex-col border-r overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
        {/* Project Header */}
        <div className="px-5 pt-5 pb-5 relative" ref={projectMenuRef}>
          <div className="flex flex-col gap-3">
            {/* Top row: logo (left) + settings (right), vertically aligned */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
                aria-label="Go to dashboard"
              >
                <img src="/logo_genlatex_only.svg" alt="GenLaTeX" className="h-10 w-10" />
              </button>
              <button
                type="button"
                onClick={() => setShowSettingsModal(true)}
                className={`rounded-xl p-2.5 transition-colors flex items-center justify-center ${isDarkMode ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}
                title="Settings"
                aria-label="Settings"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
            {/* Bottom row: project name, left-aligned */}
            <button
              className="flex items-center gap-2 text-left w-full min-w-0"
              onClick={() => setShowProjectMenu((prev) => !prev)}
              aria-label="Project menu"
            >
              <span className={`text-[15px] font-semibold truncate ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
                {projectMetadata?.name || 'New Project'}
              </span>
              <svg className={`w-4 h-4 flex-shrink-0 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {showProjectMenu && (
            <div className={`absolute left-4 top-[5.5rem] z-20 w-52 rounded-xl border shadow-lg ${
              isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
            }`}>
              <button
                onClick={openRenameDialog}
                className={`w-full px-4 py-2 text-left text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                Rename
              </button>
              <button
                onClick={handleDeleteProject}
                className={`w-full px-4 py-2 text-left text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                Delete
              </button>
              <div className={`my-1 h-px ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
              <button
                onClick={downloadProject}
                className={`w-full px-4 py-2 text-left text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                Download (zip)
              </button>
              <button
                onClick={downloadPdf}
                className={`w-full px-4 py-2 text-left text-sm ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
              >
                Download (pdf)
              </button>
            </div>
          )}
        </div>

        {/* Tabs Row */}
        <div className="px-5">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-6">
              <span className={`text-sm font-medium pb-2 ${
                isDarkMode ? 'text-white border-b-2 border-blue-500' : 'text-gray-900 border-b-2 border-blue-500'
              }`}>
                Files
              </span>
            </div>
            <div className="flex items-center gap-3 relative" ref={addMenuRef}>
              <button
                onClick={() => { refreshFileTree(); toast.success('Files refreshed'); }}
                className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-colors ${
                  isDarkMode
                    ? 'text-gray-200 border-gray-600 hover:bg-gray-700'
                    : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
                title="Refresh file tree"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setShowAddMenu((prev) => !prev)}
                className={`h-9 w-9 rounded-lg border flex items-center justify-center transition-colors ${
                  isDarkMode
                    ? 'text-gray-200 border-gray-600 hover:bg-gray-700'
                    : 'text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
                title="Add"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
              {showAddMenu && (
                <div className={`absolute right-0 top-full mt-2 w-52 rounded-xl border shadow-lg z-30 ${
                  isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
                }`}>
                  <button
                    onClick={() => openCreateDialog('file')}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    New File
                  </button>
                  <button
                    onClick={() => openCreateDialog('folder')}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z"/>
                    </svg>
                    New Folder
                  </button>
                  <div className={`border-t my-1 ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}></div>
                  <button
                    onClick={() => fileUploadInputRef.current?.click()}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload File
                  </button>
                  <button
                    onClick={() => directoryUploadInputRef.current?.click()}
                    className={`w-full px-4 py-2 text-left text-sm flex items-center gap-2 ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    Upload Directory
                  </button>
                </div>
              )}
              <input
                ref={fileUploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUploadFiles(e.target.files)}
              />
              <input
                ref={directoryUploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => handleUploadFiles(e.target.files)}
                webkitdirectory="true"
                directory="true"
              />
            </div>
          </div>
          <div className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} mt-2`}></div>
        </div>

        {/* Content based on tab */}
        <>
          {/* File Tree */}
          <div className="flex-1 overflow-auto py-3">
            <FileTree
              key={`file-tree-${fileTreeRefreshKey}`}
              projectId={projectId}
              refreshKey={fileTreeRefreshKey}
              onFileSelect={handleFileSelect}
              onFileCreate={handleNewLaTeXFile}
              onFileDelete={handleFileDelete}
              onFileRename={handleFileRename}
              isDarkMode={isDarkMode}
              highlightedFiles={chatContextFiles.map(f => f.path)}
              onFileHighlight={(file, isHighlighted) => {
                setChatContextFiles(prev => {
                  if (isHighlighted) {
                    if (prev.some(f => f.path === file.path)) return prev;
                    return [...prev, { path: file.path, name: file.name }];
                  }
                  return prev.filter(f => f.path !== file.path);
                });
              }}
            />
          </div>

          {/* Document Outline / Table of Contents */}
          <div className={`border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
            <div className="p-2 max-h-48 overflow-y-auto">
              {documentOutline.length === 0 ? (
                <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'} px-2 py-1 italic`}>
                  No sections found
                </div>
              ) : (
                <div className="space-y-0.5">
                  {documentOutline.map((section, index) => (
                    <div
                      key={index}
                      className={`flex items-center gap-2 px-2 py-1 rounded text-sm cursor-pointer transition-colors ${
                        isDarkMode 
                          ? 'text-gray-300 hover:bg-gray-700' 
                          : 'text-gray-700 hover:bg-gray-100'
                      } ${section.level === 2 ? 'pl-4' : section.level === 3 ? 'pl-6' : ''}`}
                      onClick={() => {
                        if (editorRef.current && section.line) {
                          const editor = editorRef.current;
                          editor.setPosition({ lineNumber: section.line, column: 1 });
                          editor.focus();
                          editor.revealLineInCenter(section.line);
                        }
                      }}
                    >
                      <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>*</span>
                      <span className="truncate">{section.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>

        {/* Status Bar – only in development (avoids clutter in production) */}
        {process.env.NODE_ENV === 'development' && (
          <div className={`px-3 py-2 border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'} flex items-center justify-between`}>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${isDarkMode ? 'bg-green-400' : 'bg-green-500'}`}></div>
              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Connected</span>
            </div>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Top Toolbar */}
        <div className={`flex-shrink-0 border-b px-4 py-2.5 flex items-center justify-between ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}>
          {/* Left side: Tabs + Undo/Redo (yellow spot area) */}
          <div className="flex items-center gap-4">
            {/* Tabs */}
            <div className="flex items-center gap-2">
              {tabs.map(tab => {
                const isActive = tab.id === activeTabId;
                const label = currentFile ? currentFile.split('/').pop() : 'Document';
                const loadingLabel = loadingFileRef.current ? loadingFileRef.current.split('/').pop() : label;
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabClick(tab)}
                    disabled={isLoadingFile}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm transition-opacity ${
                      isLoadingFile ? 'opacity-70 cursor-wait' : ''
                    } ${
                      isActive
                        ? isDarkMode ? 'border-gray-500 text-gray-100' : 'border-gray-400 text-gray-900'
                        : isDarkMode ? 'border-gray-700 text-gray-400' : 'border-gray-300 text-gray-600'
                    }`}
                  >
                    {isLoadingFile && isActive ? (
                      <svg className={`w-4 h-4 animate-spin ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg className={`w-4 h-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    )}
                    <span className="truncate max-w-[140px]">
                      {isLoadingFile && isActive ? `Loading ${loadingLabel}...` : label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Undo / Redo (next to tabs) */}
            <div className={`flex items-center gap-0.5 rounded-lg border ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
              <button
                type="button"
                onClick={() => {
                  const ed = editorRef.current;
                  if (ed) { ed.focus(); ed.trigger('keyboard', 'undo', null); }
                }}
                className={`p-1.5 rounded-l-md transition-colors ${isDarkMode ? 'text-gray-400 hover:text-white hover:bg-gray-700' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                title="Undo LaTeX changes (Ctrl+Z)"
                aria-label="Undo"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  const ed = editorRef.current;
                  if (ed) { ed.focus(); ed.trigger('keyboard', 'redo', null); }
                }}
                className={`p-1.5 rounded-r-md transition-colors border-l ${isDarkMode ? 'border-gray-600 text-gray-400 hover:text-white hover:bg-gray-700' : 'border-gray-300 text-gray-500 hover:text-gray-900 hover:bg-gray-100'}`}
                title="Redo LaTeX changes (Ctrl+Y)"
                aria-label="Redo"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
                </svg>
              </button>
            </div>
          </div>

          {/* Right side: Toolbar controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={compile}
              disabled={compiling || !compileTarget}
              aria-busy={compiling}
              className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-all ${
                compiling
                  ? isDarkMode
                    ? 'border-blue-600 text-blue-200 bg-blue-600/20'
                    : 'border-blue-600 text-blue-700 bg-blue-50'
                  : !compileTarget
                    ? (isDarkMode ? 'border-gray-700 text-gray-500 cursor-not-allowed' : 'border-gray-300 text-gray-400 cursor-not-allowed')
                    : isDarkMode
                      ? 'border-gray-600 text-gray-200 hover:border-gray-500 hover:text-white'
                      : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:text-gray-900'
              }`}
              title={compileTarget ? 'Compile' : 'Open a .tex file to compile'}
            >
              {compiling ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                  <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v6h6M20 20v-6h-6M20 4l-7.5 7.5M4 20l7.5-7.5" />
                </svg>
              )}
              <span>{compiling ? 'Compiling...' : 'Compile'}</span>
            </button>
            <button className={`flex items-center gap-1.5 text-sm ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}>
              <span>Tools</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>

            <div className={`h-5 w-px ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>

            <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{String(pdfCurrentPage).padStart(2, '0')}</div>
            <div className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>of {String(pdfTotalPages).padStart(2, '0')}</div>

            <div className="relative" ref={zoomMenuRef}>
              <button
                ref={zoomTriggerRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (zoomTriggerRef.current) {
                    const rect = zoomTriggerRef.current.getBoundingClientRect();
                    setZoomMenuPosition({
                      top: rect.bottom + 8,
                      left: Math.max(8, rect.right - 208),
                    });
                  }
                  setShowZoomMenu((prev) => !prev);
                }}
                className={`flex items-center gap-1.5 text-sm ${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}
                title="Zoom options"
              >
                <span>{zoomLabel}</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showZoomMenu && typeof document !== 'undefined' && createPortal(
                <div
                  ref={zoomDropdownRef}
                  className={`fixed w-52 rounded-xl border shadow-xl py-1 ${
                    isDarkMode ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-white border-gray-200 text-gray-800'
                  }`}
                  style={{
                    top: zoomMenuPosition.top,
                    left: zoomMenuPosition.left,
                    zIndex: 9999,
                  }}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoomToFit(); }}
                    className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between ${
                      pdfZoom === 'fit' ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-50 text-blue-700') : ''
                    } ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <span>Zoom to fit</span>
                    <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Ctrl+0</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoomIn(); }}
                    className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <span>Zoom in</span>
                    <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Ctrl+</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); zoomOut(); }}
                    className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                  >
                    <span>Zoom out</span>
                    <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>Ctrl-</span>
                  </button>
                  <div className={`my-1 h-px ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>
                  {zoomOptions.map((option) => {
                    const isActive = pdfZoom !== 'fit' && Number(pdfZoom) === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setZoomValue(option); }}
                        className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between ${
                          isActive ? (isDarkMode ? 'bg-gray-700 text-blue-300' : 'bg-blue-50 text-blue-700') : ''
                        } ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                      >
                        <span>{option}%</span>
                        {isActive && (
                          <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>,
                document.body
              )}
            </div>

            <button
              onClick={downloadPdf}
              className={`${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`}
              title="Download"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v12m0 0l4-4m-4 4l-4-4M4 19h16" />
              </svg>
            </button>

            <button className={`${isDarkMode ? 'text-gray-300 hover:text-white' : 'text-gray-700 hover:text-gray-900'}`} title="More">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </button>
          </div>
        </div>
      
        {/* Editor and Preview Area - fills remaining height below toolbar */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* Editor Panel */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Editor Content */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* Single Screen for Tiptap, Split Screen for LaTeX */}
            {editorType === 'tiptap' ? (
              /* Tiptap Editor */
              <div className={`flex-1 flex overflow-auto ${isDarkMode ? 'bg-gray-900' : 'bg-white'} relative`}>
                {/* File Loading Overlay for Tiptap */}
                {isLoadingFile && (
                  <div 
                    className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 ${
                      isDarkMode ? 'bg-gray-900/90' : 'bg-white/90'
                    }`}
                    aria-live="polite"
                    aria-busy="true"
                  >
                    <svg 
                      className={`w-10 h-10 animate-spin ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} 
                      viewBox="0 0 24 24" 
                      fill="none"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                      Loading {loadingFileRef.current || currentFile || 'file'}...
                    </p>
                  </div>
                )}
                <div className="flex-1 flex flex-col items-center justify-start py-8 overflow-auto">
                  <div className="w-full max-w-4xl">
                    <TiptapEditor
                      content={content}
                      onChange={setContent}
                      projectId={projectId}
                      fileName={currentFile}
                      placeholder="Start writing your document..."
                      isDarkMode={isDarkMode}
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Split Screen for LaTeX */
              <div className="flex-1 flex min-h-0" style={{ overflow: 'hidden', width: '100%' }}>
                {/* Editor Panel - Integrated Chat */}
                <div
                  className={`flex flex-col border rounded min-h-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                  style={{ 
                    width: `calc(${editorWidth}% - 2px)`,
                    minWidth: 'calc(20% - 2px)',
                    maxWidth: 'calc(80% - 2px)',
                    height: '100%',
                    flexShrink: 0,
                    overflow: 'hidden',
                    boxSizing: 'border-box'
                  }}
                >
                {/* Main Editor Area */}
                <div className="flex-1 flex flex-col min-h-0 relative overflow-hidden">
                    {/* Context Menu (Right-Click Menu) */}
                    {showContextMenu && selectedText && isTexFile() && (
                      <div 
                        className="fixed z-50 w-72"
                        style={{ 
                          left: `${contextMenuPosition.x}px`, 
                          top: `${contextMenuPosition.y}px` 
                        }}
                      >
                        <div className={`rounded-lg shadow-xl border ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                          {/* Quick Edit: input at top (Cursor-style) */}
                          <div className={`p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                            <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Quick Edit</label>
                            <input
                              type="text"
                              placeholder="Edit selected code..."
                              className={`w-full px-3 py-2 rounded text-sm ${isDarkMode ? 'bg-gray-700 text-gray-200 border-gray-600' : 'bg-gray-50 text-gray-900 border-gray-300'} border focus:outline-none focus:ring-2 focus:ring-[var(--genlatex-primary)]`}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const prompt = e.target.value;
                                  if (prompt.trim()) {
                                    handleChatSend({ message: prompt.trim(), mode: 'execute', mentionedFiles: chatContextFiles.map(f => typeof f === 'string' ? f : f?.path).filter(Boolean) });
                                    setShowContextMenu(false);
                                  }
                                }
                                if (e.key === 'Escape') {
                                  setShowContextMenu(false);
                                }
                              }}
                              autoFocus
                            />
                          </div>
                          {/* Menu options */}
                          <div className="py-1">
                            <button
                              onClick={() => {
                                const fileName = currentFile ? currentFile.split('/').pop() : 'document.tex';
                                setChatContextSelection({
                                  filePath: currentFile,
                                  name: fileName,
                                  startLine: selectionRange?.startLineNumber ?? 1,
                                  endLine: selectionRange?.endLineNumber ?? 1,
                                  startColumn: selectionRange?.startColumn ?? 1,
                                  endColumn: selectionRange?.endColumn ?? 1,
                                  text: selectedText
                                });
                                setShowContextMenu(false);
                              }}
                              className={`w-full px-4 py-2 text-left flex items-center gap-2 rounded ${isDarkMode ? 'hover:bg-blue-900/30 text-gray-200' : 'hover:bg-blue-50 text-gray-900'}`}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isDarkMode ? 'text-blue-400' : 'text-blue-600'}>
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                              </svg>
                              Add to Chat
                            </button>
                            <button
                              onClick={() => {
                                const comment = window.prompt('Enter comment:');
                                if (comment) {
                                  setShowContextMenu(false);
                                }
                              }}
                              className={`w-full px-4 py-2 text-left flex items-center gap-2 rounded ${isDarkMode ? 'hover:bg-gray-700 text-gray-200' : 'hover:bg-gray-100 text-gray-900'}`}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                <line x1="9" y1="10" x2="15" y2="10"/>
                              </svg>
                              Leave a comment
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Click outside to close context menu */}
                    {showContextMenu && isTexFile() && (
                      <div 
                        className="fixed inset-0 z-40"
                        onClick={() => setShowContextMenu(false)}
                      />
                    )}
                    
                    {/* Selection Chat Popup - OLD (replaced by context menu) */}
                    {showSelectionChat && selectedText && isTexFile() && (
                      <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 w-96 max-w-[90%]">
                        <div className={`rounded-lg shadow-xl border ${isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                          <div className={`p-3 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-500">
                                  <path d="M12 2L2 7L12 12L22 7L12 2Z"/>
                                  <path d="M2 17L12 22L22 17"/>
                                  <path d="M2 12L12 17L22 12"/>
                                </svg>
                                <span className={`font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>AI Edit Selected Text</span>
                              </div>
                              <button
                                onClick={() => setShowSelectionChat(false)}
                                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                              >
                                ×
                              </button>
                            </div>
                            <div className={`mt-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {selectedText.length > 50 ? `${selectedText.substring(0, 50)}...` : selectedText}
                            </div>
                          </div>
                          <form onSubmit={(e) => {
                            e.preventDefault();
                            const formData = new FormData(e.target);
                            handleSelectionAIRequest({ message: formData.get('prompt') });
                          }}>
                            <div className="p-3">
                              <textarea
                                name="prompt"
                                placeholder="e.g., make it more formal, add details, simplify..."
                                className={`w-full p-2 border rounded resize-none ${isDarkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-gray-50 border-gray-300 text-gray-900'}`}
                                rows="2"
                                autoFocus
                              />
                              <button
                                type="submit"
                                disabled={isChatLoading}
                                className="mt-2 w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isChatLoading ? 'Processing...' : 'Apply AI Changes'}
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex flex-col flex-1 min-h-0 relative overflow-hidden">
                        {/* File Loading Overlay */}
                        {isLoadingFile && (
                          <div 
                            className={`absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 ${
                              isDarkMode 
                                ? 'bg-gray-900/90' 
                                : 'bg-white/90'
                            }`}
                            aria-live="polite"
                            aria-busy="true"
                          >
                            <svg 
                              className={`w-10 h-10 animate-spin ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} 
                              viewBox="0 0 24 24" 
                              fill="none"
                              aria-hidden="true"
                            >
                              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                              <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                            <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                              Loading {loadingFileRef.current || currentFile || 'file'}...
                            </p>
                          </div>
                        )}
                        {/* Editor Content - Keep Monaco mounted when in LaTeX mode to prevent blank editor after viewing images */}
                      <div className="flex-1 min-h-0 overflow-hidden relative">
                          {/* Monaco container - always mounted when in LaTeX mode, hidden when viewing images */}
                          <div 
                            id="monaco-container" 
                            className={`h-full w-full ${fileViewMode === 'editor' && isCurrentFileEditable() ? 'block' : 'hidden'}`}
                            style={{ backgroundColor: isDarkMode ? '#FFFFFF' : '#FFFFFF' }}
                            aria-hidden={fileViewMode !== 'editor' || !isCurrentFileEditable()}
                          />
                          {/* FileViewer for images/PDFs - shown when in viewer mode */}
                          <div className={`absolute inset-0 ${fileViewMode === 'viewer' || !isCurrentFileEditable() ? 'block' : 'hidden'}`}>
                            <FileViewer 
                              projectId={projectId}
                              filePath={currentFile}
                              fileViewMode={fileViewMode}
                            />
                          </div>
                        </div>
                        {/* Floating inline chat input */}
                        {fileViewMode === 'editor' && isTexFile() && (
                          <div className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none bg-transparent">
                            <div className="pointer-events-auto bg-transparent">
                              <ChatPopup
                                projectId={projectId}
                                currentDocument={content}
                                isOpen={true}
                                onClose={() => {}}
                                isDarkMode={isDarkMode}
                                variant="inline"
                                highlightedFiles={chatContextFiles}
                                highlightedSelection={chatContextSelection}
                                onRemoveFromContext={(path) => setChatContextFiles(prev => prev.filter(f => f.path !== path))}
                                onRemoveSelectionFromContext={() => setChatContextSelection(null)}
                                onAddToContext={(file) => setChatContextFiles(prev => prev.some(f => f.path === file.path) ? prev : [...prev, { path: file.path, name: file.name }])}
                                onClearHistory={() => setChatMessages([])}
                                externalMessages={chatMessages}
                                externalLoading={isChatLoading}
                                onSendMessage={handleChatSend}
                                onUpgrade={() => router.push('/dashboard?openUpgrade=1')}
                              />
                            </div>
                          </div>
                        )}
                        <LimitWarningModal
                          open={showChatLimitModal}
                          onClose={() => setShowChatLimitModal(false)}
                          onUpgrade={() => {
                            setShowChatLimitModal(false);
                            router.push('/dashboard?openUpgrade=1');
                          }}
                          limitType="chat"
                        />

                        {/* Document Stats removed to avoid overlap with chatbox */}
                    </div>
                  </div>
                </div>
                
                {/* Resizable Separator - Always show when PDF panel is visible */}
                {compileTarget && (
                  <div 
                    className={`cursor-col-resize hover:bg-blue-500 transition-colors flex items-center justify-center ${
                      isResizing ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                    onMouseDown={handleMouseDown}
                    ref={resizeRef}
                    title="Drag to resize panels"
                    style={{
                      width: '4px',
                      minWidth: '4px',
                      flexShrink: 0,
                      cursor: 'col-resize',
                      alignSelf: 'stretch'
                    }}
                  >
                    {/* Grip dots for visual feedback */}
                    <div className="flex flex-col gap-1 opacity-50 hover:opacity-100 transition-opacity">
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                      <div className="w-1 h-1 rounded-full bg-gray-600"></div>
                    </div>
                  </div>
                )}
                
                {/* PDF Panel - Always show when compileTarget is set */}
                {compileTarget && (
                  <div 
                    className={`relative flex flex-col border rounded min-h-0 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`}
                    style={{ 
                      width: `calc(${100 - editorWidth}% - 2px)`,
                      minWidth: 'calc(20% - 2px)',
                      maxWidth: 'calc(80% - 2px)',
                      height: '100%',
                      flexShrink: 0,
                      overflow: 'hidden',
                      boxSizing: 'border-box'
                    }}
                  >
                    {/* PDF Viewer */}
                    <div className="flex-1 min-h-0 overflow-hidden relative">
                      <PDFViewer
                        ref={pdfViewerRef}
                        key={`${projectId}-${compileTarget}-${pdfBust}`}
                        projectId={projectId}
                        src={`/api/pdf/${projectId}?b=${pdfBust}&target=${encodeURIComponent(compileTarget)}`}
                        onTextClick={handleErrorLineClick}
                        onTextSearch={handleTextSearch}
                        compilationError={(() => {
                          const criticalErrors = compilationErrors.filter(e => e.type === 'error' || e.severity === 'error');
                          return criticalErrors.length > 0 ? criticalErrors : null;
                        })()}
                        userMessage={compilationMessage}
                        onFixError={handleFixErrorWithAI}
                        onFixAllErrors={handleFixAllErrorsWithAI}
                        onApplyImageFix={handleApplyImageFix}
                        zoomScale={pdfZoom === 'fit' ? null : Number(pdfZoom) / 100}
                        onPageInfoChange={({ currentPage, totalPages }) => {
                          if (currentPage) setPdfCurrentPage(currentPage);
                          if (totalPages) setPdfTotalPages(totalPages);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            
            </div>
          </div>
        </div>
      </div>

      {/* Share Project Dialog */}
      {showShareDialog && (
        <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
          <DialogContent className="sm:max-w-2xl" style={{ maxHeight: '85vh', padding: '0' }}>
            <div style={{ padding: '32px' }}>
              <DialogHeader>
                <DialogTitle style={{ fontSize: '24px', fontWeight: '600', marginBottom: '8px' }}>
                  Share Project
                </DialogTitle>
                <DialogDescription style={{ fontSize: '15px', color: 'var(--gray-11)', marginBottom: '32px' }}>
                  Invite collaborators to work on <strong>"{projectMetadata?.name || 'this project'}"</strong>
                </DialogDescription>
              </DialogHeader>

            <Flex direction="column" gap="6" style={{ marginBottom: '32px' }}>
              {/* Email Input Section */}
              <Box>
                <Text size="3" weight="medium" style={{ color: 'var(--gray-12)', marginBottom: '8px', display: 'block' }}>
                  Email Addresses
                </Text>
                <Text size="2" style={{ color: 'var(--gray-11)', marginBottom: '12px', display: 'block' }}>
                  Enter email addresses separated by commas
                </Text>
                <TextField.Root
                  placeholder="colleague@example.com, partner@example.com"
                  value={shareEmails}
                  onChange={(e) => setShareEmails(e.target.value)}
                  disabled={shareLoading}
                  size="3"
                  style={{ width: '100%', fontSize: '15px', height: '48px', padding: '0 16px' }}
                />
              </Box>

              {/* Permission Selection */}
              <Box>
                <Text size="3" weight="medium" style={{ color: 'var(--gray-12)', marginBottom: '16px', display: 'block' }}>
                  Permission Level
                </Text>
                <RadioGroup.Root value={sharePermission} onValueChange={setSharePermission} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <Flex gap="3" align="start" style={{ 
                    padding: '16px', 
                    borderRadius: '8px', 
                    border: '2px solid', 
                    borderColor: sharePermission === 'view' ? 'var(--blue-7)' : 'var(--gray-5)',
                    backgroundColor: sharePermission === 'view' ? 'var(--blue-2)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }} onClick={() => setSharePermission('view')}>
                    <RadioGroup.Item value="view" />
                    <Flex direction="column" gap="2" style={{ flex: 1 }}>
                      <Flex align="center" gap="2">
                        <EyeOpenIcon width="18" height="18" />
                        <Text size="3" weight="medium" style={{ color: 'var(--gray-12)' }}>
                          View Only
                        </Text>
                      </Flex>
                      <Text size="2" style={{ color: 'var(--gray-11)' }}>
                        Can view and download, but cannot make changes
                      </Text>
                    </Flex>
                  </Flex>
                  
                  <Flex gap="3" align="start" style={{ 
                    padding: '16px', 
                    borderRadius: '8px', 
                    border: '2px solid', 
                    borderColor: sharePermission === 'edit' ? 'var(--green-7)' : 'var(--gray-5)',
                    backgroundColor: sharePermission === 'edit' ? 'var(--green-2)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }} onClick={() => setSharePermission('edit')}>
                    <RadioGroup.Item value="edit" />
                    <Flex direction="column" gap="2" style={{ flex: 1 }}>
                      <Flex align="center" gap="2">
                        <Pencil1Icon width="18" height="18" />
                        <Text size="3" weight="medium" style={{ color: 'var(--gray-12)' }}>
                          Can Edit
                        </Text>
                      </Flex>
                      <Text size="2" style={{ color: 'var(--gray-11)' }}>
                        Can view, edit, and collaborate on the project
                      </Text>
                    </Flex>
                  </Flex>
                </RadioGroup.Root>
              </Box>

              {/* Info Box */}
              <Box style={{ 
                padding: '24px 20px', 
                backgroundColor: 'var(--blue-2)', 
                borderRadius: '10px',
                border: '1px solid var(--blue-6)',
                cursor: 'pointer'
              }}>
                <Flex gap="2" align="center">
                  <Text size="2" style={{ color: 'var(--blue-11)', fontWeight: '500' }}>
                    💡 Invited users will receive an email with a secure link to access this project.
                  </Text>
                </Flex>
              </Box>
            </Flex>

            {/* Action Buttons */}
            <Flex justify="end" gap="3">
              <Button
                variant="soft"
                size="3"
                onClick={() => {
                  setShowShareDialog(false);
                  setShareEmails('');
                  setSharePermission('view');
                }}
                disabled={shareLoading}
                style={{ padding: '10px 24px', fontSize: '15px', fontWeight: '500' }}
              >
                Cancel
              </Button>
              <Button
                variant="solid"
                size="3"
                onClick={handleShareProject}
                disabled={shareLoading}
                style={{
                  backgroundColor: 'var(--accent-9)',
                  color: 'white',
                  padding: '10px 24px',
                  fontSize: '15px',
                  fontWeight: '600',
                  border: 'none'
                }}
              >
                {shareLoading ? 'Sharing...' : 'Share Project'}
              </Button>
            </Flex>
          </div>
        </DialogContent>
      </Dialog>
      )}

      {/* Rename Project Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={(open) => { setShowRenameDialog(open); if (!open) setRenameName(''); }}>
        <DialogContent className="sm:max-w-md" style={{ borderRadius: '12px', padding: '28px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
          <DialogHeader style={{ marginBottom: '8px' }}>
            <DialogTitle style={{ fontSize: '20px', fontWeight: '600', letterSpacing: '-0.02em', color: 'var(--gray-12)' }}>
              Rename Project
            </DialogTitle>
            <DialogDescription style={{ fontSize: '14px', color: 'var(--gray-11)', marginTop: '6px', lineHeight: 1.5 }}>
              Enter a new name for <span style={{ fontWeight: 600, color: 'var(--gray-12)' }}>&quot;{projectMetadata?.name || 'this project'}&quot;</span>
            </DialogDescription>
          </DialogHeader>
          <Box style={{ margin: '24px 0' }}>
            <Text size="2" weight="medium" style={{ color: 'var(--gray-12)', marginBottom: '8px', display: 'block' }}>
              Project name
            </Text>
            <TextField.Root
              placeholder="Enter project name..."
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              disabled={renameLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleRenameProjectSave(); } }}
              style={{
                fontSize: '15px',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--gray-6)',
                backgroundColor: 'var(--gray-1)'
              }}
            />
          </Box>
          <Flex justify="end" gap="3" style={{ marginTop: '8px', paddingTop: '24px', paddingBottom: '4px', borderTop: '1px solid var(--gray-4)' }}>
            <Button
              variant="soft"
              size="3"
              onClick={() => { setShowRenameDialog(false); setRenameName(''); }}
              disabled={renameLoading}
              className="cursor-pointer"
              style={{ borderRadius: '8px', padding: '10px 24px', cursor: 'pointer' }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="3"
              onClick={handleRenameProjectSave}
              disabled={renameLoading || !renameName?.trim()}
              className="cursor-pointer"
              style={{ backgroundColor: 'var(--accent-9)', color: 'white', borderRadius: '8px', padding: '10px 28px', cursor: 'pointer' }}
            >
              {renameLoading ? 'Saving...' : 'Save'}
            </Button>
          </Flex>
        </DialogContent>
      </Dialog>

      {/* Create File/Folder Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) setCreateName(''); }}>
        <DialogContent className="sm:max-w-md" style={{ borderRadius: '16px', padding: '24px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)' }}>
          <DialogHeader style={{ marginBottom: '8px' }}>
            <DialogTitle style={{ fontSize: '18px', fontWeight: '600' }}>
              {createType === 'folder' ? 'Create New Folder' : 'Create New File'}
            </DialogTitle>
            <DialogDescription style={{ fontSize: '14px', color: 'var(--gray-11)', marginTop: '4px' }}>
              {createType === 'folder'
                ? 'Enter a name for the new folder.'
                : 'Enter a name for the new file. Supported extensions: .tex, .bib, .sty, .cls, .md, .txt, .json, .csv, .yml, .yaml'}
            </DialogDescription>
          </DialogHeader>
          <Flex direction="column" gap="4" style={{ margin: '20px 0 24px' }}>
            <TextField.Root
              placeholder={createType === 'folder' ? 'Folder name' : 'File name (e.g., chapter1.tex)'}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              disabled={createLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateFileOrFolder(); } }}
              style={{ fontSize: '14px', padding: '12px 14px', borderRadius: '8px', border: '1px solid var(--gray-6)', backgroundColor: 'var(--gray-1)' }}
            />
          </Flex>
          <Flex justify="end" gap="3" style={{ paddingTop: '24px', paddingBottom: '4px', borderTop: '1px solid var(--gray-4)' }}>
            <Button
              variant="soft"
              size="3"
              onClick={() => { setShowCreateDialog(false); setCreateName(''); }}
              disabled={createLoading}
              className="cursor-pointer"
              style={{ borderRadius: '8px', padding: '10px 24px', cursor: 'pointer' }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="3"
              onClick={handleCreateFileOrFolder}
              disabled={createLoading || !createName?.trim()}
              className="cursor-pointer"
              style={{ backgroundColor: 'var(--accent-9)', color: 'white', borderRadius: '8px', padding: '10px 24px', cursor: 'pointer' }}
            >
              {createLoading ? 'Creating...' : 'Create'}
            </Button>
          </Flex>
        </DialogContent>
      </Dialog>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        user={user}
        projectId={projectId}
      />

    </div>
  );
}

export default function EditorPage(props) {
  return (
    <Suspense fallback={<PageLoading />}>
      <EditorPageContent {...props} />
    </Suspense>
  );
}
