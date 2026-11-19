/**
 * React hook for AI document generation lifecycle with SSE + polling fallback.
 * State uses paperId/paperData for compatibility with existing components; value is the document generation id.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  startPaperGeneration,
  startPaperGenerationWithProject,
  completePaperGenerationWithProject,
  getPaperStatus,
  isPaperInProgress,
  isPaperCompleted,
  isPaperFailed
} from '../paper-generation-api.js';

export function usePaperGeneration() {
  const [paperId, setPaperId] = useState(null);
  const [status, setStatus] = useState('pending');
  const [phase, setPhase] = useState(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(null);
  const [paperData, setPaperData] = useState(null);
  const [error, setError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [createdProject, setCreatedProject] = useState(null);
  const [createProject, setCreateProject] = useState(false);
  const [recoveredFromError, setRecoveredFromError] = useState(false);

  const eventSourceRef = useRef(null);
  const pollingIntervalRef = useRef(null);
  const isPollingRef = useRef(false);
  const createProjectRef = useRef(false);
  const useSSE = useRef(true);
  const hadErrorRef = useRef(false);

  const handleProjectCreation = useCallback(async (id) => {
    console.log('Generation completed, creating project...');
    try {
      const projectResult = await completePaperGenerationWithProject(id);
      if (projectResult.success) {
        console.log('Project created successfully:', projectResult.project.id);
        setCreatedProject(projectResult.project);
      } else {
        console.error('Project creation failed:', projectResult.error);
        setError(projectResult.error || 'Failed to create project');
      }
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    isPollingRef.current = false;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const startPolling = useCallback((id) => {
    if (isPollingRef.current) return;

    console.log('Starting polling fallback...');
    isPollingRef.current = true;

    const poll = async () => {
      try {
        const data = await getPaperStatus(id);

        setStatus(data.status);
        setPhase(data.phase);
        setProgress(data.progress || 0);
        setMessage(data.message);

        if (data.paper_data) {
          setPaperData(data.paper_data);
        }

        if (isPaperCompleted(data.status) || isPaperFailed(data.status)) {
          stopPolling();

          if (isPaperFailed(data.status)) {
            setError(data.error_message || data.error || null);
          }

          const recovered = hadErrorRef.current && isPaperCompleted(data.status);
          if (recovered) {
            hadErrorRef.current = false;
            setError(null);
            setRecoveredFromError(true);
          }

          if (isPaperCompleted(data.status) && createProjectRef.current) {
            await handleProjectCreation(id);
          } else {
            setIsGenerating(false);
          }
        }
      } catch (err) {
        console.error('Polling error:', err);
        setError(err.message);
        hadErrorRef.current = true;
      }
    };

    poll();
    pollingIntervalRef.current = setInterval(poll, 2000);
  }, [handleProjectCreation, stopPolling]);

  const connectSSE = useCallback((id) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const directAgentUrl = process.env.NEXT_PUBLIC_GENLATEX_AGENT_URL
        ? process.env.NEXT_PUBLIC_GENLATEX_AGENT_URL.replace(/\/$/, '')
        : null;
      const sseUrl = directAgentUrl
        ? `${directAgentUrl}/documents/${id}/progress-stream`
        : `/api/agent/documents/${id}/progress-stream`;

      console.log('Connecting to SSE:', sseUrl);

      const eventSource = new EventSource(sseUrl);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener('progress', (event) => {
        try {
          const data = JSON.parse(event.data);
          setStatus(data.status);
          setPhase(data.phase);
          setProgress(data.progress || 0);
          setMessage(data.message);
          if (data.error) {
            setError(data.error);
          }
        } catch (err) {
          console.error('Error parsing SSE progress:', err);
        }
      });

      eventSource.addEventListener('complete', (event) => {
        try {
          const data = JSON.parse(event.data);

          if (isPaperFailed(data.status)) {
            setStatus(data.status);
            setError(data.error || data.error_message || null);
          }

          if (isPaperCompleted(data.status) && createProjectRef.current) {
            handleProjectCreation(id);
          } else {
            setIsGenerating(false);
          }

          eventSource.close();
        } catch (err) {
          console.error('Error parsing SSE complete:', err);
        }
      });

      eventSource.addEventListener('error', (event) => {
        console.error('SSE error event:', event);
        if (useSSE.current) {
          console.log('SSE unavailable, falling back to polling');
          useSSE.current = false;
          eventSource.close();
          startPolling(id);
        }
      });

      eventSource.onerror = (sseError) => {
        console.error('SSE connection error:', sseError);
        if (useSSE.current && sseError.target.readyState === EventSource.CLOSED) {
          console.log('SSE connection closed, falling back to polling');
          useSSE.current = false;
          eventSource.close();
          startPolling(id);
        }
      };
    } catch (err) {
      console.error('Error creating SSE connection:', err);
      useSSE.current = false;
      startPolling(id);
    }
  }, [handleProjectCreation, startPolling]);

  const startGeneration = useCallback(async (params, withProject = false) => {
    try {
      setIsGenerating(true);
      setError(null);
      setStatus('pending');
      setProgress(0);
      setMessage(null);
      setPaperData(null);
      setCreatedProject(null);
      setCreateProject(withProject);
      useSSE.current = true;

      const response = withProject
        ? await startPaperGenerationWithProject(params)
        : await startPaperGeneration(params);

      const generationId = response.document_id || response.paper_id || response.id;
      if (!generationId) {
        throw new Error('Generation id missing from API response');
      }

      setPaperId(generationId);
      setStatus('in_progress');

      if (useSSE.current) {
        connectSSE(generationId);
      } else {
        startPolling(generationId);
      }
    } catch (err) {
      console.error('Failed to start document generation:', err);
      setError(err.message);
      setStatus('failed');
      setIsGenerating(false);
    }
  }, [connectSSE, startPolling]);

  const reset = useCallback(() => {
    stopPolling();
    hadErrorRef.current = false;
    setPaperId(null);
    setStatus('pending');
    setPhase(null);
    setProgress(0);
    setMessage(null);
    setPaperData(null);
    setError(null);
    setIsGenerating(false);
    setCreatedProject(null);
    setCreateProject(false);
    setRecoveredFromError(false);
  }, [stopPolling]);

  const refreshStatus = useCallback(async () => {
    if (!paperId) return;

    try {
      const data = await getPaperStatus(paperId);
      setStatus(data.status);
      setPhase(data.phase);
      setProgress(data.progress || 0);
      setMessage(data.message);

      if (data.paper_data) {
        setPaperData(data.paper_data);
      }
    } catch (err) {
      console.error('Failed to refresh status:', err);
      setError(err.message);
    }
  }, [paperId]);

  const resumeExistingPaper = useCallback(async (existingPaperId, shouldCreateProject = true) => {
    try {
      console.log('resumeExistingPaper called with:', { existingPaperId, shouldCreateProject });
      setPaperId(existingPaperId);
      setIsGenerating(true);
      setError(null);
      hadErrorRef.current = false;
      setRecoveredFromError(false);
      setCreateProject(shouldCreateProject);
      useSSE.current = true;

      const data = await getPaperStatus(existingPaperId);
      setStatus(data.status);
      setPhase(data.phase);
      setProgress(data.progress || 0);
      setMessage(data.message);

      if (data.paper_data) {
        setPaperData(data.paper_data);
      }

      if (isPaperInProgress(data.status)) {
        if (useSSE.current) {
          connectSSE(existingPaperId);
        } else {
          startPolling(existingPaperId);
        }
      } else if (isPaperCompleted(data.status) && shouldCreateProject) {
        await handleProjectCreation(existingPaperId);
      } else {
        console.log('Generation completed but no project creation needed');
        setIsGenerating(false);
      }
    } catch (resumeError) {
      console.error('Failed to resume generation:', resumeError);
      setError(resumeError.message);
      setIsGenerating(false);
    }
  }, [connectSSE, startPolling, handleProjectCreation]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  useEffect(() => {
    createProjectRef.current = createProject;
  }, [createProject]);

  useEffect(() => {
    if (paperId && isPaperInProgress(status) && !isPollingRef.current && !eventSourceRef.current) {
      if (useSSE.current) {
        connectSSE(paperId);
      } else {
        startPolling(paperId);
      }
    }
  }, [paperId, status, connectSSE, startPolling]);

  useEffect(() => {
    if (createdProject && typeof window !== 'undefined') {
      const timer = setTimeout(() => {
        window.location.href = `/editor/${createdProject.id}`;
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [createdProject]);

  return {
    paperId,
    status,
    phase,
    progress,
    message,
    paperData,
    error,
    isGenerating,
    createdProject,
    recoveredFromError,

    startGeneration,
    reset,
    refreshStatus,
    resumeExistingPaper,

    isInProgress: isPaperInProgress(status),
    isCompleted: isPaperCompleted(status),
    isFailed: isPaperFailed(status),
    hasPaperId: !!paperId,
    hasProject: !!createdProject,

    // Document-first aliases
    documentId: paperId,
    documentData: paperData,
    hasDocumentId: !!paperId,
    resumeExistingDocument: resumeExistingPaper,
  };
}
