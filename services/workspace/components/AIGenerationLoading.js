/**
 * Loading page component for AI document generation
 * Shows real-time status, progress, and phase information
 */

'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

function normalizeGenerationErrorMessage(rawError) {
  const raw = String(rawError || '').trim();
  if (!raw) return 'Document generation failed. Please try again.';

  const lower = raw.toLowerCase();
  if (
    lower.includes('insufficient credits') ||
    lower.includes('requires more credits') ||
    lower.includes('payment required') ||
    lower.includes('error code: 402') ||
    lower.includes('code: 402')
  ) {
    return 'Generation provider credits are insufficient. Add credits in your provider account or reduce generation size, then retry.';
  }

  if (lower.includes('paper_credits_exceeded')) {
    return 'You have no generation credits left on your current plan. Upgrade your plan or wait for credit reset.';
  }

  const quotedMessageMatch = raw.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (quotedMessageMatch?.[1]) {
    return quotedMessageMatch[1].trim();
  }

  return raw;
}

function normalizeProgressMessage(phase, rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) return '';

  const normalizedPhase = String(phase || '').toLowerCase();
  if (normalizedPhase === 'research') {
    return 'Preparing context from your prompt and uploaded files.';
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('finding and analyzing sources') ||
    lower.includes('comprehensive initial search') ||
    lower.includes('research phase') ||
    lower.includes('pre-selected references')
  ) {
    return 'Preparing context from your prompt and uploaded files.';
  }

  return message;
}

function getPhaseDisplay(phase) {
  const phases = {
    plan: { name: 'Planning', description: 'Preparing document structure and layout...', icon: 'PLAN' },
    research: { name: 'Preparing Content', description: 'Collecting and organizing provided context...', icon: 'DATA' },
    writing: { name: 'Drafting', description: 'Generating document content...', icon: 'WRITE' },
    verification: { name: 'Finalizing', description: 'Applying formatting and consistency checks...', icon: 'CHECK' },
    complete: { name: 'Complete', description: 'Document generation finished!', icon: 'DONE' }
  };
  return phases[phase] || { name: phase || 'Processing', description: 'Working on your document...', icon: 'RUN' };
}

