'use client';

import { useState } from 'react';

export default function LaTeXGenerator() {
  const [requirements, setRequirements] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateLaTeX = async () => {
    if (!requirements.trim()) {
      setError('Please enter requirements for LaTeX generation');
      return;
    }

    setLoading(true);
    setError('');
    setGeneratedContent('');

    try {
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'generate_latex_content',
          data: {
            requirements: requirements,
            context: {}
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        setGeneratedContent(result.content);
      } else {
        setError(result.error || 'Failed to generate LaTeX content');
      }
    } catch (err) {
      setError('Network error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedContent);
    alert('LaTeX content copied to clipboard!');
  };

  const clearAll = () => {
    setRequirements('');
    setGeneratedContent('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">LaTeX Content Generator</h1>
          <p className="text-gray-600 mb-6">
            Generate LaTeX content using AI. Enter your requirements and get structured, compilable document content.
          </p>

          {/* Input Section */}
          <div className="mb-6">
            <label htmlFor="requirements" className="block text-sm font-medium text-gray-700 mb-2">
              Requirements for LaTeX Generation
            </label>
            <textarea
              id="requirements"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="e.g., Create a technical report outline with executive summary, findings, and recommendations..."
              className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={generateLaTeX}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2 rounded-md font-medium transition-colors"
            >
              {loading ? 'Generating...' : 'Generate LaTeX'}
            </button>
            <button
              onClick={clearAll}
              className="bg-gray-500 hover:bg-gray-600 text-white px-6 py-2 rounded-md font-medium transition-colors"
            >
              Clear All
            </button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <div className="mt-2 text-sm text-red-700">{error}</div>
                </div>
              </div>
            </div>
          )}

          {/* Generated Content Display */}
          {generatedContent && (
            <div className="bg-green-50 border border-green-200 rounded-md p-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-green-800">Generated LaTeX Content</h3>
                <button
                  onClick={copyToClipboard}
                  className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
                >
                  Copy to Clipboard
                </button>
              </div>
              
              {/* LaTeX Code Display */}
              <div className="bg-gray-900 rounded-md p-4 overflow-x-auto">
                <pre className="text-green-400 text-sm whitespace-pre-wrap font-mono">
                  {generatedContent}
                </pre>
              </div>

              {/* Preview Section */}
              <div className="mt-4">
                <h4 className="text-md font-medium text-green-800 mb-2">Preview</h4>
                <div className="bg-white border border-gray-200 rounded-md p-4 min-h-32">
                  <div className="prose max-w-none">
                    <div className="text-gray-700 whitespace-pre-wrap">
                      {generatedContent.replace(/\\[a-zA-Z]+\{[^}]*\}/g, (match) => {
                        // Simple LaTeX to readable text conversion for preview
                        if (match.includes('\\section')) return '\n\n## ' + match.match(/\{([^}]+)\}/)?.[1] + '\n';
                        if (match.includes('\\subsection')) return '\n\n### ' + match.match(/\{([^}]+)\}/)?.[1] + '\n';
                        if (match.includes('\\textbf')) return '**' + match.match(/\{([^}]+)\}/)?.[1] + '**';
                        if (match.includes('\\item')) return '• ';
                        return '';
                      }).replace(/\\begin\{[^}]+\}/g, '').replace(/\\end\{[^}]+\}/g, '')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Status Indicator */}
          <div className="mt-6 flex items-center justify-center">
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Mock Mode Active - AI responses are simulated for testing</span>
            </div>
          </div>
        </div>

        {/* Example Requirements */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Example Requirements</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-blue-50 p-4 rounded-md">
              <h3 className="font-medium text-blue-800 mb-2">Technical Report</h3>
              <p className="text-blue-700 text-sm">
                "Generate a technical report with summary, method, findings, and recommendations"
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-md">
              <h3 className="font-medium text-green-800 mb-2">Business Report</h3>
              <p className="text-green-700 text-sm">
                "Create a business report for Q4 performance with KPI tables and action plan"
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-md">
              <h3 className="font-medium text-purple-800 mb-2">Technical Document</h3>
              <p className="text-purple-700 text-sm">
                "Write an API specification document with endpoints, request/response tables, and error codes"
              </p>
            </div>
            <div className="bg-orange-50 p-4 rounded-md">
              <h3 className="font-medium text-orange-800 mb-2">Presentation</h3>
              <p className="text-orange-700 text-sm">
                "Create a beamer presentation with 10 slides about climate adaptation strategy"
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
