/**
 * AI Integration Test Page
 * Test DeepSeek-R1 integration functionality
 */

'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';

export default function TestAIPage() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [aiStatus, setAiStatus] = useState('checking');
  const [rateLimitStats, setRateLimitStats] = useState(null);

  const resetRateLimit = async () => {
    try {
      const response = await fetch('/api/rate-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' })
      });
      
      if (response.ok) {
        // Reload stats after reset
        const statsResponse = await fetch('/api/rate-limit');
        if (statsResponse.ok) {
          const data = await statsResponse.json();
          setRateLimitStats(data.stats);
        }
        alert('Rate limit stats reset successfully!');
      } else {
        const error = await response.json();
        alert(`Reset failed: ${error.error}`);
      }
    } catch (error) {
      alert(`Reset failed: ${error.message}`);
    }
  };

  // Check AI status on component mount
  useEffect(() => {
    const checkAIStatus = async () => {
      try {
        const response = await fetch('/api/config');
        if (response.ok) {
          const config = await response.json();
          setAiStatus(config.features?.aiEnabled ? 'enabled' : 'disabled');
        } else {
          setAiStatus('error');
        }
      } catch (error) {
        setAiStatus('error');
      }
    };

    // Only run in browser
    if (typeof window !== 'undefined') {
      checkAIStatus();
      
      // Load rate limit stats
      const loadRateLimitStats = async () => {
        try {
          const response = await fetch('/api/rate-limit');
          if (response.ok) {
            const data = await response.json();
            setRateLimitStats(data.stats);
          }
        } catch (error) {
          console.warn('Failed to load rate limit stats:', error);
        }
      };
      
      loadRateLimitStats();
    }
  }, []);

  const testAI = async (action) => {
    if (!input.trim()) {
      setError('Please enter some text to test');
      return;
    }

    setLoading(true);
    setError('');

    try {
      let result;
      
      switch (action) {
        case 'analyze':
          result = await window.genlatexAI.analyzeText(input);
          break;
        case 'improve':
          result = await window.genlatexAI.improveWriting(input);
          break;
        case 'summarize':
          result = await window.genlatexAI.summarizeContent(input);
          break;
        case 'latex':
          result = await window.genlatexAI.generateLaTeXContent(input);
          break;
        default:
          throw new Error('Invalid action');
      }

      if (result.success) {
        setOutput(JSON.stringify(result, null, 2));
      } else {
        // Handle different error types
        if (result.type === 'rate_limit') {
          setError(`🚫 ${result.error}\n\nOpenRouter free tier limits:\n• 100 requests per day\n• 100,000 tokens per day\n\nPlease wait before trying again.`);
        } else if (result.type === 'auth_error') {
          setError(`🔑 ${result.error}\n\nPlease check your .env file and ensure OPENROUTER_API_KEY is set correctly.`);
        } else {
          setError(result.error || 'AI request failed');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <Script src="/js/aimodel-integration.js" strategy="afterInteractive" />
      
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">AI Model Research Assistant Test</h1>
        
        {/* AI Status Indicator */}
        <div className="mb-6">
          <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            aiStatus === 'enabled' ? 'bg-green-100 text-green-800' :
            aiStatus === 'disabled' ? 'bg-yellow-100 text-yellow-800' :
            aiStatus === 'error' ? 'bg-red-100 text-red-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            <div className={`w-2 h-2 rounded-full mr-2 ${
              aiStatus === 'enabled' ? 'bg-green-500' :
              aiStatus === 'disabled' ? 'bg-yellow-500' :
              aiStatus === 'error' ? 'bg-red-500' :
              'bg-gray-500'
            }`}></div>
            AI Status: {
              aiStatus === 'enabled' ? 'Enabled' :
              aiStatus === 'disabled' ? 'Disabled (API key needed)' :
              aiStatus === 'error' ? 'Error' :
              'Checking...'
            }
            {rateLimitStats?.testMode && ' (Test Mode)'}
          </div>
        </div>

        {/* Rate Limit Status */}
        {rateLimitStats && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Rate Limit Status</h2>
              {rateLimitStats.testMode && (
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded-full">Test Mode</span>
                  <button
                    onClick={resetRateLimit}
                    className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                  >
                    Reset Stats
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{rateLimitStats.requestsToday}</div>
                <div className="text-sm text-gray-600">Requests Today</div>
                <div className="text-xs text-gray-500">{rateLimitStats.requestsRemaining} remaining</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{rateLimitStats.tokensToday.toLocaleString()}</div>
                <div className="text-sm text-gray-600">Tokens Today</div>
                <div className="text-xs text-gray-500">{rateLimitStats.tokensRemaining.toLocaleString()} remaining</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{rateLimitStats.timeUntilReset}</div>
                <div className="text-sm text-gray-600">Until Reset</div>
                <div className="text-xs text-gray-500">Daily limit</div>
              </div>
              <div className="text-center">
                <div className={`text-2xl font-bold ${rateLimitStats.canMakeRequest ? 'text-green-600' : 'text-red-600'}`}>
                  {rateLimitStats.canMakeRequest ? '✓' : '✗'}
                </div>
                <div className="text-sm text-gray-600">Can Request</div>
                <div className="text-xs text-gray-500">Status</div>
              </div>
            </div>
          </div>
        )}
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Test Input</h2>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Enter text to test AI features..."
            className="w-full h-32 p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">AI Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => testAI('analyze')}
              disabled={loading || aiStatus !== 'enabled'}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              Analyze Text
            </button>
            <button
              onClick={() => testAI('improve')}
              disabled={loading || aiStatus !== 'enabled'}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              Improve Writing
            </button>
            <button
              onClick={() => testAI('summarize')}
              disabled={loading || aiStatus !== 'enabled'}
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
            >
              Summarize
            </button>
            <button
              onClick={() => testAI('latex')}
              disabled={loading || aiStatus !== 'enabled'}
              className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
            >
              Generate LaTeX
            </button>
          </div>
        </div>

        {loading && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
              <span className="text-blue-800">AI is processing your request...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
            <div className="text-red-800">
              <strong>Error:</strong> {error}
            </div>
          </div>
        )}

        {output && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">AI Response</h2>
            <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm">
              {output}
            </pre>
          </div>
        )}

        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mt-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">Setup Instructions</h3>
          <ol className="list-decimal list-inside text-yellow-700 space-y-1">
            <li>Get your OpenRouter API key from <a href="https://openrouter.ai/" className="underline" target="_blank" rel="noopener noreferrer">OpenRouter</a></li>
            <li>Create a <code className="bg-yellow-100 px-1 rounded">.env.local</code> file with <code className="bg-yellow-100 px-1 rounded">OPENROUTER_API_KEY=your-key-here</code></li>
            <li>Restart your development server</li>
            <li>Test the AI features above</li>
          </ol>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mt-4">
          <h3 className="text-lg font-semibold text-blue-800 mb-2">Rate Limits (Free Tier)</h3>
          <ul className="list-disc list-inside text-blue-700 space-y-1">
            <li><strong>100 requests per day</strong> - Reset every 24 hours</li>
            <li><strong>100,000 tokens per day</strong> - Includes both input and output tokens</li>
            <li><strong>Automatic retry</strong> - Built-in exponential backoff for rate limits</li>
            <li><strong>Upgrade available</strong> - <a href="https://openrouter.ai/pricing" className="underline" target="_blank" rel="noopener noreferrer">View pricing</a> for higher limits</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