export default function AIGenerationLoading({ projectId, onComplete }) {
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollingIntervalRef = useRef(null);
  const extractionStartedRef = useRef(false);
  const hadErrorRef = useRef(false);
  const consecutive404Ref = useRef(0);
  const consecutiveNotReadyRef = useRef(0);
  const expectedPaperIdRef = useRef(null);
  const NOT_READY_WARNING_THRESHOLD = 20;

  useEffect(() => {
    if (!projectId) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/ai-status?expectingAi=true`);
        if (response.ok) {
          const data = await response.json();

          if (!data.hasAIGeneration || String(data.status || '').toLowerCase() === 'not_ready') {
            consecutiveNotReadyRef.current += 1;
            consecutive404Ref.current = 0;
            const isSlowStartup = consecutiveNotReadyRef.current >= NOT_READY_WARNING_THRESHOLD;
            setLoading(false);
            setError(null);
            setStatus({
              status: 'not_ready',
              phase: data.phase || 'plan',
              progress: 0,
              message: isSlowStartup
                ? 'Generation is still initializing. Please keep this page open while setup completes.'
                : (data.message || 'Preparing generation status...')
            });
            return;
          }

          consecutive404Ref.current = 0;
          consecutiveNotReadyRef.current = 0;
          const statusValue = String(data.status || '').toLowerCase();

          if (data.paperId && !expectedPaperIdRef.current) {
            expectedPaperIdRef.current = data.paperId;
          }

          const paperIdMismatch = Boolean(
            expectedPaperIdRef.current &&
            data.paperId &&
            expectedPaperIdRef.current !== data.paperId
          );
          if (paperIdMismatch) {
            expectedPaperIdRef.current = data.paperId;
            extractionStartedRef.current = false;
          }

          const matchesExpectedPaper = Boolean(
            !expectedPaperIdRef.current ||
            !data.paperId ||
            expectedPaperIdRef.current === data.paperId
          );
          const cyclePaperId = data?.cycle?.paperId || data.paperId || null;
          const matchesCyclePaper = Boolean(
            !expectedPaperIdRef.current ||
            !cyclePaperId ||
            expectedPaperIdRef.current === cyclePaperId
          );

          const normalizedData = statusValue ? { ...data, status: statusValue } : data;
          setStatus(normalizedData);
          setLoading(false);
          setError(null);

          const progressAt100 = data.progress >= 99 || data.progress === 100;
          const phaseComplete = data.phase === 'complete';
          const statusComplete = statusValue === 'completed';
          const isActuallyCompleted = !['failed', 'error'].includes(statusValue) &&
            (data.isActuallyCompleted === true || statusComplete || (progressAt100 && phaseComplete));

          const recoveredFromError = hadErrorRef.current && isActuallyCompleted;
          if (recoveredFromError) {
            setError(null);
            hadErrorRef.current = false;
          }

          if (isActuallyCompleted && data.filesExtracted && matchesExpectedPaper && matchesCyclePaper) {
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            if (onComplete) {
              onComplete({ ...data, paperId: cyclePaperId || data.paperId }, { recovered: recoveredFromError });
            }
            return;
          }

          if (isActuallyCompleted && !data.filesExtracted && !extractionStartedRef.current && matchesExpectedPaper && matchesCyclePaper) {
            extractionStartedRef.current = true;
            await extractFiles(recoveredFromError);
            return;
          }

          if (statusValue === 'failed' || statusValue === 'error') {
            const retriable = Boolean(data.retriable);
            if (retriable) {
              setStatus((prev) => ({
                ...(prev || {}),
                ...normalizedData,
                status: 'in_progress',
                message: data.message || 'Temporary backend issue. Retrying...'
              }));
              return;
            }
            if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
            setError(data.error_message || data.message || 'Document generation failed. Please try again.');
          }
        } else if (response.status === 404) {
          consecutive404Ref.current += 1;
          const isSlow404Startup = consecutive404Ref.current >= NOT_READY_WARNING_THRESHOLD;
          setLoading(false);
          setError(null);
          setStatus({
            status: 'not_ready',
            phase: 'plan',
            progress: 0,
            message: isSlow404Startup
              ? 'Generation status is still warming up. Please keep this page open.'
              : 'Waiting for generation status to become available...'
          });
        } else {
          setError(`Failed to check status: ${response.status}`);
          hadErrorRef.current = true;
        }
      } catch (err) {
        hadErrorRef.current = true;
        if (err?.message && err.message.includes('JSON')) {
          setError('Invalid response from server. Please refresh the page.');
        } else {
          setError(`Error checking status: ${err.message}`);
        }
      }
    };

    pollStatus();
    pollingIntervalRef.current = setInterval(pollStatus, 2000);
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    };
  }, [projectId, onComplete]);

  const extractFiles = async (recovered = false) => {
    try {
      setStatus((prev) => ({ ...prev, extracting: true }));
      const response = await fetch(`/api/projects/${projectId}/ai-status`, { method: 'POST' });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to extract files: ${errorText}`);
      }

      const data = await response.json();
      const extractionPaperId = data?.paperId || data?.extractedForPaperId || null;
      const extractionMatchesExpectedPaper = Boolean(
        !expectedPaperIdRef.current ||
        !extractionPaperId ||
        expectedPaperIdRef.current === extractionPaperId
      );

      if (!data.success) {
        throw new Error(data.error || 'File extraction failed');
      }

      if (!extractionMatchesExpectedPaper) {
        extractionStartedRef.current = false;
        return;
      }

      setStatus((prev) => ({
        ...prev,
        filesExtracted: data.filesExtracted,
        extracting: false,
        status: 'completed',
        paperId: extractionPaperId || prev?.paperId
      }));
      setError(null);
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);

      if (onComplete) {
        onComplete({
          ...status,
          filesExtracted: data.filesExtracted,
          status: 'completed',
          paperId: extractionPaperId || expectedPaperIdRef.current || status?.paperId
        }, { recovered });
      }
    } catch (err) {
      setStatus((prev) => ({ ...prev, extracting: false }));
      const isNotCompletedYet = err.message?.includes('not completed') || err.message?.includes('not yet completed');
      if (isNotCompletedYet) {
        extractionStartedRef.current = false;
      } else {
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        setError(`Generation completed but file extraction failed: ${err.message}`);
      }
    }
  };

  if (loading && !status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">Starting AI Generation...</h2>
          <p className="text-gray-600">Preparing to generate your document</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-red-50 to-pink-100">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="text-6xl mb-4">X</div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">Generation Failed</h2>
          <p className="text-gray-600 mb-6">{normalizeGenerationErrorMessage(error)}</p>
          <button
            onClick={() => router.push(`/editor/${projectId}`)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Go to Project
          </button>
        </div>
      </div>
    );
  }

  const phaseInfo = getPhaseDisplay(status?.phase);
  const progress = status?.progress || 0;
  const progressMessage = normalizeProgressMessage(status?.phase, status?.message);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-2xl w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="text-3xl font-semibold tracking-wide text-blue-700 mb-4">{phaseInfo.icon}</div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Generating Your Document</h1>
            <p className="text-gray-600">AI is working on creating your document</p>
          </div>

          <div className="mb-8">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{phaseInfo.name}</span>
              <span className="text-sm font-medium text-gray-700">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-6 mb-6">
            <p className="text-gray-700 text-center">{phaseInfo.description}</p>
            {progressMessage && (
              <p className="text-sm text-gray-600 text-center mt-2 italic">{progressMessage}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-200">
              <span className="text-sm text-gray-600">Status</span>
              <span className={`text-sm font-medium ${
                status?.status === 'completed' ? 'text-green-600' :
                status?.status === 'failed' ? 'text-red-600' :
                status?.status === 'not_ready' ? 'text-amber-600' :
                'text-blue-600'
              }`}>
                {status?.status === 'completed' ? 'Completed' :
                 status?.status === 'failed' ? 'Failed' :
                 status?.status === 'not_ready' ? 'Preparing' :
                 status?.status === 'in_progress' ? 'In Progress' :
                 'Processing'}
              </span>
            </div>

            {status?.phase && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-sm text-gray-600">Current Phase</span>
                <span className="text-sm font-medium text-gray-800">{phaseInfo.name}</span>
              </div>
            )}

            {status?.extracting && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-sm text-gray-600">Extracting Files</span>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
              </div>
            )}

            {status?.filesExtracted && (
              <div className="flex justify-between items-center py-2 border-b border-gray-200">
                <span className="text-sm text-gray-600">Files Extracted</span>
                <span className="text-sm font-medium text-green-600">{status.filesExtracted} files</span>
              </div>
            )}
          </div>

          {status?.status === 'completed' && status?.filesExtracted && (
            <div className="mt-8 text-center">
              <button
                onClick={() => router.push(`/editor/${projectId}`)}
                className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 shadow-lg hover:shadow-xl font-semibold"
              >
                Open in Editor
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            This may take a few minutes depending on document length and complexity
          </p>
        </div>
      </div>
    </div>
  );
}
