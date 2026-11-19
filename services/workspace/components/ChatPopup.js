'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import LimitWarningModal from './LimitWarningModal';

// Flatten file tree to list of files
function flattenFiles(items, result = []) {
  if (!items) return result;
  for (const item of items) {
    if (item.type === 'file') {
      result.push({ path: item.path, name: item.name });
    }
    if (item.children?.length) {
      flattenFiles(item.children, result);
    }
  }
  return result;
}

export default function ChatPopup({ projectId, currentDocument, isOpen, onClose, isDarkMode = false, variant = 'popup', highlightedFiles = [], highlightedSelection = null, onRemoveFromContext, onRemoveSelectionFromContext, onAddToContext, onClearHistory, externalMessages = null, externalLoading = false, onSendMessage, onUpgrade }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atMenuQuery, setAtMenuQuery] = useState('');
  const [atMenuFiles, setAtMenuFiles] = useState([]);
  const [atMenuIndex, setAtMenuIndex] = useState(0);
  const [taggedImportedFiles, setTaggedImportedFiles] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatInfo, setChatInfo] = useState(null);
  const [limitModalOpen, setLimitModalOpen] = useState(false);
  const [limitModalType, setLimitModalType] = useState('chat');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const atMenuRef = useRef(null);
  const hasLoadedHistory = useRef(false);
  const availableFilesCache = useRef(null);
  const researchFilesCache = useRef(null);
  const handleSendMessageRef = useRef(null);

  // Use external messages when parent provides them (editor page with handleChatSend)
  const displayMessages = externalMessages != null && onSendMessage ? externalMessages : messages;
  const displayLoading = onSendMessage ? externalLoading : isLoading;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to latest message when messages change or when inline pane is reopened
  useEffect(() => {
    if (variant === 'inline' && !isExpanded) return;
    const id = setTimeout(scrollToBottom, 0);
    return () => clearTimeout(id);
  }, [displayMessages, isExpanded, variant]);

  // Focus input when popup opens or when loading finishes
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Re-focus input when loading finishes (after AI response completes)
  // This fixes the issue where users can't type after the response
  const prevLoadingRef = useRef(displayLoading);
  useEffect(() => {
    // Detect loading → not loading transition
    if (prevLoadingRef.current && !displayLoading && inputRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
    prevLoadingRef.current = displayLoading;
  }, [displayLoading]);

  // Handle click outside to collapse inline chat pane
  // Don't collapse while loading to prevent interrupting the user's view
  useEffect(() => {
    if (!isExpanded || variant !== 'inline') return;

    const handleClickOutside = (event) => {
      // Don't collapse if we're loading - user is likely watching the response
      if (displayLoading) return;
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, variant, displayLoading]);

  // Handle input focus to expand inline chat
  const handleInputFocus = () => {
    if (variant === 'inline') {
      setIsExpanded(true);
    }
  };

  // Toggle expanded state
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Fetch chat usage info (remaining daily chats)
  const fetchChatInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/usage');
      const data = await res.json();
      if (data.success && data.usage?.chat) {
        setChatInfo({
          isPro: data.usage.isPro,
          remaining: data.usage.chat.remaining,
          max: data.usage.chat.max,
          used: data.usage.chat.used,
          resetTime: data.usage.chat.resetTime
        });
      }
    } catch (err) {
      console.warn('[ChatPopup] Failed to fetch usage:', err);
    }
  }, []);

  useEffect(() => {
    if ((isOpen || variant === 'page' || (variant === 'inline' && isExpanded)) && projectId) {
      fetchChatInfo();
    }
  }, [isOpen, variant, isExpanded, projectId, fetchChatInfo]);

  // Load chat history from database on mount
  const loadChatHistory = useCallback(async () => {
    if (!projectId) return;
    if (hasLoadedHistory.current) return;
    
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`/api/chat/${projectId}/messages?limit=100`);
      const data = await response.json();
      
      if (data.success && data.messages) {
        const formattedMessages = data.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          messageType: msg.messageType,
          metadata: msg.metadata
        }));
        setMessages(formattedMessages);
        hasLoadedHistory.current = true;
      }
    } catch (error) {
      console.error('[ChatPopup] Failed to load chat history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [projectId]);

  useEffect(() => {
    // Only load own history when NOT using external messages
    if (externalMessages != null && onSendMessage) return;
    if (isOpen || variant === 'page' || (variant === 'inline' && isExpanded)) {
      loadChatHistory();
    }
  }, [isOpen, variant, isExpanded, loadChatHistory, externalMessages, onSendMessage]);

  // Fetch project files for @ menu
  const fetchProjectFiles = useCallback(async () => {
    if (!projectId) return [];
    if (availableFilesCache.current) return availableFilesCache.current;
    try {
      const res = await fetch(`/api/files/${projectId}/tree`);
      const data = await res.json();
      if (data.files) {
        const flat = flattenFiles(data.files).map(f => ({ ...f, type: 'project' }));
        availableFilesCache.current = flat;
        return flat;
      }
    } catch (err) {
      console.error('[ChatPopup] Failed to fetch project files for @ menu:', err);
    }
    return [];
  }, [projectId]);

  // Fetch research (imported) files for @ menu
  const fetchResearchFiles = useCallback(async () => {
    if (!projectId) return [];
    if (researchFilesCache.current) return researchFilesCache.current;
    try {
      const res = await fetch(`/api/files/${projectId}/research`);
      const data = await res.json();
      if (data.success && Array.isArray(data.files)) {
        const list = data.files.map(f => ({
          type: 'research',
          fileId: f.fileId,
          fileName: f.fileName || f.file_name,
          name: (f.fileName || f.file_name || 'imported') + ' (imported)',
        })).filter(f => f.fileId);
        researchFilesCache.current = list;
        return list;
      }
    } catch (err) {
      console.error('[ChatPopup] Failed to fetch research files for @ menu:', err);
    }
    return [];
  }, [projectId]);

  // Handle @ menu: detect @ in input, show dropdown, filter files (project + imported)
  const handleInputChange = useCallback((e) => {
    const v = e.target.value;
    setInputValue(v);
    const cursorPos = e.target.selectionStart ?? v.length;
    const beforeCursor = v.slice(0, cursorPos);
    const lastAt = beforeCursor.lastIndexOf('@');
    const needsContext = onAddToContext || true;
    if (lastAt === -1 || !projectId) {
      setAtMenuOpen(false);
      return;
    }
    const query = beforeCursor.slice(lastAt + 1).toLowerCase();
    const hasSpace = /\s/.test(query);
    if (hasSpace) {
      setAtMenuOpen(false);
      return;
    }
    setAtMenuQuery(query);
    setAtMenuOpen(true);
    setAtMenuIndex(0);
    Promise.all([fetchProjectFiles(), fetchResearchFiles()]).then(([projectFiles, researchFiles]) => {
      const highlightedPaths = new Set(
        (highlightedFiles || []).map(f => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
      );
      const taggedIds = new Set((taggedImportedFiles || []).map(f => f.fileId).filter(Boolean));
      const combined = [
        ...projectFiles.filter(f => {
          const match = (f.name || '').toLowerCase().includes(query) || (f.path || '').toLowerCase().includes(query);
          return match && !highlightedPaths.has(f.path);
        }),
        ...researchFiles.filter(f => {
          const match = (f.name || f.fileName || '').toLowerCase().includes(query);
          return match && !taggedIds.has(f.fileId);
        }),
      ];
      setAtMenuFiles(combined.slice(0, 12));
    });
  }, [projectId, onAddToContext, highlightedFiles, taggedImportedFiles, fetchProjectFiles, fetchResearchFiles]);

  const selectAtFile = useCallback((file) => {
    if (!file) return;
    const v = inputValue;
    const cursorPos = inputRef.current?.selectionStart ?? v.length;
    const beforeCursor = v.slice(0, cursorPos);
    const lastAt = beforeCursor.lastIndexOf('@');
    const afterCursor = v.slice(cursorPos);
    const newValue = v.slice(0, lastAt) + afterCursor;
    setInputValue(newValue);
    setAtMenuOpen(false);
    if (file.type === 'research') {
      setTaggedImportedFiles(prev => {
        if (prev.some(f => f.fileId === file.fileId)) return prev;
        return [...prev, { fileId: file.fileId, fileName: file.fileName || file.name }];
      });
    } else if (onAddToContext) {
      onAddToContext(file);
    }
    inputRef.current?.focus();
    setTimeout(() => {
      if (inputRef.current) {
        const pos = Math.min(lastAt, newValue.length);
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  }, [inputValue, onAddToContext]);

  const handleInputKeyDown = useCallback((e) => {
    if (atMenuOpen && atMenuFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAtMenuIndex(i => Math.min(i + 1, atMenuFiles.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAtMenuIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' && atMenuFiles[atMenuIndex]) {
        e.preventDefault();
        selectAtFile(atMenuFiles[atMenuIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setAtMenuOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessageRef.current?.();
    }
  }, [atMenuOpen, atMenuFiles, atMenuIndex, selectAtFile]);

  // Keep send handler ref updated for keydown
  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  });

  // Close @ menu on click outside (atMenuRef wraps input + dropdown)
  useEffect(() => {
    const handleClick = (e) => {
      if (atMenuRef.current && !atMenuRef.current.contains(e.target)) {
        setAtMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Save message to database
  const saveMessage = async (role, content, messageType = 'user_message', metadata = {}) => {
    if (!projectId) return null;
    
    try {
      const response = await fetch(`/api/chat/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, messageType, metadata })
      });
      
      const data = await response.json();
      if (data.success) {
        return data.message;
      }
    } catch (error) {
      console.error('[ChatPopup] Failed to save message:', error);
    }
    return null;
  };

  const handleSendMessage = async (message = inputValue) => {
    if (!message.trim()) return;
    if (displayLoading) return;

    setInputValue('');
    setIsLoading(true);

    // Use parent's handler when provided (editor page with streaming, code application, etc.)
    if (onSendMessage) {
      try {
        const mentionedFiles = Array.isArray(highlightedFiles)
          ? highlightedFiles.map(f => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
          : [];
        const taggedImportedFileIds = (taggedImportedFiles || []).map(f => f.fileId).filter(Boolean);
        await onSendMessage({ message, mode: 'chat', mentionedFiles, taggedImportedFileIds });
      } catch (err) {
        console.error('[ChatPopup] Send error:', err);
        // Parent handles error display via externalMessages
      } finally {
        setIsLoading(false);
        fetchChatInfo();
      }
      return;
    }

    const userMessage = { role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);

    // Save user message
    try {
      await saveMessage('user', message, 'user_message');
    } catch (err) {
      console.error('[ChatPopup] Error saving user message:', err);
    }

    try {
      const mentionedFiles = Array.isArray(highlightedFiles)
        ? highlightedFiles.map(f => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
        : [];
      const taggedImportedFileIds = (taggedImportedFiles || []).map(f => f.fileId).filter(Boolean);
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          projectId,
          currentDocument,
          mentionedFiles,
          taggedImportedFileIds,
          stream: false
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        const assistantContent = data.response || 'No response received.';
        const messageType = data.code ? 'code_modification' : 'text_response';
        const metadata = data.code ? { 
          codeSummary: `Generated code response`,
          filesModified: data.files_modified || []
        } : {};
        
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: assistantContent,
          messageType,
          metadata
        }]);
        
        // Save assistant response
        try {
          await saveMessage('assistant', assistantContent, messageType, metadata);
        } catch (err) {
          console.error('[ChatPopup] Error saving assistant message:', err);
        }
      } else {
        const errorMsg = data.error || data.message || 'Sorry, I encountered an error. Please try again.';
        if (response.status === 429 && (data.error === 'daily_chat_limit' || data.message?.includes('limit'))) {
          setLimitModalType('chat');
          setLimitModalOpen(true);
        }
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: 'Sorry, I encountered an error. Please try again.' 
      }]);
    } finally {
      setIsLoading(false);
      fetchChatInfo(); // Refresh remaining count
    }
  };

  const isPage = variant === 'page';
  const isInline = variant === 'inline';
  if (!isOpen && !isPage && !isInline) return null;

  return (
    <>
      {/* Backdrop */}
      {!isPage && !isInline && (
        <div 
          className="fixed inset-0 z-40"
          onClick={onClose}
        />
      )}
      
      {/* Chat Popup / Page / Inline */}
      <div 
        ref={containerRef}
        className={`${isPage ? 'relative w-full h-full flex flex-col' : isInline ? 'relative w-full flex flex-col' : 'fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-xl'} ${
          isInline && isExpanded
            ? `rounded-2xl shadow-2xl border overflow-hidden flex flex-col ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`
            : isInline
              ? 'bg-transparent border-transparent shadow-none'
              : `rounded-2xl shadow-2xl border overflow-hidden ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'}`
        }`}
        style={isPage ? {} : isInline && isExpanded ? { maxHeight: '70vh', minHeight: '280px' } : { maxHeight: '70vh' }}
      >
        {/* Top drag handle + Header for expanded inline chat (dedicated pane) */}
        {isInline && isExpanded && (
          <>
            <div
              className={`flex-shrink-0 h-1 rounded-t-2xl cursor-grab active:cursor-grabbing ${
                isDarkMode ? 'bg-gray-600' : 'bg-gray-300'
              }`}
              title="Chat pane"
              aria-hidden
            />
            <div className={`flex-shrink-0 px-4 py-3 border-b flex items-center justify-between ${
              isDarkMode ? 'border-gray-700' : 'border-gray-200'
            }`}>
              <span className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                Chat with GenLaTeX AI
              </span>
              <div className="flex items-center gap-1.5">
                {displayMessages.length > 0 && projectId && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/chat/${projectId}/messages`, { method: 'DELETE' });
                        const data = await res.json();
                        if (data.success) {
                          if (onClearHistory) onClearHistory();
                          else setMessages([]);
                        }
                      } catch (err) {
                        console.error('[ChatPopup] Failed to clear history:', err);
                      }
                    }}
                    className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                      isDarkMode
                        ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}
                    title="Clear chat history"
                  >
                    Clear history
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  title="Close chat pane"
                  aria-label="Close chat pane"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        )}

        {/* Header (popup only) */}
        {!isPage && !isInline && (
          <>
          <div className={`px-5 py-4 border-b flex items-center justify-between ${
            isDarkMode ? 'border-gray-700' : 'border-gray-100'
          }`}>
            <div>
              <h2 className={`text-base font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                Welcome to GenLaTeX AI!
              </h2>
              <p className={`text-sm mt-0.5 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                AI helps you write and refine LaTeX—supports explanations, proofs, citations, and summaries.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {displayMessages.length > 0 && projectId && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/chat/${projectId}/messages`, { method: 'DELETE' });
                      const data = await res.json();
                      if (data.success) {
                        if (onClearHistory) onClearHistory();
                        else setMessages([]);
                      }
                    } catch (err) {
                      console.error('[ChatPopup] Failed to clear history:', err);
                    }
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${
                    isDarkMode
                      ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                  title="Clear chat history"
                >
                  Clear history
                </button>
              )}
              <button 
                onClick={onClose}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDarkMode 
                    ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-700' 
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          </>
        )}

        {/* Messages Area - dedicated pane: full conversation history when expanded (persistent, scrollable) */}
        {((!isInline && displayMessages.length > 0) || (isInline && isExpanded)) && (
          <div className={`${isPage ? 'flex-1 min-h-0 overflow-y-auto p-6' : isInline ? 'flex-1 min-h-0 overflow-y-auto p-4' : 'max-h-64 overflow-y-auto p-4'} space-y-3`}>
            {(!onSendMessage && isLoadingHistory) ? (
              <div className="flex items-center justify-center py-4">
                <div className={`animate-spin rounded-full h-6 w-6 border-2 border-t-transparent ${
                  isDarkMode ? 'border-blue-400' : 'border-blue-500'
                }`}></div>
              </div>
            ) : displayMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                }`}>
                  <svg className={`w-6 h-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                </div>
                <p className={`text-sm font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  Start a conversation
                </p>
                <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                  Ask questions about your LaTeX document
                </p>
                {onSendMessage && (
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {['Explain this section', 'Improve wording', 'Add citation'].map((prompt) => (
                      <button
                        key={prompt}
                        onClick={() => {
                          const mentionedFiles = Array.isArray(highlightedFiles)
                            ? highlightedFiles.map(f => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
                            : [];
                          const taggedImportedFileIds = (taggedImportedFiles || []).map(f => f.fileId).filter(Boolean);
                          onSendMessage({ message: prompt, mode: 'chat', mentionedFiles, taggedImportedFileIds });
                        }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          isDarkMode
                            ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              displayMessages.map((message, index) => (
                <div
                  key={message.id ?? `msg-${index}`}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : isDarkMode 
                          ? 'bg-gray-700 text-gray-200' 
                          : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      <div className="chat-markdown prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                        <ReactMarkdown
                          components={{
                            p: ({ node, ...props }) => <p className="whitespace-pre-wrap mb-1.5 last:mb-0" {...props} />,
                            ul: ({ node, ...props }) => <ul className="list-disc pl-4 my-1.5" {...props} />,
                            ol: ({ node, ...props }) => <ol className="list-decimal pl-4 my-1.5" {...props} />,
                            li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
                            strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
                            code: ({ node, inline, ...props }) =>
                              inline ? (
                                <code className="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-xs" {...props} />
                              ) : (
                                <code className="block p-2 rounded bg-black/10 dark:bg-white/10 text-xs overflow-x-auto my-1" {...props} />
                              )
                          }}
                        >
                          {String(message.content ?? '')}
                        </ReactMarkdown>
                        {(() => {
                          const toolCalls = message.toolCalls || message.metadata?.toolCalls || [];
                          if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;
                          return (
                            <div className={`mt-2 rounded-lg px-2 py-1.5 text-[11px] leading-relaxed ${
                              isDarkMode ? 'bg-black/20 text-gray-300' : 'bg-black/5 text-gray-600'
                            }`}>
                              <div className="font-medium mb-1">Processing</div>
                              {toolCalls.map((call, idx) => {
                                let label = '';
                                if (call.type === 'status') label = `• ${call.message}`;
                                else if (call.type === 'tool') label = `• Tool: ${call.tool}`;
                                else if (call.type === 'result') label = `• Result: ${call.tool} ${call.success ? '✓' : '✕'}`;
                                else if (call.type === 'file_saved') {
                                  const name = call.file_path ? call.file_path.split('/').pop() : 'file';
                                  label = `• Saved: ${name}`;
                                } else label = `• ${call.tool || call.message || 'Activity'}`;
                                return <div key={`${call.type || 'activity'}-${idx}`}>{label}</div>;
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                </div>
              ))
            )}
            {displayLoading && (
              <div className="flex justify-start">
                <div className={`px-4 py-2.5 rounded-2xl ${
                  isDarkMode ? 'bg-gray-700' : 'bg-gray-100'
                }`}>
                  <div className="flex items-center gap-2">
                    <div className={`animate-spin rounded-full h-4 w-4 border-2 border-t-transparent ${
                      isDarkMode ? 'border-blue-400' : 'border-blue-500'
                    }`}></div>
                    <span className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>Thinking...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Empty State for Page Variant */}
        {isPage && displayMessages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
            <h2 className={`text-2xl font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}>
              Ready when you are!
            </h2>
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (onSendMessage) {
                    const mentionedFiles = Array.isArray(highlightedFiles)
                      ? highlightedFiles.map(f => (typeof f === 'string' ? f : f?.path)).filter(Boolean)
                      : [];
                    const taggedImportedFileIds = (taggedImportedFiles || []).map(f => f.fileId).filter(Boolean);
                    onSendMessage({ message: 'Summarize this document', mode: 'chat', mentionedFiles, taggedImportedFileIds });
                  } else {
                    handleSendMessage('Summarize this document');
                  }
                }}
                className={`px-4 py-2 rounded-full text-sm ${isDarkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                Summarize
              </button>
            </div>
          </div>
        )}

        {/* Input Area - flex-shrink-0 so it stays visible when pane expanded */}
        <div className={`flex-shrink-0 ${isInline && !isExpanded ? 'px-0 py-0' : isInline ? 'px-4 py-3' : 'px-4 py-4'} ${displayMessages.length > 0 && !isInline ? `border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-100'}` : ''} ${isInline && isExpanded ? `border-t ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}` : ''}`}>
          {/* Pinned LaTeX selection in context (shown at top like file pills) */}
          {highlightedSelection && (
            <div className={`flex flex-wrap gap-1.5 mb-2 px-1`}>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                  isDarkMode
                    ? 'bg-blue-900/40 text-blue-200 border border-blue-700/50'
                    : 'bg-blue-50 text-blue-700 border border-blue-200'
                } ${onRemoveSelectionFromContext ? 'pr-1' : ''}`}
                title={highlightedSelection.text ? `${highlightedSelection.name} (L${highlightedSelection.startLine}-${highlightedSelection.endLine}): ${highlightedSelection.text.length > 80 ? highlightedSelection.text.substring(0, 80) + '...' : highlightedSelection.text}` : `${highlightedSelection.name} (L${highlightedSelection.startLine}-${highlightedSelection.endLine})`}
              >
                <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M3.051 7.684a1 1 0 011.265-.633l12 4a1 1 0 11-.632 1.898l-12-4a1 1 0 01-.633-1.265z" clipRule="evenodd" />
                </svg>
                <span className="truncate max-w-[140px]">{highlightedSelection.name} ({highlightedSelection.startLine}-{highlightedSelection.endLine})</span>
                {onRemoveSelectionFromContext && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onRemoveSelectionFromContext(); }}
                    className={`p-0.5 rounded hover:bg-black/10 ${isDarkMode ? 'hover:bg-white/10' : ''}`}
                    title="Remove selection from context"
                    aria-label="Remove selection from context"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          )}
          {/* Highlighted files in context */}
          {highlightedFiles?.length > 0 && (
            <div className={`flex flex-wrap gap-1.5 mb-2 px-1`}>
              {highlightedFiles.map((f) => {
                const path = typeof f === 'string' ? f : f?.path;
                const name = typeof f === 'string' ? f.split('/').pop() : f?.name || path?.split('/').pop();
                if (!path) return null;
                return (
                  <span
                    key={path}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                      isDarkMode
                        ? 'bg-blue-900/40 text-blue-200 border border-blue-700/50'
                        : 'bg-blue-50 text-blue-700 border border-blue-200'
                    } ${onRemoveFromContext ? 'pr-1' : ''}`}
                    title={path}
                  >
                    <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    <span className="truncate max-w-[120px]">{name}</span>
                    {onRemoveFromContext && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onRemoveFromContext(path); }}
                        className={`p-0.5 rounded hover:bg-black/10 ${isDarkMode ? 'hover:bg-white/10' : ''}`}
                        title="Remove from context"
                        aria-label="Remove from context"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {taggedImportedFiles?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2 px-1">
              {taggedImportedFiles.map((f) => (
                <span
                  key={f.fileId}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs pr-1 ${
                    isDarkMode
                      ? 'bg-amber-900/40 text-amber-200 border border-amber-700/50'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'
                  }`}
                  title={`Imported: ${f.fileName || f.fileId}`}
                >
                  <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  <span className="truncate max-w-[120px]">{f.fileName || f.fileId}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTaggedImportedFiles((prev) => prev.filter((x) => x.fileId !== f.fileId));
                    }}
                    className={`p-0.5 rounded hover:bg-black/10 ${isDarkMode ? 'hover:bg-white/10' : ''}`}
                    title="Remove from context"
                    aria-label="Remove from context"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={`relative flex items-center gap-2 px-4 py-3 rounded-full border shadow-sm ${
            isDarkMode 
              ? 'bg-gray-700 border-gray-600' 
              : 'bg-white border-gray-200'
          }`} ref={atMenuRef}>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onFocus={handleInputFocus}
              placeholder={onAddToContext ? "Ask anything (type @ to add files to context)" : "Ask anything"}
              className={`flex-1 bg-transparent text-sm outline-none ${
                isDarkMode 
                  ? 'text-white placeholder-gray-400' 
                  : 'text-gray-900 placeholder-gray-500'
              }`}
              aria-busy={displayLoading}
            />
            {/* @ file mention dropdown */}
            {atMenuOpen && (
              <div
                className={`absolute bottom-full left-2 right-2 mb-1 max-h-48 overflow-y-auto rounded-lg border shadow-lg z-50 ${
                  isDarkMode ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
                }`}
              >
                {atMenuFiles.length === 0 ? (
                  <div className={`px-3 py-2 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {atMenuQuery ? 'No matching files' : 'Type to search files...'}
                  </div>
                ) : (
                  atMenuFiles.map((file, i) => (
                    <button
                      key={file.path ?? file.fileId}
                      type="button"
                      onClick={() => selectAtFile(file)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                        i === atMenuIndex
                          ? isDarkMode ? 'bg-blue-900/50 text-blue-200' : 'bg-blue-50 text-blue-800'
                          : isDarkMode ? 'text-gray-200 hover:bg-gray-700' : 'text-gray-800 hover:bg-gray-100'
                      }`}
                    >
                      <svg className="w-4 h-4 flex-shrink-0 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                      <span className="truncate min-w-0" title={file.path ?? (file.fileName ? `Imported: ${file.fileName}` : file.fileId)}>{file.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            
            {/* Action buttons */}
            <div className="flex items-center gap-1.5">
              {/* Send button */}
              <button
                onClick={() => handleSendMessage()}
                disabled={displayLoading || !inputValue.trim()}
                className={`rounded-lg transition-colors p-1.5 ${
                  inputValue.trim() && !displayLoading
                    ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-50'
                    : isDarkMode 
                      ? 'text-gray-600 cursor-not-allowed' 
                      : 'text-gray-300 cursor-not-allowed'
                }`}
                title="Send message"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
          </div>
          {displayLoading && (
            <div className={`mt-2 flex items-center gap-2 text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              <div className={`animate-spin rounded-full h-3 w-3 border-2 border-t-transparent ${
                isDarkMode ? 'border-blue-400' : 'border-blue-500'
              }`}></div>
              <span>AI is working... you can keep typing.</span>
            </div>
          )}
        </div>
      </div>
      <LimitWarningModal
        open={limitModalOpen}
        onClose={() => setLimitModalOpen(false)}
        onUpgrade={onUpgrade}
        limitType={limitModalType}
        resetDate={chatInfo?.resetTime}
      />
    </>
  );
}
