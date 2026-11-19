// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect } from 'react';

export default function EditorToolbar({ editorRef, onInsert, onShowResearchIntegration }) {
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showTextTypes, setShowTextTypes] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Update undo/redo button states
  useEffect(() => {
    if (!editorRef.current) return;

    const editor = editorRef.current;
    
    const updateUndoRedoState = () => {
      setCanUndo(editor.getModel()?.canUndo() || false);
      setCanRedo(editor.getModel()?.canRedo() || false);
    };

    // Initial state
    updateUndoRedoState();

    // Listen for content changes
    const dispose = editor.onDidChangeModelContent(() => {
      updateUndoRedoState();
    });

    return () => dispose.dispose();
  }, [editorRef.current]);

  const insertText = (text) => {
    if (editorRef.current && window.monaco) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      const range = new window.monaco.Range(
        selection.startLineNumber,
        selection.startColumn,
        selection.endLineNumber,
        selection.endColumn
      );
      const operation = {
        range: range,
        text: text,
        forceMoveMarkers: true
      };
      editor.executeEdits('insert-text', [operation]);
      editor.focus();
    }
    setShowInsertMenu(false);
  };

  const insertLaTeXCommand = (command, placeholder = '') => {
    if (editorRef.current && window.monaco) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      const selectedText = editor.getModel().getValueInRange(selection);
      
      // If text is selected, wrap it with the LaTeX command
      if (selectedText && selectedText.trim()) {
        const wrappedText = `\\${command}{${selectedText}}`;
        const range = new window.monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        );
        const operation = {
          range: range,
          text: wrappedText,
          forceMoveMarkers: true
        };
        editor.executeEdits('wrap-text', [operation]);
      } else {
        // If no text is selected, insert command with placeholder
        const text = `\\${command}{${placeholder}}`;
        insertText(text);
      }
      editor.focus();
    }
  };

  const insertLaTeXEnvironment = (env, content = '') => {
    if (editorRef.current && window.monaco) {
      const editor = editorRef.current;
      const selection = editor.getSelection();
      const selectedText = editor.getModel().getValueInRange(selection);
      
      // If text is selected, wrap it with the LaTeX environment
      if (selectedText && selectedText.trim()) {
        const wrappedText = `\\begin{${env}}\n${selectedText}\n\\end{${env}}`;
        const range = new window.monaco.Range(
          selection.startLineNumber,
          selection.startColumn,
          selection.endLineNumber,
          selection.endColumn
        );
        const operation = {
          range: range,
          text: wrappedText,
          forceMoveMarkers: true
        };
        editor.executeEdits('wrap-environment', [operation]);
      } else {
        // If no text is selected, insert environment with placeholder
        const text = `\\begin{${env}}\n${content}\n\\end{${env}}`;
        insertText(text);
      }
      editor.focus();
    }
  };

  const textTypes = [
    { name: 'Normal', command: '' },
    { name: 'Title', command: 'title' },
    { name: 'Subtitle', command: 'subtitle' },
    { name: 'Paragraph', command: 'paragraph' },
    { name: 'Section', command: 'section' },
    { name: 'Subsection', command: 'subsection' },
    { name: 'Subsubsection', command: 'subsubsection' }
  ];

  const insertOptions = [
    { name: 'Table', action: () => insertLaTeXEnvironment('table', '\\centering\n\\begin{tabular}{|c|c|}\n\\hline\nCell 1 & Cell 2 \\\\\n\\hline\n\\end{tabular}') },
    { name: 'Figure', action: () => insertLaTeXEnvironment('figure', '\\centering\n\\includegraphics[width=0.8\\textwidth]{images/example.png}\n\\caption{Your caption here}') },
    { name: 'Link', action: () => insertLaTeXCommand('href', 'https://example.com', 'Link Text') },
    { name: 'Comment', action: () => insertText('% Your comment here') },
    { name: 'Citation', action: () => insertLaTeXCommand('cite', 'reference') },
    { name: 'Bullet List', action: () => insertLaTeXEnvironment('itemize', '\\item First item\n\\item Second item') },
    { name: 'Numbered List', action: () => insertLaTeXEnvironment('enumerate', '\\item First item\n\\item Second item') }
  ];

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 border-b border-gray-200">
      {/* Text Formatting */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => insertLaTeXCommand('textbf', 'bold text')}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 font-bold text-gray-900"
          title="Bold"
        >
          B
        </button>
        <button
          onClick={() => insertLaTeXCommand('textit', 'italic text')}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 italic text-gray-900"
          title="Italic"
        >
          I
        </button>
        <button
          onClick={() => insertLaTeXCommand('underline', 'underlined text')}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 underline text-gray-900"
          title="Underline"
        >
          U
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Text Types */}
      <div className="relative">
        <button
          onClick={() => setShowTextTypes(!showTextTypes)}
          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1 text-gray-900"
        >
          Text Types
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {showTextTypes && (
          <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-10 min-w-[120px]">
            {textTypes.map((type) => (
              <button
                key={type.name}
                onClick={() => {
                  if (type.command) {
                    insertLaTeXCommand(type.command, type.name);
                  }
                  setShowTextTypes(false);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t last:rounded-b"
              >
                {type.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Insert Options */}
      <div className="relative">
        <button
          onClick={() => setShowInsertMenu(!showInsertMenu)}
          className="px-3 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 flex items-center gap-1 text-gray-900"
        >
          Insert
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {showInsertMenu && (
          <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-10 min-w-[140px]">
            {insertOptions.map((option) => (
              <button
                key={option.name}
                onClick={option.action}
                className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 first:rounded-t last:rounded-b"
              >
                {option.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Undo/Redo */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              editorRef.current.trigger('keyboard', 'undo', null);
            }
          }}
          disabled={!canUndo}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900"
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>
        <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              editorRef.current.trigger('keyboard', 'redo', null);
            }
          }}
          disabled={!canRedo}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900"
          title="Redo (Ctrl+Y)"
        >
          ↷
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Search and Replace */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              editorRef.current.trigger('keyboard', 'actions.find', null);
            }
          }}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-900"
          title="Find (Ctrl+F)"
        >
          🔍
        </button>
        {/* <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              editorRef.current.trigger('keyboard', 'editor.action.startFindReplaceAction', null);
            }
          }}
          className="px-2 py-1 text-sm bg-white border rounded hover:bg-gray-100"
          title="Find & Replace (Ctrl+H)"
        >
          🔄
        </button> */}
      </div>

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Research Integration */}
      {onShowResearchIntegration && (
        <div className="flex items-center gap-1">
          <button
            onClick={onShowResearchIntegration}
            className="px-3 py-1 text-sm bg-blue-600 text-white border rounded hover:bg-blue-700 flex items-center gap-1"
            title="Research Integration"
          >
            🧠 Integrations
          </button>
        </div>
      )}

      <div className="w-px h-6 bg-gray-300"></div>

      {/* Editor Settings */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              const editor = editorRef.current;
              const currentFontSize = editor.getOption(window.monaco.editor.EditorOption.fontSize);
              editor.updateOptions({ fontSize: Math.max(8, currentFontSize - 1) });
            }
          }}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-900"
          title="Decrease Font Size"
        >
          A-
        </button>
        <button
          onClick={() => {
            if (editorRef.current && window.monaco) {
              const editor = editorRef.current;
              const currentFontSize = editor.getOption(window.monaco.editor.EditorOption.fontSize);
              editor.updateOptions({ fontSize: Math.min(24, currentFontSize + 1) });
            }
          }}
          className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-100 text-gray-900"
          title="Increase Font Size"
        >
          A+
        </button>
      </div>
    </div>
  );
}
