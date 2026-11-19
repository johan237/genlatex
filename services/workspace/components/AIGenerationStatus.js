'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

function normalizeGenerationErrorMessage(rawError) {
  const raw = String(rawError || '').trim();
  if (!raw) return 'AI document generation failed';

  const lower = raw.toLowerCase();
  if (
    lower.includes('insufficient credits') ||
    lower.includes('requires more credits') ||
    lower.includes('payment required') ||
    lower.includes('error code: 402') ||
    lower.includes('code: 402')
  ) {
    return 'Generation provider credits are insufficient. Add provider credits or reduce generation size, then retry.';
  }

  if (lower.includes('paper_credits_exceeded')) {
    return 'No generation credits left on your plan.';
  }

  const quotedMessageMatch = raw.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (quotedMessageMatch?.[1]) {
    return quotedMessageMatch[1].trim();
  }

  return raw;
}

function toReadablePhase(phase) {
  const normalized = String(phase || '').toLowerCase();
  const labels = {
    plan: 'Planning',
    research: 'Preparing Content',
    writing: 'Drafting',
    verification: 'Finalizing',
    complete: 'Complete'
  };
  return labels[normalized] || (phase ? `${phase.charAt(0).toUpperCase()}${phase.slice(1)}` : 'Processing');
}

export default function AIGenerationStatus({ projectId }) {
  const [aiStatus, setAiStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const aiStatusRef = useRef(null);
  const extractionStartedRef = useRef(false);

  const handleCompleteGeneration = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/projects/${projectId}/ai-status`, {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // Update status to show completion without reloading
          setAiStatus(prev => ({
            ...prev,
            status: 'completed',
            filesExtracted: data.filesExtracted
          }));
          aiStatusRef.current = {
            ...aiStatusRef.current,
            status: 'completed',
            filesExtracted: data.filesExtracted
          };
        } else {
          setError(data.error || 'Failed to complete AI document generation');
        }
      } else {
        setError('Failed to complete AI document generation');
      }
    } catch (err) {
      setError('Error completing AI document generation');
    } finally {
      setLoading(false);
    }
  };

  // Initial status check - ONLY check if there's actually an active generation
  useEffect(() => {
    if (!projectId) return;

    const checkAIStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/ai-status`);
        if (response.ok) {
          const data = await response.json();
          
          // Only proceed if there's actually an active generation
          if (!data.hasAIGeneration) {
            // No AI generation - don't show anything
            setAiStatus({ hasAIGeneration: false });
            aiStatusRef.current = { hasAIGeneration: false };
            setLoading(false);
            setError(null);
            return;
          }
          
          // Only show if generation is actively in progress
          if (data.status === 'in_progress' || data.status === 'processing') {
            setAiStatus(data);
            aiStatusRef.current = data;
            setError(null);
          } else {
            // Generation completed or not active - don't show banner
            setAiStatus({ hasAIGeneration: false });
            aiStatusRef.current = { hasAIGeneration: false };
          }
        } else if (response.status === 404) {
          // No AI generation found - don't show anything
          const noAIStatus = { hasAIGeneration: false };
          setAiStatus(noAIStatus);
          aiStatusRef.current = noAIStatus;
          setError(null);
        } else {
          // API error - log but don't show banner
          console.error(`❌ AI status API error: ${response.status}`);
          const noAIStatus = { hasAIGeneration: false };
          setAiStatus(noAIStatus);
          aiStatusRef.current = noAIStatus;
          setError(null);
        }
      } catch (err) {
        // Error - log but don't show banner
        console.error('Error checking AI status:', err);
        if (err.message && err.message.includes('JSON')) {
          console.error('JSON parse error - metadata file may be corrupted');
        }
        const noAIStatus = { hasAIGeneration: false };
        setAiStatus(noAIStatus);
        aiStatusRef.current = noAIStatus;
        setError(null);
      } finally {
        setLoading(false);
      }
    };

    checkAIStatus();
  }, [projectId]);

  // Polling effect - only poll if in progress, stop when completed
  useEffect(() => {
    if (!projectId) return;
    
    // Don't poll if status is completed or if no AI generation
    if (!aiStatusRef.current?.hasAIGeneration || 
        aiStatusRef.current?.status === 'completed' || 
        aiStatusRef.current?.filesExtracted) {
      return;
    }

    const pollInterval = setInterval(async () => {
      const currentStatus = aiStatusRef.current;
      
      // Stop polling if completed
      if (currentStatus?.status === 'completed' || currentStatus?.filesExtracted) {
        clearInterval(pollInterval);
        return;
      }
      
      if (currentStatus?.hasAIGeneration && (currentStatus?.status === 'in_progress' || currentStatus?.status === 'processing')) {
        try {
          const response = await fetch(`/api/projects/${projectId}/ai-status`);
          if (response.ok) {
            const data = await response.json();
            setAiStatus(data);
            aiStatusRef.current = data;
            
            // Stop polling if completed
            if (data.status === 'completed' || data.filesExtracted) {
              clearInterval(pollInterval);
            }
          } else if (response.status === 404) {
            // No generation found - stop polling
            clearInterval(pollInterval);
          } else {
            // Other error - log but continue polling
            console.error(`Polling error: ${response.status}`);
          }
        } catch (err) {
          console.error('Polling error:', err);
          // On JSON parse error, log but continue polling
          if (err.message && err.message.includes('JSON')) {
            console.error('JSON parse error during polling - might be temporary');
          }
        }
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [projectId, aiStatus?.status, aiStatus?.filesExtracted]);

  // Handle automatic file extraction when paper is completed
  useEffect(() => {
    if (aiStatus?.status === 'completed' && !aiStatus.filesExtracted && !extractionStartedRef.current) {
      extractionStartedRef.current = true;
      handleCompleteGeneration();
    }
  }, [aiStatus?.status, aiStatus?.filesExtracted]);

  if (loading) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
          <span className="text-blue-800">Checking AI generation status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-3">
        <div className="flex items-center justify-center">
          <svg className="h-5 w-5 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-red-800">{error}</span>
        </div>
      </div>
    );
  }

  if (!aiStatus?.hasAIGeneration) {
    return null; // Don't show anything if no AI generation
  }

  if (String(aiStatus.status || '').toLowerCase() === 'completed') {
    // Generation complete - don't show anything, files are already there
    return null;
  }

  if (['in_progress', 'processing'].includes(String(aiStatus.status || '').toLowerCase())) {
    return (
      <div className="bg-blue-50 border-b border-blue-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
            <div>
              <span className="text-blue-800 font-medium">AI is generating your document...</span>
              {aiStatus.phase && (
                <div className="text-blue-600 text-sm mt-1">
                  Current phase: {toReadablePhase(aiStatus.phase)}
                </div>
              )}
            </div>
          </div>
          {aiStatus.progress && (
            <div className="flex items-center gap-3">
              <span className="text-blue-600 text-sm">{aiStatus.progress}%</span>
              <div className="w-32 bg-blue-200 rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${aiStatus.progress}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (['failed', 'error'].includes(String(aiStatus.status || '').toLowerCase())) {
    const failureMessage = normalizeGenerationErrorMessage(aiStatus.error_message || aiStatus.message || 'AI document generation failed');
    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-3">
        <div className="flex items-center justify-center">
          <svg className="h-5 w-5 text-red-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-red-800">{failureMessage}</span>
        </div>
      </div>
    );
  }

  return null;
}
