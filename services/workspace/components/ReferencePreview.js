'use client';

import { useState } from 'react';

export default function ReferencePreview({ articles, onConfirm, onCancel, isGenerating }) {
  const [selectedArticles, setSelectedArticles] = useState(
    articles.reduce((acc, article) => {
      acc[article.article_id] = true; // All selected by default
      return acc;
    }, {})
  );

  const handleToggle = (articleId) => {
    setSelectedArticles(prev => ({
      ...prev,
      [articleId]: !prev[articleId]
    }));
  };

  const handleSelectAll = () => {
    const allSelected = {};
    articles.forEach(article => {
      allSelected[article.article_id] = true;
    });
    setSelectedArticles(allSelected);
  };

  const handleDeselectAll = () => {
    const noneSelected = {};
    articles.forEach(article => {
      noneSelected[article.article_id] = false;
    });
    setSelectedArticles(noneSelected);
  };

  const selectedCount = Object.values(selectedArticles).filter(Boolean).length;

  const handleConfirm = () => {
    const selected = articles.filter(article => selectedArticles[article.article_id]);
    onConfirm(selected);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">
          Found {articles.length} Relevant References
        </h2>
        <p className="text-gray-600">
          Review the research articles below. Each article includes a summary explaining how it relates to your work.
          Select the references you want to include in your literature review.
        </p>
      </div>

      {/* Selection Controls */}
      <div className="flex justify-between items-center mb-4 pb-4 border-b">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-800">{selectedCount}</span> of {articles.length} selected
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSelectAll}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            disabled={isGenerating}
          >
            Select All
          </button>
          <button
            onClick={handleDeselectAll}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            disabled={isGenerating}
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* Articles List */}
      <div className="space-y-4 mb-6 max-h-[60vh] overflow-y-auto">
        {articles.map((article) => (
          <div
            key={article.article_id}
            className={`border rounded-lg p-4 transition-all ${
              selectedArticles[article.article_id]
                ? 'border-blue-300 bg-blue-50'
                : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-start space-x-3">
              <input
                type="checkbox"
                checked={selectedArticles[article.article_id]}
                onChange={() => handleToggle(article.article_id)}
                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={isGenerating}
              />
              <div className="flex-1">
                {/* Article Title */}
                <h3 className="font-semibold text-gray-900 mb-1">
                  {article.url ? (
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-blue-600 transition-colors"
                    >
                      {article.title}
                      <svg
                        className="inline-block w-4 h-4 ml-1"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  ) : (
                    article.title
                  )}
                </h3>

                {/* Authors and Year */}
                <div className="text-sm text-gray-600 mb-2">
                  {article.authors.length > 0 && (
                    <span>
                      {article.authors.slice(0, 3).join(', ')}
                      {article.authors.length > 3 && ' et al.'}
                    </span>
                  )}
                  {article.year && <span> ({article.year})</span>}
                  {article.venue && <span className="ml-2 italic">{article.venue}</span>}
                </div>

                {/* Relevance Summary - Highlighted */}
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-2">
                  <div className="text-xs font-semibold text-yellow-800 uppercase mb-1">
                    Relevance to Your Work
                  </div>
                  <div className="text-sm text-gray-700">
                    {article.relevance_summary}
                  </div>
                </div>

                {/* Abstract Preview */}
                <details className="text-sm text-gray-600">
                  <summary className="cursor-pointer hover:text-gray-800 font-medium">
                    Show abstract
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed">
                    {article.abstract}
                  </p>
                </details>

                {/* Metadata */}
                <div className="flex gap-2 mt-2">
                  <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                    {article.source_type}
                  </span>
                  {article.doi && (
                    <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                      DOI: {article.doi}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 pt-4 border-t">
        <button
          onClick={handleConfirm}
          disabled={selectedCount === 0 || isGenerating}
          className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-3 rounded-md font-medium transition-colors flex items-center justify-center"
        >
          {isGenerating ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating Paper...
            </>
          ) : (
            `Generate Paper with ${selectedCount} Selected Reference${selectedCount !== 1 ? 's' : ''}`
          )}
        </button>

        <button
          onClick={onCancel}
          disabled={isGenerating}
          className="px-6 py-3 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Back to Form
        </button>
      </div>

      {/* Warning if too few selected */}
      {selectedCount < 5 && selectedCount > 0 && (
        <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
          <p className="text-sm text-orange-800">
            ⚠️ You have selected only {selectedCount} reference{selectedCount !== 1 ? 's' : ''}.
            For a comprehensive literature review, we recommend selecting at least 10 references.
          </p>
        </div>
      )}
    </div>
  );
}
