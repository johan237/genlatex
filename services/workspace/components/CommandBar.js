// SPDX-License-Identifier: MIT

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTheme } from 'next-themes';
import FileMentionAutocomplete from './FileMentionAutocomplete';

export default function CommandBar({ 
  mode, 
  onModeChange, 
  onSend, 
  onToggleExpand, 
  isExpanded, 
  projectId,
  isLoading = false 
}) {
  const [inputValue, setInputValue] = useState('');
  const [mentionedFiles, setMentionedFiles] = useState([]);
  const [isFocused, setIsFocused] = useState(false);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionPosition, setMentionPosition] = useState(0);
  
  const textareaRef = useRef(null);
  const { theme } = useTheme();


  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [inputValue]);

  // Handle @ mention detection
  const handleInputChange = (e) => {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    setInputValue(value);
    
    // Check for @ mention
    const beforeCursor = value.substring(0, cursorPos);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    
    if (atMatch) {
      setShowMentionDropdown(true);
      setMentionQuery(atMatch[1]);
      setMentionPosition(cursorPos - atMatch[0].length);
    } else {
      setShowMentionDropdown(false);
    }
  };

  const handleMentionSelect = (filePath) => {
    const beforeMention = inputValue.substring(0, mentionPosition);
    const afterMention = inputValue.substring(mentionPosition + mentionQuery.length + 1);
    const newValue = beforeMention + `@${filePath}` + afterMention;
    
    setInputValue(newValue);
    setShowMentionDropdown(false);
    
    // Add to mentioned files if not already present
    if (!mentionedFiles.includes(filePath)) {
      setMentionedFiles(prev => [...prev, filePath]);
    }
    
    // Focus back to textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  };

  const removeMentionedFile = (filePath) => {
    setMentionedFiles(prev => prev.filter(f => f !== filePath));
    // Remove @filePath from input
    const newValue = inputValue.replace(new RegExp(`@${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), '');
    setInputValue(newValue);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim() && !isLoading) {
      onSend({
        message: inputValue.trim(),
        mode,
        mentionedFiles: [...mentionedFiles]
      });
      setInputValue('');
      setMentionedFiles([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      setShowMentionDropdown(false);
    }
  };

  const toggleMode = useCallback(() => {
    onModeChange(mode === 'execute' ? 'chat' : 'execute');
  }, [mode, onModeChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl+K to focus input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
      
      // Cmd/Ctrl+L to toggle mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        toggleMode();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleMode]);

  return (
    <div className="relative">
      {/* File Mention Dropdown */}
      {showMentionDropdown && (
        <div className="absolute bottom-full left-0 mb-2 w-full max-w-md">
          <FileMentionAutocomplete
            projectId={projectId}
            query={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setShowMentionDropdown(false)}
          />
        </div>
      )}

             {/* Command Bar */}
             <form onSubmit={handleSubmit} className="relative">
               <div
                 className={`
                   flex flex-col transition-all duration-300
                   ${theme === 'dark'
                     ? 'bg-gray-700'
                     : 'bg-gray-50'
                   }
                   ${isFocused
                     ? 'ring-2 ring-blue-500'
                     : ''
                   }
                 `}
               >
          {/* Top Bar with Mode Toggle and History Toggle */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            {/* Mode Toggle - Left */}
            <button
              type="button"
              onClick={toggleMode}
              className={`
                flex items-center gap-1 px-2 py-1 text-xs rounded transition-all duration-200
                ${mode === 'execute'
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-[#2563EB] text-white hover:bg-blue-700'
                }
                focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20
              `}
              title={`Switch to ${mode === 'execute' ? 'Chat' : 'Agent'} mode`}
            >
              <span>{mode === 'execute' ? 'Agent' : 'Chat'}</span>
              <span className="text-xs">Ctrl+I</span>
            </button>

            {/* History Toggle - Top Right */}
            <button
              type="button"
              onClick={onToggleExpand}
              className={`
                p-2 rounded-full transition-all duration-200
                ${theme === 'dark' 
                  ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' 
                  : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                }
                focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20
              `}
              title={isExpanded ? "Collapse chat history" : "Expand chat history"}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
              >
                <polyline points="6,9 12,15 18,9"/>
              </svg>
            </button>
          </div>

          {/* Full Width Input Area */}
          <div className="p-3">
            {/* File Chips */}
            {mentionedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {mentionedFiles.map((filePath) => (
                  <div
                    key={filePath}
                    className={`
                      flex items-center gap-1 px-2 py-1 rounded text-xs
                      ${theme === 'dark' 
                        ? 'bg-gray-700 text-gray-200' 
                        : 'bg-gray-100 text-gray-700'
                      }
                    `}
                  >
                    <span>@{filePath}</span>
                    <button
                      type="button"
                      onClick={() => removeMentionedFile(filePath)}
                      className="hover:text-red-500"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input Field - Full Width */}
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={mode === 'execute' ? "Ask AI to make changes..." : "Ask a question..."}
                disabled={isLoading}
                className={`
                  flex-1 resize-none border-0 outline-none bg-transparent
                  placeholder:text-gray-400 text-sm leading-relaxed
                  ${theme === 'dark' ? 'text-gray-100' : 'text-gray-900'}
                  ${isLoading ? 'cursor-not-allowed' : ''}
                  font-sans
                `}
                style={{ 
                  minHeight: '20px',
                  maxHeight: '120px',
                  overflow: 'auto'
                }}
              />

              {/* Send Button */}
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className={`
                  p-2 rounded transition-all duration-200
                  ${inputValue.trim() && !isLoading
                    ? 'bg-[#2563EB] text-white hover:bg-[#1d4ed8] shadow-sm hover:shadow-md'
                    : theme === 'dark'
                      ? 'text-gray-600 bg-gray-700 cursor-not-allowed'
                      : 'text-gray-400 bg-gray-100 cursor-not-allowed'
                  }
                  focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20
                  disabled:cursor-not-allowed
                `}
                title="Send message"
              >
                {isLoading ? (
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                    className="animate-spin"
                  >
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                ) : (
                  <svg 
                    width="16" 
                    height="16" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22,2 15,22 11,13 2,9 22,2"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        
        {/* Hidden submit button for Enter key */}
        <button type="submit" className="hidden" />
      </form>
    </div>
  );
}
