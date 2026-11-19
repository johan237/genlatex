// SPDX-License-Identifier: MIT

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, ChevronLeftIcon, InfoCircledIcon, LightningBoltIcon, UploadIcon } from '@radix-ui/react-icons';
import { Box, Button, Flex, Heading, Text, TextArea } from '@radix-ui/themes';
import { useToast } from './Toast';

const SUPPORTED_UPLOADS = '.pdf,.txt,.md,.csv,.tsv,.json,.xml,.yaml,.yml,.xlsx,.xls,.py,.ipynb,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.go,.rs,.r,.tex,.bib,.bibtex,.zip,.png,.jpg,.jpeg,.gif,.webp,.bmp,.tiff,.svg,.ppt,.pptx,.doc,.docx';

const DOCUMENT_KIND_META = {
  cv: {
    label: 'CV / Resume',
    documentType: 'cv',
    documentTemplate: 'modern_resume',
    documentSchemaId: 'cv_professional'
  },
  letter: {
    label: 'Letter',
    documentType: 'letter',
    documentTemplate: 'professional_letter',
    documentSchemaId: 'letter_professional'
  },
  report: {
    label: 'Report',
    documentType: 'report',
    documentTemplate: 'technical_report',
    documentSchemaId: 'report_technical'
  },
  business: {
    label: 'Business Document',
    documentType: 'business',
    documentTemplate: 'business_report',
    documentSchemaId: 'business_report'
  },
  technical: {
    label: 'Technical Document',
    documentType: 'technical',
    documentTemplate: 'technical_document',
    documentSchemaId: 'technical_document'
  },
  slides: {
    label: 'Slides',
    documentType: 'slides',
    documentTemplate: 'presentation_standard',
    documentSchemaId: 'slides_standard'
  },
  invoice: {
    label: 'Invoice',
    documentType: 'invoice',
    documentTemplate: 'invoice_standard',
    documentSchemaId: 'invoice_standard'
  },
  proposal: {
    label: 'Project Proposal',
    documentType: 'proposal',
    documentTemplate: 'project_proposal',
    documentSchemaId: 'proposal_project'
  },
  article: {
    label: 'Article / Document',
    documentType: 'article',
    documentTemplate: 'modern_article',
    documentSchemaId: 'article_general'
  }
};

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function inferDocumentKind(text) {
  const input = String(text || '').toLowerCase();
  if (!input) return 'article';

  if (/\b(cv|resume|curriculum vitae)\b/.test(input)) return 'cv';
  if (/\b(cover letter|motivation letter|recommendation letter|letter)\b/.test(input)) return 'letter';
  if (/\b(invoice|quotation|billing statement|bill)\b/.test(input)) return 'invoice';
  if (/\b(proposal|project proposal|grant proposal|bid)\b/.test(input)) return 'proposal';
  if (/\b(powerpoint|pptx|ppt|slides|slide deck|deck|presentation|beamer)\b/.test(input)) return 'slides';
  if (/\b(business plan|business case|market analysis|executive brief|strategy)\b/.test(input)) return 'business';
  if (/\b(report|financial|technical report|business report|annual report|audit)\b/.test(input)) return 'report';
  if (/\b(technical document|specification|design doc|manual|architecture document|api spec)\b/.test(input)) return 'technical';
  return 'article';
}

function normalizeDocumentKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'presentation') return 'slides';
  if (normalized === 'resume') return 'cv';
  return DOCUMENT_KIND_META[normalized] ? normalized : null;
}

function buildConversationTranscript(messages) {
  const transcript = messages
    .map((message, idx) => `${idx + 1}. ${message.role.toUpperCase()}: ${message.text}`)
    .join('\n');

  if (transcript.length <= 3500) return transcript;
  return `${transcript.slice(0, 3500)}\n...[truncated for fast generation]`;
}

function buildGenerationDescription(initialPrompt, messages) {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.trim())
    .filter(Boolean);

  const merged = [
    String(initialPrompt || '').trim(),
    ...userMessages.slice(1)
  ].filter(Boolean).join('\n');

  if (!merged) return '';
  return merged.length > 6000 ? `${merged.slice(0, 6000)}...` : merged;
}

