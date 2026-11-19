// SPDX-License-Identifier: MIT

'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import DropdownMenu, { DropdownMenuItem, DropdownMenuSeparator } from '../../components/DropdownMenu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/Dialog';
import { TooltipProvider } from '../../components/Tooltip';
import SubscriptionUpgrade from '../../components/SubscriptionUpgrade';
import { 
  Button, 
  TextField, 
  Flex, 
  Text, 
  Heading, 
  IconButton,
  Box
} from '@radix-ui/themes';
import { 
  MagnifyingGlassIcon, 
  PlusIcon,
  UploadIcon,
  FileTextIcon,
  DotsVerticalIcon,
  GearIcon,
  HomeIcon,
  ArchiveIcon,
  RocketIcon,
  CubeIcon,
  LightningBoltIcon,
  InfoCircledIcon,
  ArrowRightIcon
} from '@radix-ui/react-icons';
import SettingsModal from '../../components/SettingsModal';
import LimitWarningModal from '../../components/LimitWarningModal';
import { useToast, useConfirm } from '../../components/Toast';
import { PageLoading } from '../../components/LoadingSpinner';

function normalizeGenerationErrorMessage(rawError) {
  const raw = String(rawError || '').trim();
  if (!raw) return 'Generation failed. Please try again.';

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
    return 'No generation credits are available on your plan right now.';
  }

  const quotedMessageMatch = raw.match(/['"]message['"]\s*:\s*['"]([^'"]+)['"]/i);
  if (quotedMessageMatch?.[1]) {
    return quotedMessageMatch[1].trim();
  }

  return raw;
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projects, setProjects] = useState([]);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [creatingProjectError, setCreatingProjectError] = useState(null);
  const [limitModalFromCreate, setLimitModalFromCreate] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [renameProject, setRenameProject] = useState(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [currentProject, setCurrentProject] = useState(null);
  const [shareEmails, setShareEmails] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [importZipLoading, setImportZipLoading] = useState(false);
  const [importZipError, setImportZipError] = useState(null);
  const [usage, setUsage] = useState(null);
  const [dashboardView, setDashboardView] = useState('projects'); // projects | home | tools
  const [ideaPrompt, setIdeaPrompt] = useState('');
  const [ideaFastMode, setIdeaFastMode] = useState(true);
  const [ideaFiles, setIdeaFiles] = useState([]);
  const [projectSearch, setProjectSearch] = useState('');
  const importZipInputRef = useRef(null);
  const ideaUploadInputRef = useRef(null);

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (session?.id) {
      fetch('/api/usage')
        .then((res) => res.json())
        .then((data) => data.success && data.usage && setUsage(data.usage))
        .catch(() => {});
    }
  }, [session?.id]);

  // Sync rename input when rename dialog opens (so input always shows current project name)
  useEffect(() => {
    if (renameProject) setRenameName(renameProject.name || '');
  }, [renameProject]);

  // Open upgrade modal when navigating from Settings "Update plan"
  useEffect(() => {
    if (searchParams.get('openUpgrade') === '1') {
      setShowUpgradeModal(true);
      router.replace('/dashboard', { scroll: false });
    }
  }, [searchParams, router]);

  // Zotero OAuth error redirects – show toast and clear URL
  useEffect(() => {
    const zotero = searchParams.get('zotero');
    const message = searchParams.get('message') || '';
    if (!zotero) return;
    if (zotero === 'config_error') {
      toast.error(
        'Zotero OAuth is not configured. Add ZOTERO_OAUTH_CLIENT_KEY and ZOTERO_OAUTH_CLIENT_SECRET to your server .env (from zotero.org/oauth/apps).',
        { duration: 8000 }
      );
    } else if (zotero === 'pro_required') {
      toast.error('Zotero connection requires a Pro plan.');
    } else if (zotero === 'error') {
      if (message === 'db_save') {
        toast.error(
          'Zotero OAuth: database table missing. Run the migration: lib/db-migrations/create-zotero-oauth-pending.sql',
          { duration: 8000 }
        );
      } else {
        const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://app.genlatex.com';
        toast.error(
          message ? `Zotero connection failed: ${decodeURIComponent(message)}` : `Zotero connection failed. Check server env (ZOTERO_OAUTH_*) and callback URL: ${baseUrl}/api/zotero/oauth/callback`,
          { duration: 8000 }
        );
      }
    }
    if (zotero) router.replace('/dashboard', { scroll: false });
  }, [searchParams, router, toast]);

  // Handle URL parameters for upgrade success/cancel
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const upgraded = urlParams.get('upgraded');
    const canceled = urlParams.get('canceled');

    if (upgraded === 'true') {
      setShowSuccessMessage(true);
      
      const sessionId = urlParams.get('session_id');
      
      // Sync subscription from Stripe Checkout (fallback when webhook is delayed or failed)
      if (session?.id && sessionId) {
        fetch('/api/subscription/sync-from-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        })
          .then(res => res.json())
          .then((data) => {
            if (process.env.NODE_ENV === 'development') console.log('Subscription synced:', data?.message ?? data);
            loadSubscription();
            load();
          })
          .catch(err => {
            console.error('Error syncing subscription:', err);
            loadSubscription();
            load();
          });
      } else if (session?.id) {
        loadSubscription();
        load();
      }
      
      // Clean up URL after a short delay
      setTimeout(() => {
        router.replace('/dashboard');
        setShowSuccessMessage(false);
      }, 3000);
      
    } else if (canceled === 'true') {
      router.replace('/dashboard');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, router]);

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/session');
      const data = await res.json();
      if (data.user) {
        setSession(data.user);
        load();
      } else {
        router.push('/login');
      }
    } catch (error) {
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }

  async function load() {
    setProjectsLoading(true);
    try {
      const res = await fetch('/api/projects');
      if (res.ok) {
        const projects = await res.json();
        setProjects(projects);
      }
    } catch (error) {
      console.error('Error loading projects:', error);
    } finally {
      setProjectsLoading(false);
    }
  }

  async function loadSubscription() {
    if (!session?.id) return;
    
    try {
      const res = await fetch(`/api/subscription?userId=${session.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) setSubscription(data.subscription);
      }
    } catch (error) {
      console.error('Error loading subscription:', error);
    }
  }

  useEffect(() => {
    if (session?.id) {
      loadSubscription();
    }
  }, [session]);

  function handleImportZipClick() {
    importZipInputRef.current?.click();
  }

  async function handleImportZipFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setImportZipError(null);
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.zip')) {
      setImportZipError('Please select a .zip file');
      toast.error('Please select a .zip file');
      return;
    }

    setImportZipLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        setImportZipError('ZIP file is empty');
        toast.error('ZIP file is empty');
        setImportZipLoading(false);
        return;
      }
      const view = new Uint8Array(arrayBuffer);
      const isValidZip = view.length >= 4 && view[0] === 0x50 && view[1] === 0x4B &&
        ((view[2] === 0x03 && view[3] === 0x04) || (view[2] === 0x05 && view[3] === 0x06));
      if (!isValidZip) {
        setImportZipError('Invalid ZIP file format');
        toast.error('Invalid ZIP file format');
        setImportZipLoading(false);
        return;
      }

      const formData = new FormData();
      formData.append('zip', file);

      const res = await fetch('/api/projects/import-zip', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setImportZipError(data.error || `Import failed (${res.status})`);
        toast.error(data.error || `Import failed (${res.status})`);
        return;
      }
      if (data.project?.id) {
        setImportZipError(null);
        toast.success('Project imported successfully!');
        load();
        router.push(`/editor/${data.project.id}`);
      } else {
        setImportZipError('Import succeeded but no project returned');
        toast.warning('Import succeeded but no project returned');
      }
    } catch (err) {
      setImportZipError(err.message || 'Failed to import ZIP');
      toast.error(err.message || 'Failed to import ZIP');
    } finally {
      setImportZipLoading(false);
    }
  }

  // Debug share dialog
  useEffect(() => {
    if (showShareDialog) {
      console.log('✅ Share dialog should be visible now');
      console.log('Current project:', currentProject);
    }
  }, [showShareDialog, currentProject]);

  function handleIdeaUploadClick() {
    ideaUploadInputRef.current?.click();
  }

  function handleIdeaUploadFileChange(e) {
    const selectedFiles = Array.from(e.target.files || []);
    e.target.value = '';
    if (!selectedFiles.length) return;
    setIdeaFiles((prev) => [...prev, ...selectedFiles]);
  }

  function removeIdeaFile(index) {
    setIdeaFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function createProjectAndOpenEditor({ description = '', files = [] } = {}) {
    const trimmedDescription = String(description || '').trim();
    const cleaned = trimmedDescription.replace(/\s+/g, ' ').trim();
    const generatedName = cleaned
      ? cleaned.split(' ').slice(0, 8).join(' ').slice(0, 80)
      : 'Untitled Document';

    setIsCreatingProject(true);
    setCreatingProjectError(null);
    try {
      const formData = new FormData();
      formData.append('name', generatedName || 'Untitled Document');
      formData.append('type', 'document');
      formData.append('workflowMode', 'manual');
      formData.append('useAIGeneration', 'false');
      formData.append('description', trimmedDescription);

      const fileList = Array.isArray(files) ? files : [];
      for (const file of fileList) {
        if (file instanceof File) {
          formData.append('uploadedFiles', file);
        }
      }

      const response = await fetch('/api/projects', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        if (response.status === 403 && errorData?.upgradeRequired) {
          setShowUpgradeModal(true);
        }
        throw new Error(normalizeGenerationErrorMessage(errorData.error || errorData.message || 'Failed to create project'));
      }

      const project = await response.json();
      router.push(`/editor/${project.id}`);
    } catch (error) {
      console.error('Error creating project:', error);
      const message = normalizeGenerationErrorMessage(error?.message || 'Failed to create project');
      setCreatingProjectError(message);
      toast.error(message, { duration: 8000 });
    } finally {
      setIsCreatingProject(false);
    }
  }

  async function startBuildFlow() {
    const description = ideaPrompt.trim();
    await createProjectAndOpenEditor({
      description,
      files: ideaFiles
    });
  }

  async function handleShareProject() {
    if (!shareEmails.trim()) {
      toast.warning('Please enter at least one email address');
      return;
    }

    const emails = shareEmails.split(',').map(e => e.trim()).filter(e => e.length > 0);
    
    if (emails.length === 0) {
      toast.warning('Please enter valid email addresses');
      return;
    }

    setShareLoading(true);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails,
          projectId: currentProject.id
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          toast.success(`Project shared successfully with ${emails.length} user(s)!`);
          setShowShareDialog(false);
          setShareEmails('');
          setCurrentProject(null);
        } else {
          toast.error('Failed to share project: ' + (data.error || 'Unknown error'));
        }
      } else {
        const error = await res.json();
        toast.error('Failed to share project: ' + (error.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error sharing project:', error);
      toast.error('Failed to share project. Please try again.');
    } finally {
      setShareLoading(false);
    }
  }

  async function del(id, event) {
    // Prevent any navigation or event bubbling
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    
    const confirmed = await confirm({
      title: 'Delete Project',
      description: 'Are you sure you want to delete this project? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger'
    });
    
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Project deleted successfully');
        load();
      } else {
        const error = await res.text();
        console.error('Failed to delete project:', error);
        toast.error('Failed to delete project: ' + error);
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Error deleting project: ' + error.message);
    }
  }

  if (loading) return <PageLoading message="Loading dashboard..." />;
  if (!session) return null;

  const isProPlan = Boolean(subscription?.isPro || usage?.isPro);
  const planName = isProPlan ? 'Pro plan' : 'Free plan';
  const creditsRemaining = usage?.paperCredits?.remaining;
  const creditsRemainingText = creditsRemaining === undefined
    ? '...'
    : creditsRemaining === -1
      ? 'Unlimited'
      : `${creditsRemaining}`;
  const creditsPeriodText = isProPlan ? 'this month' : 'for life';
  const storageLeftText = usage?.storage?.remainingFormatted || '...';
  const projectsRemaining = usage?.projects?.remaining;
  const projectsRemainingText = projectsRemaining === undefined
    ? '...'
    : projectsRemaining === -1
      ? 'Unlimited'
      : `${projectsRemaining}`;
  const dashboardName = session?.name || session?.email?.split('@')?.[0] || 'there';
  const filteredProjects = projects.filter((project) =>
    project?.name?.toLowerCase().includes(projectSearch.toLowerCase().trim())
  );
  const projectsLimit = usage?.projects?.max;
  const projectsUsed = usage?.projects?.used ?? projects.length;
  const projectsLimitBadge = projectsLimit === undefined
    ? `${filteredProjects.length} Projects`
    : `(${projectsUsed}/${projectsLimit === -1 ? '∞' : projectsLimit}) Projects`;
  const formatProjectAge = (createdAt) => {
    const createdAtTime = new Date(createdAt).getTime();
    if (!Number.isFinite(createdAtTime)) return 'recently';
    const diffMs = Date.now() - createdAtTime;
    if (diffMs < 0) return 'just now';

    const minutes = Math.floor(diffMs / (1000 * 60));
    if (minutes < 60) return `${Math.max(1, minutes)} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  };

  return (
    <TooltipProvider>
      {ConfirmDialog}
      {/* Full-screen loading overlay when creating project with AI */}
      {isCreatingProject && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            backgroundColor: 'var(--gray-1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px'
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              border: '3px solid var(--gray-6)',
              borderTopColor: 'var(--accent-9)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}
          />
          <p style={{ fontSize: '18px', fontWeight: 500, color: 'var(--gray-12)' }}>
            Creating your project...
          </p>
          <p style={{ fontSize: '14px', color: 'var(--gray-11)' }}>
            Preparing your workspace. You&apos;ll be redirected to the editor shortly.
          </p>
          {creatingProjectError && (
            <>
              <p style={{ fontSize: '14px', color: 'var(--red-9)' }}>{creatingProjectError}</p>
              <Button variant="soft" onClick={() => { setIsCreatingProject(false); setCreatingProjectError(null); }}>
                Back to dashboard
              </Button>
            </>
          )}
        </div>
      )}
      <LimitWarningModal
        open={!!limitModalFromCreate}
        onClose={() => {
          if (limitModalFromCreate) {
            router.push(`/editor/${limitModalFromCreate.id}`);
            setLimitModalFromCreate(null);
          }
        }}
        onUpgrade={() => {
          setLimitModalFromCreate(null);
          setShowUpgradeModal(true);
        }}
        limitType="paper"
        resetDate={usage?.paperCredits?.resetDate}
      />
      <Box className="min-h-screen w-full h-full" style={{ backgroundColor: 'var(--gray-2)', color: 'var(--gray-12)' }}>
        <Flex className="min-h-screen flex-col lg:flex-row">
          <Box
            className="w-full shrink-0 lg:w-[240px]"
            style={{
              backgroundColor: '#f3f4f6',
              borderBottom: '1px solid var(--gray-6)',
              borderRight: '1px solid var(--gray-6)'
            }}
          >
            <Box style={{ minHeight: '100%', padding: '12px 10px', display: 'flex', flexDirection: 'column' }}>
              <Flex align="center" justify="between" style={{ padding: '2px 4px 8px 6px' }}>
                <Link href="/dashboard" className="flex items-center">
                  <img src="/logo_genlatex_full.svg" alt="GenLaTeX" style={{ height: '30px', width: 'auto' }} />
                </Link>
                <MagnifyingGlassIcon width="16" height="16" style={{ color: 'var(--gray-10)' }} />
              </Flex>

              <input
                ref={importZipInputRef}
                type="file"
                accept=".zip"
                style={{ display: 'none' }}
                onChange={handleImportZipFileChange}
              />

              <Box style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => router.push('/new-project-chat')}
                  style={{
                    width: '100%',
                    height: '36px',
                    borderRadius: '7px',
                    border: '1px solid var(--accent-9)',
                    backgroundColor: 'var(--accent-9)',
                    color: 'white',
                    fontSize: '15px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <PlusIcon width="14" height="14" />
                  Create project
                </button>
                <button
                  type="button"
                  onClick={handleImportZipClick}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '7px',
                    border: '1px solid var(--gray-6)',
                    backgroundColor: '#eef0f2',
                    color: 'var(--gray-12)',
                    fontSize: '14px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer'
                  }}
                >
                  <UploadIcon width="14" height="14" />
                  {importZipLoading ? 'Importing...' : 'Import project'}
                </button>
                {importZipError && (
                  <Text size="1" style={{ color: 'var(--red-11)', paddingLeft: '4px' }}>
                    {importZipError}
                  </Text>
                )}
              </Box>

              <Box style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {[
                  { id: 'home', label: 'Home', icon: HomeIcon },
                  { id: 'projects', label: 'Projects', icon: ArchiveIcon },
                  { id: 'tools', label: 'Tools', icon: RocketIcon, soon: true }
                ].map(({ id, label, icon: Icon, soon }) => {
                  const isActive = dashboardView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDashboardView(id)}
                      style={{
                        width: '100%',
                        height: '36px',
                        borderRadius: '7px',
                        border: '1px solid transparent',
                        backgroundColor: isActive ? 'rgba(15, 126, 231, 0.12)' : 'transparent',
                        color: isActive ? 'var(--accent-11)' : 'var(--gray-12)',
                        fontSize: '16px',
                        fontWeight: isActive ? 600 : 500,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon width="14" height="14" />
                        {label}
                      </span>
                      {soon && (
                        <span style={{ fontSize: '11px', color: 'var(--gray-10)', fontWeight: 500 }}>
                          Soon
                        </span>
                      )}
                    </button>
                  );
                })}
              </Box>

              <Box style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '14px' }}>
                <button
                  type="button"
                  onClick={() => setShowSettingsDialog(true)}
                  style={{
                    width: '100%',
                    height: '34px',
                    borderRadius: '8px',
                    border: '1px solid var(--gray-6)',
                    backgroundColor: '#e9ebef',
                    color: 'var(--gray-12)',
                    fontSize: '14px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '0 12px',
                    cursor: 'pointer'
                  }}
                >
                  <GearIcon width="14" height="14" />
                  Settings
                </button>

                <Box style={{ border: '1px solid #cfd3da', borderRadius: '10px', backgroundColor: '#f1f2f5', padding: '10px 12px' }}>
                  <Text size="1" style={{ color: 'var(--gray-10)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Plan
                  </Text>
                  <Text size="3" weight="bold" style={{ color: 'var(--gray-12)' }}>
                    {planName}
                  </Text>
                </Box>

                <Box style={{ border: '1px solid #cfd3da', borderRadius: '10px', backgroundColor: '#f1f2f5', padding: '10px 12px' }}>
                  <Text size="1" style={{ color: 'var(--gray-10)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Agent credits
                  </Text>
                  <Text size="3" weight="bold" style={{ color: 'var(--gray-12)' }}>
                    {creditsRemainingText}
                  </Text>
                  <Text size="1" style={{ color: 'var(--gray-11)' }}>
                    remaining {creditsPeriodText}
                  </Text>
                </Box>

                <Box style={{ border: '1px solid #cfd3da', borderRadius: '10px', backgroundColor: '#f1f2f5', padding: '10px 12px' }}>
                  <Text size="1" style={{ color: 'var(--gray-10)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Cloud usage
                  </Text>
                  <Text size="3" weight="bold" style={{ color: 'var(--gray-12)' }}>
                    {storageLeftText}
                  </Text>
                  <Text size="1" style={{ color: 'var(--gray-11)' }}>
                    storage left
                  </Text>
                </Box>

                {!isProPlan && (
                  <>
                    <Box style={{ border: '1px solid rgba(15, 126, 231, 0.45)', borderRadius: '10px', backgroundColor: 'rgba(15, 126, 231, 0.10)', padding: '10px 12px' }}>
                      <Text size="1" style={{ color: 'var(--accent-11)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Projects remaining
                      </Text>
                      <Text size="3" weight="bold" style={{ color: 'var(--accent-11)' }}>
                        {projectsRemainingText}
                      </Text>
                    </Box>
                    <button
                      type="button"
                      onClick={() => setShowUpgradeModal(true)}
                      style={{
                        width: '100%',
                        height: '34px',
                        borderRadius: '8px',
                        border: '1px solid var(--accent-9)',
                        backgroundColor: 'var(--accent-9)',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Upgrade to Pro
                    </button>
                  </>
                )}
              </Box>
            </Box>
          </Box>

          <Box className="flex-1 min-w-0 overflow-auto px-4 py-5 md:px-8 md:py-7" style={{ backgroundColor: '#f7f8fa' }}>
            {dashboardView === 'home' && (
              <Box className="mx-auto w-full max-w-[860px] pt-8 md:pt-16">
                <Heading size="8" style={{ textAlign: 'center', color: 'var(--gray-12)' }}>
                  Hi {dashboardName}, what do you want to make?
                </Heading>

                <Box style={{ marginTop: '34px' }}>
                  <input
                    ref={ideaUploadInputRef}
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    onChange={handleIdeaUploadFileChange}
                  />
                  <Flex justify="center" style={{ marginBottom: '-1px' }}>
                    <button
                      type="button"
                      style={{
                        width: '200px',
                        height: '44px',
                        borderTopLeftRadius: '10px',
                        borderTopRightRadius: '10px',
                        border: '1px solid var(--gray-6)',
                        borderBottomColor: 'white',
                        backgroundColor: 'white',
                        color: 'var(--gray-12)',
                        fontSize: '16px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        cursor: 'default'
                      }}
                    >
                      <CubeIcon width="14" height="14" />
                      Build
                    </button>
                  </Flex>

                  <Box
                    style={{
                      border: '1px solid var(--gray-6)',
                      borderRadius: '12px',
                      backgroundColor: 'white',
                      padding: '16px 16px 14px 16px'
                    }}
                  >
                    <textarea
                      value={ideaPrompt}
                      onChange={(e) => setIdeaPrompt(e.target.value)}
                      placeholder="Describe what you want to create..."
                      style={{
                        width: '100%',
                        minHeight: '176px',
                        border: 'none',
                        outline: 'none',
                        resize: 'vertical',
                        fontSize: '15px',
                        color: 'var(--gray-12)',
                        backgroundColor: 'transparent'
                      }}
                    />

                    {ideaFiles.length > 0 && (
                      <Box
                        style={{
                          marginTop: '8px',
                          marginBottom: '8px',
                          border: '1px solid var(--gray-5)',
                          borderRadius: '8px',
                          backgroundColor: '#f7f8fa',
                          padding: '8px'
                        }}
                      >
                        <Text size="1" style={{ color: 'var(--gray-10)' }}>
                          Attached files ({ideaFiles.length})
                        </Text>
                        <Box style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {ideaFiles.map((file, index) => (
                            <Box
                              key={`${file.name}-${index}`}
                              style={{
                                border: '1px solid var(--gray-5)',
                                borderRadius: '6px',
                                backgroundColor: 'white',
                                padding: '4px 6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              <Text size="1" style={{ color: 'var(--gray-12)' }}>
                                {file.name}
                              </Text>
                              <button
                                type="button"
                                onClick={() => removeIdeaFile(index)}
                                style={{
                                  border: 'none',
                                  background: 'transparent',
                                  color: 'var(--red-10)',
                                  cursor: 'pointer',
                                  fontSize: '11px'
                                }}
                              >
                                Remove
                              </button>
                            </Box>
                          ))}
                        </Box>
                      </Box>
                    )}

                    <Flex align="center" justify="between" style={{ marginTop: '10px', gap: '12px', flexWrap: 'wrap' }}>
                      <Flex align="center" gap="2">
                        <button
                          type="button"
                          style={{
                            borderRadius: '7px',
                            border: '1px solid var(--gray-6)',
                            backgroundColor: '#f3f4f6',
                            color: 'var(--gray-12)',
                            height: '34px',
                            padding: '0 10px',
                            fontSize: '14px',
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            cursor: 'default'
                          }}
                        >
                          <CubeIcon width="14" height="14" />
                          Build
                        </button>
                        <button
                          type="button"
                          onClick={handleIdeaUploadClick}
                          style={{
                            borderRadius: '7px',
                            border: '1px solid var(--gray-6)',
                            backgroundColor: '#f3f4f6',
                            color: 'var(--gray-11)',
                            width: '34px',
                            height: '34px',
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer'
                          }}
                          aria-label="Attach context"
                        >
                          <UploadIcon width="14" height="14" />
                        </button>
                      </Flex>
                      <Flex align="center" gap="2">
                        <button
                          type="button"
                          onClick={() => setIdeaFastMode((prev) => !prev)}
                          aria-label="Toggle flash mode"
                          style={{
                            borderRadius: '8px',
                            border: `1px solid ${ideaFastMode ? 'var(--accent-9)' : 'var(--gray-6)'}`,
                            backgroundColor: ideaFastMode ? 'rgba(15, 126, 231, 0.12)' : '#f8f9fb',
                            color: ideaFastMode ? 'var(--accent-11)' : 'var(--gray-11)',
                            width: '38px',
                            height: '34px',
                            display: 'grid',
                            placeItems: 'center',
                            cursor: 'pointer'
                          }}
                        >
                          <LightningBoltIcon width="14" height="14" />
                        </button>
                        <button
                          type="button"
                          onClick={startBuildFlow}
                          style={{
                            borderRadius: '8px',
                            border: '1px solid var(--gray-6)',
                            backgroundColor: '#f8f9fb',
                            color: 'var(--gray-11)',
                            minWidth: '124px',
                            height: '34px',
                            padding: '0 12px',
                            fontSize: '14px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            cursor: 'pointer'
                          }}
                        >
                          Build
                          <ArrowRightIcon width="14" height="14" />
                        </button>
                      </Flex>
                    </Flex>
                  </Box>
                </Box>

                <Flex align="center" justify="center" gap="2" style={{ marginTop: '14px' }}>
                  <InfoCircledIcon width="14" height="14" style={{ color: 'var(--gray-10)' }} />
                  <Text size="2" style={{ color: 'var(--gray-10)' }}>
                    {`Flash mode is ${ideaFastMode ? 'on' : 'off'} for this run.`}
                  </Text>
                </Flex>
              </Box>
            )}

            {dashboardView === 'projects' && (
              <Box className="mx-auto w-full max-w-[1440px]">
                <Flex justify="between" align="start" style={{ marginBottom: '14px', gap: '14px', flexWrap: 'wrap' }}>
                  <Box>
                    <Flex align="center" gap="2" style={{ marginBottom: '6px' }}>
                      <ArchiveIcon width="20" height="20" />
                      <Heading size="8" style={{ color: 'var(--gray-12)' }}>
                        Projects
                      </Heading>
                      <Box
                        style={{
                          padding: '1px 8px',
                          borderRadius: '999px',
                          border: '1px solid rgba(15, 126, 231, 0.2)',
                          backgroundColor: 'rgba(15, 126, 231, 0.10)',
                          color: 'var(--accent-11)',
                          fontSize: '12px',
                          fontWeight: 600
                        }}
                      >
                        {projectsLimitBadge}
                      </Box>
                    </Flex>
                    <Text size="3" style={{ color: 'var(--gray-11)' }}>
                      All /
                    </Text>
                  </Box>

                  <Flex gap="2" align="center">
                    <button
                      type="button"
                      onClick={handleImportZipClick}
                      style={{
                        height: '34px',
                        borderRadius: '10px',
                        border: '1px solid transparent',
                        backgroundColor: 'rgba(15, 126, 231, 0.12)',
                        color: 'var(--accent-11)',
                        padding: '0 14px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      <UploadIcon width="13" height="13" />
                      Import project
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push('/new-project-chat')}
                      style={{
                        height: '34px',
                        borderRadius: '8px',
                        border: '1px solid var(--accent-9)',
                        backgroundColor: 'var(--accent-9)',
                        color: 'white',
                        padding: '0 14px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '7px'
                      }}
                    >
                      <PlusIcon width="13" height="13" />
                      Create project
                    </button>
                  </Flex>
                </Flex>

                <Box
                  style={{
                    border: '1px solid var(--gray-6)',
                    borderRadius: '10px',
                    backgroundColor: '#f4f5f7',
                    padding: '10px 0 12px 0'
                  }}
                >
                  <Flex justify="between" align="center" style={{ gap: '12px', padding: '0 12px 10px 12px', flexWrap: 'wrap' }}>
                    <TextField.Root
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      placeholder="Search projects"
                      size="3"
                      style={{ width: '100%', maxWidth: '380px' }}
                    >
                      <TextField.Slot>
                        <MagnifyingGlassIcon width="14" height="14" />
                      </TextField.Slot>
                    </TextField.Root>
                    <Text size="3" style={{ color: 'var(--gray-10)' }}>
                      {projectsLoading ? 'Loading...' : `${filteredProjects.length} projects`}
                    </Text>
                  </Flex>

                  {projectsLoading && (
                    <Box style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
                      <div
                        style={{
                          width: '34px',
                          height: '34px',
                          border: '3px solid var(--gray-5)',
                          borderTopColor: 'var(--accent-9)',
                          borderRadius: '50%',
                          animation: 'spin 0.8s linear infinite'
                        }}
                      />
                    </Box>
                  )}

                  {!projectsLoading && filteredProjects.map((p) => (
                    <Box
                      key={p.id}
                      onClick={() => router.push(`/editor/${p.id}`)}
                      style={{
                        margin: '0 12px 8px 12px',
                        border: '1px solid var(--gray-5)',
                        borderRadius: '8px',
                        backgroundColor: '#eceef0',
                        padding: '12px 10px',
                        cursor: 'pointer'
                      }}
                    >
                      <Flex justify="between" align="center">
                        <Flex align="center" gap="3">
                          <Box
                            width="28px"
                            height="28px"
                            style={{
                              borderRadius: '7px',
                              border: '1px solid var(--gray-5)',
                              backgroundColor: '#f7f8fa',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <FileTextIcon width="14" height="14" />
                          </Box>
                          <Box>
                            <Text size="4" weight="medium" style={{ color: 'var(--gray-12)' }}>
                              {p.name}
                            </Text>
                            <Text size="2" style={{ color: 'var(--gray-10)' }}>
                              {formatProjectAge(p.created_at)}
                            </Text>
                          </Box>
                        </Flex>
                        <Box onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu
                            trigger={
                              <IconButton variant="ghost" size="2">
                                <DotsVerticalIcon width="15" height="15" />
                              </IconButton>
                            }
                          >
                            <DropdownMenuItem onSelect={() => window.open(`/editor/${p.id}`, '_blank')}>
                              Open in new tab
                            </DropdownMenuItem>
                            {isProPlan && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setCurrentProject(p);
                                  setShowShareDialog(true);
                                }}
                              >
                                Share project
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() => {
                                setRenameProject(p);
                                setRenameName(p.name || '');
                                setShowRenameDialog(true);
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={(e) => {
                                e?.preventDefault?.();
                                e?.stopPropagation?.();
                                del(p.id, e);
                              }}
                              className="text-red-600 dark:text-red-400"
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenu>
                        </Box>
                      </Flex>
                    </Box>
                  ))}

                  {!projectsLoading && filteredProjects.length === 0 && (
                    <Box style={{ padding: '64px 16px', textAlign: 'center' }}>
                      <Heading size="6" style={{ marginBottom: '8px' }}>
                        No projects yet
                      </Heading>
                      <Text size="2" style={{ color: 'var(--gray-10)' }}>
                        Create your first project to start writing with GenLaTeX.
                      </Text>
                      <Box style={{ marginTop: '16px' }}>
                        <Button
                          onClick={() => router.push('/new-project-chat')}
                          variant="solid"
                          style={{ borderRadius: '8px', backgroundColor: 'var(--accent-9)', color: 'white' }}
                        >
                          <PlusIcon width="14" height="14" />
                          Create project
                        </Button>
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            )}

            {dashboardView === 'tools' && (
              <Box style={{ maxWidth: '760px', margin: '40px auto 0 auto', textAlign: 'center' }}>
                <Heading size="8" style={{ marginBottom: '10px' }}>Tools</Heading>
                <Text size="3" style={{ color: 'var(--gray-10)' }}>
                  We will keep this page as-is for now. Tool navigation is ready and full dashboard integration can be added next.
                </Text>
                <Box style={{ marginTop: '20px' }}>
                  <Button onClick={() => setDashboardView('projects')} variant="soft">
                    Back to projects
                  </Button>
                </Box>
              </Box>
            )}
          </Box>
        </Flex>
      </Box>
      {showUpgradeModal && subscription && (
        <SubscriptionUpgrade
          userId={session?.id}
          userEmail={session?.email || session?.user?.email}
          userName={session?.name || session?.user?.name}
          currentPlan={subscription.planId}
          onClose={() => setShowUpgradeModal(false)}
          onSuccess={(updatedSubscription) => {
            setSubscription(updatedSubscription);
            setShowUpgradeModal(false);
            load(); // Refresh projects in case limit was lifted
          }}
        />
      )}

      {showSuccessMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          zIndex: 9999,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          animation: 'slideIn 0.3s ease-out',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          fontSize: '14px',
          fontWeight: '500',
          minWidth: '300px'
        }}>
          <div style={{ fontSize: '24px' }}>🎉</div>
          <div>
            <div style={{ fontWeight: '600', marginBottom: '2px' }}>Successfully Upgraded!</div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>Welcome to Pro - Enjoy unlimited features</div>
          </div>
        </div>
      )}

      {/* Settings Modal (same as editor) */}
      <SettingsModal
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        user={{
          id: session?.id,
          email: session?.email || session?.user?.email,
          name: session?.name || session?.user?.name
        }}
      />

      {/* Share Project Dialog */}
      <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
        <DialogContent className="sm:max-w-lg" style={{ maxHeight: '80vh' }}>
          <DialogHeader>
            <DialogTitle>Share Project</DialogTitle>
            <DialogDescription>
              Invite others to collaborate on "{currentProject?.name || 'this project'}"
            </DialogDescription>
          </DialogHeader>

          <Flex direction="column" gap="4" style={{ margin: '24px 0' }}>
            <Box>
              <Text size="2" weight="medium" style={{ color: 'var(--gray-12)', marginBottom: '12px' }}>
                Email Addresses
              </Text>
              <Text size="1" style={{ color: 'var(--gray-11)', marginBottom: '8px' }}>
                Enter email addresses separated by commas
              </Text>
              <TextField.Root
                placeholder="user1@example.com, user2@example.com"
                value={shareEmails}
                onChange={(e) => setShareEmails(e.target.value)}
                disabled={shareLoading}
                style={{ fontSize: '14px' }}
              />
            </Box>

            <Box style={{ 
              padding: '24px 16px', 
              backgroundColor: 'var(--blue-2)', 
              borderRadius: '8px',
              border: '1px solid var(--blue-6)',
              cursor: 'pointer'
            }}>
              <Text size="2" style={{ color: 'var(--blue-11)' }}>
                💡 The invited users will receive an email with a link to access this project.
              </Text>
            </Box>
          </Flex>

          <Flex justify="end" gap="2">
            <Button
              variant="soft"
              size="3"
              onClick={() => {
                setShowShareDialog(false);
                setShareEmails('');
                setCurrentProject(null);
              }}
              disabled={shareLoading}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="3"
              onClick={handleShareProject}
              disabled={shareLoading}
              style={{
                backgroundColor: 'var(--accent-9)',
                color: 'white'
              }}
            >
              {shareLoading ? 'Sharing...' : 'Share Project'}
            </Button>
          </Flex>
        </DialogContent>
      </Dialog>

      {/* Rename Project Dialog */}
      <Dialog open={showRenameDialog} onOpenChange={(open) => { setShowRenameDialog(open); if (!open) setRenameProject(null); }}>
        <DialogContent className="sm:max-w-md" style={{ borderRadius: '12px', padding: '28px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)' }}>
          <DialogHeader style={{ marginBottom: '8px' }}>
            <DialogTitle style={{ fontSize: '20px', fontWeight: '600', letterSpacing: '-0.02em', color: 'var(--gray-12)' }}>
              Rename Project
            </DialogTitle>
            <DialogDescription style={{ fontSize: '14px', color: 'var(--gray-11)', marginTop: '6px', lineHeight: 1.5 }}>
              Enter a new name for <span style={{ fontWeight: 600, color: 'var(--gray-12)' }}>&quot;{renameProject?.name || 'this project'}&quot;</span>
            </DialogDescription>
          </DialogHeader>
          <Box style={{ margin: '24px 0' }}>
            <Text size="2" weight="medium" style={{ color: 'var(--gray-12)', marginBottom: '8px', display: 'block' }}>
              Project name
            </Text>
            <TextField.Root
              placeholder="Enter project name..."
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              disabled={renameLoading}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.form?.requestSubmit?.(); }}
              style={{
                fontSize: '15px',
                padding: '12px 14px',
                borderRadius: '8px',
                border: '1px solid var(--gray-6)',
                backgroundColor: 'var(--gray-1)'
              }}
            />
          </Box>
          <Flex justify="end" gap="3" style={{ marginTop: '8px', paddingTop: '24px', paddingBottom: '4px', borderTop: '1px solid var(--gray-4)' }}>
            <Button
              variant="soft"
              size="3"
              onClick={() => { setShowRenameDialog(false); setRenameProject(null); }}
              disabled={renameLoading}
              className="cursor-pointer"
              style={{ borderRadius: '8px', padding: '10px 24px', cursor: 'pointer' }}
            >
              Cancel
            </Button>
            <Button
              variant="solid"
              size="3"
              onClick={async () => {
                const name = renameName?.trim();
                if (!name) {
                  toast.error('Please enter a project name');
                  return;
                }
                if (!renameProject?.id) return;
                setRenameLoading(true);
                try {
                  const res = await fetch(`/api/projects/${renameProject.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) {
                    toast.error(data.error || 'Failed to rename project');
                    return;
                  }
                  toast.success('Project renamed');
                  setShowRenameDialog(false);
                  setRenameProject(null);
                  load();
                } catch (e) {
                  toast.error('Failed to rename project');
                } finally {
                  setRenameLoading(false);
                }
              }}
              disabled={renameLoading || !renameName?.trim()}
              className="cursor-pointer"
              style={{ backgroundColor: 'var(--accent-9)', color: 'white', borderRadius: '8px', padding: '10px 28px', cursor: 'pointer' }}
            >
              {renameLoading ? 'Saving...' : 'Save'}
            </Button>
          </Flex>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
