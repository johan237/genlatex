// SPDX-License-Identifier: MIT

'use client';

import React from 'react';

export default function DocumentStats({ content, fileName }) {
  // Calculate stats synchronously to avoid hydration errors
  const getStats = () => {
    if (!content) {
      return {
        characters: 0,
        charactersNoSpaces: 0,
        words: 0,
        lines: 0,
        paragraphs: 0
      };
    }

    const characters = content.length;
    const charactersNoSpaces = content.replace(/\s/g, '').length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const lines = content.split('\n').length;
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim()).length;

    return {
      characters,
      charactersNoSpaces,
      words,
      lines,
      paragraphs
    };
  };

  const stats = getStats();

  return (
    <div className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 px-2 py-1 border-t">
      <div className="flex items-center gap-2">
        <span className="font-medium">{fileName}</span>
        <span>•</span>
        <span>{stats.words} words</span>
        <span>•</span>
        <span>{stats.characters} chars</span>
        <span>•</span>
        <span>{stats.lines} lines</span>
        {stats.paragraphs > 1 && (
          <>
            <span>•</span>
            <span>{stats.paragraphs} paragraphs</span>
          </>
        )}
      </div>
    </div>
  );
}