export default function BuildIntakeWorkspace({
  initialDescription,
  initialMode = 'build',
  initialFiles = [],
  initialFastMode = true,
  onBack,
  onStartCreating
}) {
  const { toast } = useToast();
  const uploadRef = useRef(null);
  const chatEndRef = useRef(null);

  const [files, setFiles] = useState(Array.isArray(initialFiles) ? initialFiles : []);
  const [flashMode, setFlashMode] = useState(Boolean(initialFastMode));
  const [projectTitle, setProjectTitle] = useState('');
  const [chatMessages, setChatMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [intakeBusy, setIntakeBusy] = useState(false);
  const [readyToBuild, setReadyToBuild] = useState(false);
  const [missingRequirements, setMissingRequirements] = useState([]);
  const [resolvedDocumentKind, setResolvedDocumentKind] = useState(() => inferDocumentKind(initialDescription || ''));
  const [loadingInit, setLoadingInit] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [initError, setInitError] = useState(null);

  const sanitizedPrompt = useMemo(() => String(initialDescription || '').trim(), [initialDescription]);
  const documentMeta = DOCUMENT_KIND_META[resolvedDocumentKind] || DOCUMENT_KIND_META.article;

  const canBuild = Boolean(projectTitle && !loadingInit && !creatingProject && !initError && !intakeBusy);
  const userMessageCount = useMemo(
    () => chatMessages.filter((message) => message.role === 'user').length,
    [chatMessages]
  );

  const requestIntakeTurn = useCallback(async (messagesToSend, documentKindHint) => {
    const response = await fetch('/api/build/intake-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messagesToSend,
        documentKindHint
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'Failed to generate assistant reply');
    }

    const assistantText = String(data.assistant_message || '').trim();
    const normalizedKind = normalizeDocumentKind(data.document_kind);

    return {
      assistantText: assistantText || 'Share a bit more detail and I will build the LaTeX document.',
      readyToBuild: Boolean(data.ready_to_build),
      missingRequirements: Array.isArray(data.missing_requirements) ? data.missing_requirements : [],
      documentKind: normalizedKind
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      if (!sanitizedPrompt || sanitizedPrompt.length < 20) {
        setInitError('Please provide a more detailed request (minimum 20 characters).');
        setLoadingInit(false);
        return;
      }

      setLoadingInit(true);
      setInitError(null);
      setReadyToBuild(false);
      setMissingRequirements([]);
      const initialKind = inferDocumentKind(sanitizedPrompt);
      setResolvedDocumentKind(initialKind);

      try {
        const titleRes = await fetch('/api/projects/suggest-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: sanitizedPrompt, mode: 'build' })
        });
        const titleData = await titleRes.json().catch(() => ({}));
        if (!titleRes.ok || !titleData?.success) {
          throw new Error(titleData?.error || 'Failed to generate project title');
        }

        if (cancelled) return;
        const resolvedTitle = String(titleData.title || '').trim() || 'Untitled Document';
        setProjectTitle(resolvedTitle);

        const seedMessages = [{ role: 'user', text: sanitizedPrompt }];
        setChatMessages(seedMessages);
        setIntakeBusy(true);

        try {
          const intake = await requestIntakeTurn(seedMessages, initialKind);
          if (cancelled) return;

          if (intake.documentKind) {
            setResolvedDocumentKind(intake.documentKind);
          }
          setReadyToBuild(intake.readyToBuild);
          setMissingRequirements(intake.missingRequirements || []);
          setChatMessages([
            ...seedMessages,
            { role: 'assistant', text: intake.assistantText }
          ]);
        } catch (intakeError) {
          if (cancelled) return;
          setReadyToBuild(false);
          setMissingRequirements([]);
          setChatMessages([
            ...seedMessages,
            {
              role: 'assistant',
              text: 'I can build this for you in LaTeX. Tell me the target audience, required sections, preferred style, and any files to include.'
            }
          ]);
          console.warn('Intake fallback used:', intakeError);
        } finally {
          if (!cancelled) {
            setIntakeBusy(false);
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = error.message || 'Failed to initialize document builder';
          setInitError(message);
          toast.error(message);
        }
      } finally {
        if (!cancelled) {
          setLoadingInit(false);
        }
      }
    }

    initialize();
    return () => {
      cancelled = true;
    };
  }, [sanitizedPrompt, requestIntakeTurn, toast]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, loadingInit, initError]);

  function onUploadClick() {
    uploadRef.current?.click();
  }

  function onUploadChange(e) {
    const selected = Array.from(e.target.files || []);
    e.target.value = '';
    if (!selected.length) return;

    setFiles((prev) => {
      const seen = new Set(
        prev
          .filter((file) => file instanceof File)
          .map((file) => `${file.name}:${file.size}:${file.lastModified}`)
      );
      const next = [...prev];

      selected.forEach((file) => {
        const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(fingerprint)) return;
        seen.add(fingerprint);
        next.push(file);
      });

      return next;
    });
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function sendMessage() {
    const nextMessage = draft.trim();
    if (!nextMessage || intakeBusy) return;

    let nextMessages = [];
    setChatMessages((prev) => {
      nextMessages = [...prev, { role: 'user', text: nextMessage }];
      return nextMessages;
    });
    setDraft('');
    setIntakeBusy(true);

    try {
      const intake = await requestIntakeTurn(nextMessages, resolvedDocumentKind);
      if (intake.documentKind) {
        setResolvedDocumentKind(intake.documentKind);
      }
      setReadyToBuild(intake.readyToBuild);
      setMissingRequirements(intake.missingRequirements || []);
      setChatMessages((prev) => [...prev, { role: 'assistant', text: intake.assistantText }]);
    } catch (error) {
      console.warn('Failed to get intake response:', error);
      setReadyToBuild(false);
      setMissingRequirements([]);
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'I did not catch that fully. Share the key sections, preferred tone/style, and any files you want included.'
        }
      ]);
    } finally {
      setIntakeBusy(false);
    }
  }

  async function createProjectFromFlow() {
    if (!projectTitle) {
      toast.error('Project title is not ready yet.');
      return;
    }

    setCreatingProject(true);
    try {
      const transcript = buildConversationTranscript(chatMessages);
      const conversationInstructions = [
        'DOCUMENT GENERATION BRIEF:',
        `- Inferred document type: ${documentMeta.label}`,
        `- Original prompt: ${sanitizedPrompt}`,
        `- Intake readiness: ${readyToBuild ? 'ready_to_build' : 'needs_inference'}`,
        '- Use all user-provided constraints and section requirements from the chat transcript below.',
        '- If files are uploaded, extract relevant content from them and integrate it correctly.',
        '- Produce a complete, polished LaTeX document that compiles without syntax errors.',
        missingRequirements.length
          ? `- Fill missing details using reasonable professional defaults: ${missingRequirements.join('; ')}.`
          : '- Use explicit user preferences whenever provided; otherwise apply strong defaults.',
        '',
        'CHAT TRANSCRIPT:',
        transcript
      ].join('\n');

      const descriptionForGeneration = buildGenerationDescription(sanitizedPrompt, chatMessages);

      const formDataToSend = new FormData();
      formDataToSend.append('name', projectTitle);
      formDataToSend.append('workflowMode', 'ai_generate');
      formDataToSend.append('description', descriptionForGeneration || sanitizedPrompt);
      formDataToSend.append('template', 'basic');
      formDataToSend.append('githubLink', '');
      formDataToSend.append('githubToken', '');
      formDataToSend.append('editor', 'latex');
      formDataToSend.append('useAIGeneration', 'true');
      formDataToSend.append('fast_mode', flashMode ? 'true' : 'false');
      formDataToSend.append('documentType', documentMeta.documentType);
      formDataToSend.append('documentTemplate', documentMeta.documentTemplate);
      formDataToSend.append('documentSchemaId', documentMeta.documentSchemaId);
      formDataToSend.append('specialInstructions', conversationInstructions);

      files.forEach((file) => {
        if (file instanceof File) {
          formDataToSend.append('uploadedFiles', file);
        }
      });

      if (onStartCreating) {
        await onStartCreating({
          formDataToSend,
          formData: { useAIGeneration: true }
        });
      }
      setCreatingProject(false);
    } catch (error) {
      toast.error(error.message || 'Failed to start document build');
      setCreatingProject(false);
    }
  }

  return (
    <Box className="mx-auto w-full max-w-[1500px]">
      <input
        ref={uploadRef}
        type="file"
        multiple
        accept={SUPPORTED_UPLOADS}
        style={{ display: 'none' }}
        onChange={onUploadChange}
      />

      <Flex align="center" justify="between" style={{ marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
        <Flex align="center" gap="2">
          <Button variant="soft" onClick={onBack}>
            <ChevronLeftIcon width="14" height="14" />
            Back
          </Button>
          <Heading size="6">Document Workspace</Heading>
        </Flex>

        <Flex align="center" gap="2">
          <Button
            variant={flashMode ? 'solid' : 'soft'}
            onClick={() => setFlashMode((prev) => !prev)}
            style={flashMode ? { backgroundColor: 'var(--accent-9)', color: 'white' } : undefined}
          >
            <LightningBoltIcon width="14" height="14" />
            Flash {flashMode ? 'on' : 'off'}
          </Button>
          <Button variant="soft" onClick={onUploadClick}>
            <UploadIcon width="14" height="14" />
            Upload files
          </Button>
          <Button
            variant="solid"
            onClick={createProjectFromFlow}
            disabled={!canBuild}
            style={{ backgroundColor: 'var(--accent-9)', color: 'white' }}
          >
            Build
            <ArrowRightIcon width="14" height="14" />
          </Button>
        </Flex>
      </Flex>

      <Flex align="center" gap="2" style={{ marginBottom: '12px' }}>
        <InfoCircledIcon width="14" height="14" style={{ color: 'var(--gray-10)' }} />
        <Text size="2" style={{ color: 'var(--gray-10)' }}>
          {projectTitle
            ? `Auto title: ${projectTitle}. Current target: ${documentMeta.label}.`
            : 'Generating a project title from your request...'}
        </Text>
      </Flex>

      {files.length > 0 && (
        <Box
          style={{
            marginBottom: '12px',
            border: '1px solid var(--gray-6)',
            borderRadius: '10px',
            backgroundColor: '#eef2f7',
            padding: '10px'
          }}
        >
          <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
            Attached files ({files.length})
          </Text>
          <Box style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {files.map((file, index) => (
              <Box
                key={`${file.name}-${index}`}
                style={{
                  border: '1px solid var(--gray-6)',
                  borderRadius: '8px',
                  backgroundColor: 'white',
                  padding: '6px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
              >
                <Text size="1" style={{ color: 'var(--gray-12)' }}>
                  {file.name} ({formatFileSize(file.size)})
                </Text>
                <button
                  type="button"
                  onClick={() => removeFile(index)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--red-10)',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Remove
                </button>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Box
          style={{
            border: '1px solid var(--gray-6)',
            borderRadius: '12px',
            backgroundColor: 'white',
            minHeight: '560px',
            height: 'calc(100vh - 190px)',
            maxHeight: '860px',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <Box style={{ borderBottom: '1px solid var(--gray-5)', padding: '12px 14px' }}>
            <Text size="3" weight="medium" style={{ color: 'var(--gray-12)' }}>
              Document Chat
            </Text>
          </Box>

          <Box style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {loadingInit && (
              <Box style={{ border: '1px solid var(--gray-5)', backgroundColor: '#f3f4f6', borderRadius: '10px', padding: '12px' }}>
                <Text size="2" style={{ color: 'var(--gray-11)' }}>
                  Initializing document chat...
                </Text>
              </Box>
            )}

            {initError && (
              <Box style={{ border: '1px solid rgba(255, 77, 79, 0.35)', backgroundColor: 'rgba(255, 77, 79, 0.08)', borderRadius: '10px', padding: '12px' }}>
                <Text size="2" style={{ color: 'var(--red-11)' }}>
                  {initError}
                </Text>
              </Box>
            )}

            {!loadingInit && !initError && intakeBusy && (
              <Box style={{ border: '1px solid var(--gray-5)', backgroundColor: '#f3f4f6', borderRadius: '10px', padding: '12px', alignSelf: 'flex-start' }}>
                <Text size="2" style={{ color: 'var(--gray-11)' }}>
                  Thinking...
                </Text>
              </Box>
            )}

            {chatMessages.map((message, index) => {
              const isUser = message.role === 'user';
              return (
                <Box
                  key={`chat-${index}`}
                  style={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    marginLeft: isUser ? 'auto' : 0,
                    width: 'fit-content',
                    maxWidth: 'min(84%, 780px)',
                    border: isUser ? '1px solid rgba(15, 126, 231, 0.25)' : '1px solid var(--gray-5)',
                    backgroundColor: isUser ? 'rgba(15, 126, 231, 0.10)' : '#f3f4f6',
                    borderRadius: '10px',
                    padding: '10px 12px'
                  }}
                >
                  <Text size="2" style={{ color: 'var(--gray-12)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                    {message.text}
                  </Text>
                </Box>
              );
            })}

            <div ref={chatEndRef} />
          </Box>

          <Box style={{ borderTop: '1px solid var(--gray-5)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <TextArea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Describe content, style, constraints, or files to include (Enter to send, Shift+Enter for new line)"
              disabled={intakeBusy}
              style={{ minHeight: '84px' }}
            />
            <Flex justify="end">
              <Button variant="soft" onClick={sendMessage} disabled={!draft.trim() || intakeBusy}>
                Send message
                <ArrowRightIcon width="14" height="14" />
              </Button>
            </Flex>
          </Box>
        </Box>

        <Box
          style={{
            border: '1px solid var(--gray-6)',
            borderRadius: '12px',
            backgroundColor: '#f7f8fa',
            minHeight: '560px',
            height: 'calc(100vh - 190px)',
            maxHeight: '860px',
            overflowY: 'auto',
            padding: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <Box style={{ border: '1px solid var(--gray-5)', borderRadius: '10px', backgroundColor: 'white', padding: '10px' }}>
            <Text size="3" weight="medium" style={{ color: 'var(--gray-12)' }}>
              Build Summary
            </Text>
            <Text size="2" style={{ color: 'var(--gray-11)', marginTop: '6px', display: 'block' }}>
              Prompt-first document generation chat. Share requirements and files, then build directly.
            </Text>

            <Box style={{ marginTop: '10px' }}>
              <Text size="1" weight="bold" style={{ color: 'var(--gray-11)', display: 'block' }}>
                Detected document kind
              </Text>
              <Text size="2" style={{ color: 'var(--gray-12)' }}>
                {documentMeta.label}
              </Text>
            </Box>

            <Box style={{ marginTop: '10px' }}>
              <Text size="1" weight="bold" style={{ color: 'var(--gray-11)', display: 'block' }}>
                Intake status
              </Text>
              <Text size="2" style={{ color: 'var(--gray-12)' }}>
                {readyToBuild ? 'Ready to build' : 'Collecting requirements'}
              </Text>
            </Box>

            <Box style={{ marginTop: '10px' }}>
              <Text size="1" weight="bold" style={{ color: 'var(--gray-11)', display: 'block' }}>
                Chat progress
              </Text>
              <Text size="2" style={{ color: 'var(--gray-12)' }}>
                {userMessageCount} user message{userMessageCount === 1 ? '' : 's'} collected
              </Text>
            </Box>

            {!readyToBuild && missingRequirements.length > 0 && (
              <Box style={{ marginTop: '10px' }}>
                <Text size="1" weight="bold" style={{ color: 'var(--gray-11)', display: 'block' }}>
                  Missing details
                </Text>
                <Text size="2" style={{ color: 'var(--gray-12)' }}>
                  {missingRequirements.slice(0, 3).join(' | ')}
                </Text>
              </Box>
            )}

            <Text size="1" style={{ color: 'var(--gray-10)', marginTop: '10px', display: 'block' }}>
              Flash mode: {flashMode ? 'On' : 'Off'} | Files: {files.length}
            </Text>
          </Box>

          <Box style={{ border: '1px solid var(--gray-5)', borderRadius: '10px', backgroundColor: 'white', padding: '10px' }}>
            <Text size="2" weight="medium" style={{ color: 'var(--gray-12)' }}>
              What Happens On Build
            </Text>
            <Text size="1" style={{ color: 'var(--gray-11)', marginTop: '6px', display: 'block' }}>
              1. Chat requirements are compiled into a generation brief.
            </Text>
            <Text size="1" style={{ color: 'var(--gray-11)', display: 'block' }}>
              2. Uploaded files are sent as supporting context.
            </Text>
            <Text size="1" style={{ color: 'var(--gray-11)', display: 'block' }}>
              3. AI generates a complete LaTeX document in the editor.
            </Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
