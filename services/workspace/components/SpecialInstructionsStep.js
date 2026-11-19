/**
 * Special Instructions Step
 * Feature 1: Allow users to enter custom formatting instructions
 */

import React, { useState } from 'react';

const MAX_TEXT_LENGTH = 5000;

export default function SpecialInstructionsStep({ value, onChange }) {
  const [text, setText] = useState(value?.text || '');
  const [error, setError] = useState(null);

  const handleTextChange = (e) => {
    const newText = e.target.value;
    if (newText.length <= MAX_TEXT_LENGTH) {
      setText(newText);
      onChange({ text: newText });
      setError(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-2">
          Special Instructions (Optional)
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Provide any special formatting, style, or layout requirements for your document.
          These instructions will be followed throughout the generation process.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Text Area */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Enter instructions
        </label>
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder="Enter any special formatting requirements, style preferences, page layout specifications, or custom instructions..."
          className="w-full h-48 p-3 border rounded-md resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="flex justify-between text-sm text-gray-500 mt-1">
          <span>{text.length} / {MAX_TEXT_LENGTH} characters</span>
          {text.length > 4500 && (
            <span className="text-orange-600 font-medium">
              Approaching character limit
            </span>
          )}
        </div>
      </div>

      {/* Examples */}
      <div className="bg-gray-50 p-4 rounded-md border border-gray-200">
        <p className="text-sm font-medium mb-2 text-gray-700">Example Instructions:</p>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>• Use IEEE double-column format with 10pt font</li>
          <li>• Include page numbers in footer, starting from page 1</li>
          <li>• Add university logo to title page header</li>
          <li>• Use APA citation style with DOI links for all references</li>
          <li>• Apply 1-inch margins on all sides</li>
          <li>• Use Times New Roman font throughout</li>
        </ul>
      </div>

      {/* Info Box */}
      {text && (
        <div className="bg-blue-50 border border-blue-200 p-3 rounded text-sm text-blue-800">
          <p className="font-medium">ℹ️ These instructions will be:</p>
          <ul className="mt-2 space-y-1 ml-4 list-disc">
            <li>Included in all AI agent prompts during generation</li>
            <li>Added as LaTeX comments in the document preamble</li>
            <li>Saved to project metadata for future reference</li>
            <li>Available to the AI chat for making edits later</li>
          </ul>
        </div>
      )}
    </div>
  );
}
