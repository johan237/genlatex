// SPDX-License-Identifier: MIT

'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client.js';
import { getCachedZoteroStatus, getCachedZoteroCollections, setCachedZoteroStatus, setCachedZoteroCollections, invalidateZoteroCache } from '@/lib/zotero-cache.js';

const TABS = [
  { id: 'account', label: 'Account', icon: AccountIcon },
  { id: 'billing', label: 'Billing', icon: BillingIcon },
  { id: 'zotero', label: 'Zotero', icon: ZoteroIcon },
];

function AccountIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function BillingIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function ZoteroIcon({ className }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

export default function SettingsModal({ isOpen, onClose, user, projectId = null }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('account');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [zoteroLinked, setZoteroLinked] = useState(false);
  const [zoteroUserId, setZoteroUserId] = useState(null);
  const [zoteroDefaultCollectionKey, setZoteroDefaultCollectionKey] = useState(null);
  const [zoteroCollections, setZoteroCollections] = useState([]);
  const [zoteroLoading, setZoteroLoading] = useState(false);
  const [zoteroCollectionsLoading, setZoteroCollectionsLoading] = useState(false);
  const [zoteroConnecting, setZoteroConnecting] = useState(false);
  const [zoteroUnlinking, setZoteroUnlinking] = useState(false);
  const [zoteroSavingDefault, setZoteroSavingDefault] = useState(false);
  const [zoteroError, setZoteroError] = useState(null);
  const [zoteroApiKey, setZoteroApiKey] = useState('');
  const [zoteroSelectedCollectionKey, setZoteroSelectedCollectionKey] = useState('');
  const [usage, setUsage] = useState(null);
  const [deleteHasPassword, setDeleteHasPassword] = useState(null);

  // Ensure we only render portal on client
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Fetch subscription status when modal opens and user exists
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    setSubscriptionLoading(true);
    setSubscription(null);
    fetch(`/api/subscription?userId=${user.id}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.success) {
          setSubscription(data.subscription);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSubscriptionLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  // Fetch usage when modal opens (for billing tab)
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    fetch('/api/usage')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data?.success && data.usage) setUsage(data.usage);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isOpen, user?.id]);

  // Fetch Zotero status when modal opens; use cache when available
  useEffect(() => {
    if (!isOpen || !user?.id) return;
    let cancelled = false;
    const cached = getCachedZoteroStatus();
    if (cached) {
      setZoteroLinked(!!cached.linked);
      setZoteroUserId(cached.zoteroUserId || null);
      const userDefault = cached.defaultCollectionKey ?? null;
      if (projectId) {
        fetch(`/api/projects/${projectId}/zotero-collection`)
          .then((r) => (r.ok ? r.json() : { collectionKey: null }))
          .then((proj) => {
            if (cancelled) return;
            const projectKey = proj.collectionKey ?? userDefault;
            setZoteroDefaultCollectionKey(projectKey);
            setZoteroSelectedCollectionKey(projectKey ?? '');
          })
          .catch(() => {
            if (!cancelled) {
              setZoteroDefaultCollectionKey(userDefault);
              setZoteroSelectedCollectionKey(userDefault ?? '');
            }
          });
      } else {
        setZoteroDefaultCollectionKey(userDefault);
        setZoteroSelectedCollectionKey(userDefault ?? '');
      }
      return;
    }
    setZoteroLoading(true);
    setZoteroError(null);
    fetch('/api/zotero/status')
      .then((res) => (res.ok ? res.json() : { linked: false }))
      .then((data) => {
        if (cancelled) return;
        setCachedZoteroStatus(data);
        setZoteroLinked(!!data.linked);
        setZoteroUserId(data.zoteroUserId || null);
        const userDefault = data.defaultCollectionKey ?? null;
        if (projectId) {
          return fetch(`/api/projects/${projectId}/zotero-collection`)
            .then((r) => (r.ok ? r.json() : { collectionKey: null }))
            .then((proj) => {
              if (cancelled) return;
              const projectKey = proj.collectionKey ?? userDefault;
              setZoteroDefaultCollectionKey(projectKey);
              setZoteroSelectedCollectionKey(projectKey ?? '');
            })
            .catch(() => {
              if (!cancelled) {
                setZoteroDefaultCollectionKey(userDefault);
                setZoteroSelectedCollectionKey(userDefault ?? '');
              }
            });
        }
        setZoteroDefaultCollectionKey(userDefault);
        setZoteroSelectedCollectionKey(userDefault ?? '');
      })
      .catch(() => { if (!cancelled) setZoteroLinked(false); })
      .finally(() => { if (!cancelled) setZoteroLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, user?.id, projectId]);

  // Fetch Zotero collections when Zotero tab is active and linked; use cache when available
  useEffect(() => {
    if (!isOpen || activeTab !== 'zotero' || !zoteroLinked) return;
    const cached = getCachedZoteroCollections();
    if (cached?.collections) {
      setZoteroCollections(cached.collections);
      return;
    }
    let cancelled = false;
    setZoteroCollectionsLoading(true);
    fetch('/api/zotero/collections')
      .then((res) => (res.ok ? res.json() : { collections: [] }))
      .then((data) => {
        if (!cancelled && data.collections) {
          setZoteroCollections(data.collections);
          setCachedZoteroCollections(data);
        }
      })
      .catch(() => { if (!cancelled) setZoteroCollections([]); })
      .finally(() => { if (!cancelled) setZoteroCollectionsLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen, activeTab, zoteroLinked]);

  if (!isOpen || !mounted) return null;

  const handleLogOut = async () => {
    setLoggingOut(true);
    try {
      await authClient.signOut();
      window.location.href = '/';
    } catch (e) {
      console.error(e);
      setLoggingOut(false);
    }
  };

  const handleDeleteAccountClick = () => {
    setDeleteError('');
    setDeletePassword('');
    setDeleteHasPassword(null);
    setShowDeleteConfirm(true);
    fetch('/api/auth/account-type')
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => setDeleteHasPassword(!!data.hasPassword))
      .catch(() => setDeleteHasPassword(false));
  };

  const handleDeleteAccountConfirm = async () => {
    setDeleteError('');
    if (deleteHasPassword && !deletePassword.trim()) {
      setDeleteError('Enter your password to confirm deletion.');
      return;
    }
    setDeleting(true);
    try {
      const { error } = await authClient.deleteUser({
        callbackURL: '/',
        password: deleteHasPassword ? deletePassword.trim() : undefined,
      });
      if (error) {
        setDeleteError(error.message || 'Failed to delete account');
        setDeleting(false);
        return;
      }
      window.location.href = '/';
    } catch (e) {
      console.error(e);
      setDeleteError(e.message || 'Failed to delete account');
      setDeleting(false);
    }
  };

  const handleDeleteAccountCancel = () => {
    setShowDeleteConfirm(false);
    setDeletePassword('');
    setDeleteError('');
    setDeleteHasPassword(null);
  };

  const connectToZotero = async () => {
    if (!zoteroApiKey?.trim()) return;
    setZoteroConnecting(true);
    setZoteroError(null);
    try {
      const validateRes = await fetch('/api/zotero/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: zoteroApiKey.trim() })
      });
      const validateData = await validateRes.json();
      if (!validateData.valid) {
        throw new Error(validateData.error || 'Invalid API key');
      }
      const linkRes = await fetch('/api/zotero/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: zoteroApiKey.trim() })
      });
      const linkData = await linkRes.json();
      if (!linkData.success) {
        if (linkData.error === 'zotero_pro_only' || linkRes.status === 403) {
          setZoteroError('Zotero integration requires a Pro subscription.');
          if (linkData.upgradeUrl) {
            onClose();
            router.push(linkData.upgradeUrl || '/dashboard?openUpgrade=1');
          }
        } else {
          setZoteroError(linkData.error || 'Failed to link Zotero');
        }
        return;
      }
      setZoteroLinked(true);
      setZoteroUserId(linkData.zoteroUserId || null);
      setZoteroApiKey('');
    } catch (err) {
      setZoteroError(err.message || 'Failed to connect to Zotero');
    } finally {
      setZoteroConnecting(false);
    }
  };

  const unlinkZotero = async () => {
    setZoteroUnlinking(true);
    setZoteroError(null);
    try {
      const res = await fetch('/api/zotero/unlink', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to unlink');
      setZoteroLinked(false);
      setZoteroUserId(null);
      invalidateZoteroCache();
    } catch (err) {
      setZoteroError(err.message || 'Failed to unlink Zotero');
    } finally {
      setZoteroUnlinking(false);
    }
  };

  const refetchZoteroStatus = () => {
    setZoteroLoading(true);
    setZoteroError(null);
    fetch('/api/zotero/status')
      .then((res) => (res.ok ? res.json() : { linked: false }))
      .then((data) => {
        setCachedZoteroStatus(data);
        setZoteroLinked(!!data.linked);
        setZoteroUserId(data.zoteroUserId || null);
        const userDefault = data.defaultCollectionKey ?? null;
        if (projectId) {
          fetch(`/api/projects/${projectId}/zotero-collection`)
            .then((r) => (r.ok ? r.json() : { collectionKey: null }))
            .then((proj) => {
              const projectKey = proj.collectionKey ?? userDefault;
              setZoteroDefaultCollectionKey(projectKey);
              setZoteroSelectedCollectionKey(projectKey ?? '');
            })
            .catch(() => {
              setZoteroDefaultCollectionKey(userDefault);
              setZoteroSelectedCollectionKey(userDefault ?? '');
            })
            .finally(() => setZoteroLoading(false));
          return;
        }
        setZoteroDefaultCollectionKey(userDefault);
        setZoteroSelectedCollectionKey(userDefault ?? '');
        setZoteroLoading(false);
      })
      .catch(() => { setZoteroLinked(false); setZoteroLoading(false); });
  };

  const saveZoteroDefaultCollection = async () => {
    setZoteroSavingDefault(true);
    setZoteroError(null);
    const payload = { collectionKey: zoteroSelectedCollectionKey === '' ? null : zoteroSelectedCollectionKey };
    try {
      const url = projectId
        ? `/api/projects/${projectId}/zotero-collection`
        : '/api/zotero/default-collection';
      const method = 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (projectId) {
        if (!data.success) throw new Error(data.error || 'Failed to save');
        setZoteroDefaultCollectionKey(data.collectionKey ?? null);
      } else {
        if (!data.success) throw new Error(data.error || 'Failed to save');
        setZoteroDefaultCollectionKey(data.defaultCollectionKey ?? null);
      }
    } catch (err) {
      setZoteroError(err.message || (projectId ? 'Failed to save library for this project' : 'Failed to save default library/collection'));
    } finally {
      setZoteroSavingDefault(false);
    }
    invalidateZoteroCache();
  };

  const connectWithZoteroOAuth = () => {
    setZoteroError(null);
    const w = window.open('/api/zotero/oauth/start', 'zotero-oauth', 'width=520,height=640,scrollbars=yes');
    if (!w) {
      setZoteroError('Please allow popups for this site, then try again.');
      return;
    }
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'zotero-connected') return;
      window.removeEventListener('message', onMessage);
      refetchZoteroStatus();
    };
    window.addEventListener('message', onMessage);
    const poll = setInterval(() => {
      if (w.closed) {
        clearInterval(poll);
        window.removeEventListener('message', onMessage);
        refetchZoteroStatus();
      }
    }, 500);
  };

  const modalContent = (
    <>
      <div
        className="fixed inset-0 bg-slate-900/35"
        style={{ zIndex: 9998 }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="fixed left-1/2 top-1/2 w-[calc(100%-1.5rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-slate-300 bg-slate-50 shadow-[0_18px_60px_rgba(15,23,42,0.22)]"
        style={{ zIndex: 9999 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-300 bg-white px-5 py-3">
          <h2 id="settings-title" className="text-lg font-semibold text-slate-900">
            Settings
          </h2>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-[500px] max-h-[82vh] flex-col md:flex-row">
          {/* Left sidebar */}
          <nav className="w-full shrink-0 border-b border-slate-200 bg-slate-100/80 p-2 md:w-56 md:border-b-0 md:border-r">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all ${
                  activeTab === id
                    ? 'border border-blue-200 bg-white text-blue-900 font-semibold'
                    : 'border border-transparent text-slate-600 hover:bg-white/80 hover:text-slate-900'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </button>
            ))}
          </nav>

          {/* Right content */}
          <div className="flex-1 overflow-auto bg-white p-5 md:p-6">
            {activeTab === 'account' && (
              <div className="space-y-8">
                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Account info
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Email address</span>
                      <span className="text-sm text-gray-500">
                        {user?.email || 'Not signed in'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">Sign-in method</span>
                      <span className="text-sm text-gray-500">
                        {user?.email ? 'Email' : '—'}
                      </span>
                    </div>
                  </div>
                </section>

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Log out
                  </h3>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Sign out of your account</p>
                      <p className="mt-1 text-sm text-gray-500">
                        You will need to sign in again to access GenLaTeX
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogOut}
                      disabled={loggingOut || !user?.id}
                      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loggingOut ? 'Signing out…' : 'Log out'}
                    </button>
                  </div>
                </section>

                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Danger zone
                  </h3>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Delete account</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Permanently delete your GenLaTeX account and all your projects and data. This cannot be undone.
                      </p>
                    </div>
                    {!showDeleteConfirm ? (
                      <button
                        type="button"
                        onClick={handleDeleteAccountClick}
                        disabled={!user?.id}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Delete account
                      </button>
                    ) : (
                      <div className="w-full space-y-3 rounded-lg border border-red-200 bg-red-50/50 p-4">
                        <p className="text-sm text-gray-700">
                          {deleteHasPassword === null
                            ? 'Checking account…'
                            : deleteHasPassword
                              ? 'Enter your password to confirm deletion.'
                              : 'This will permanently delete your account and all data. This cannot be undone.'}
                        </p>
                        {deleteHasPassword === true && (
                          <input
                            type="password"
                            value={deletePassword}
                            onChange={(e) => setDeletePassword(e.target.value)}
                            placeholder="Password"
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500"
                            autoComplete="current-password"
                          />
                        )}
                        {deleteError && (
                          <p className="text-sm text-red-600">{deleteError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleDeleteAccountConfirm}
                            disabled={deleting || !user?.id || deleteHasPassword === null || (deleteHasPassword === true && !deletePassword.trim())}
                            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {deleting ? 'Deleting…' : 'Delete my account'}
                          </button>
                          <button
                            type="button"
                            onClick={handleDeleteAccountCancel}
                            disabled={deleting}
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'billing' && (
              <div className="space-y-8">
                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Billing
                  </h3>
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">Plan</p>
                        <p className="text-sm text-gray-500">
                          {subscriptionLoading
                            ? 'Loading…'
                            : subscription?.isPro
                              ? 'Pro'
                              : 'Free'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            setSyncLoading(true);
                            try {
                              const res = await fetch('/api/subscription/sync', { method: 'POST' });
                              const data = await res.json();
                              if (data?.success && data?.subscription) {
                                setSubscription(data.subscription);
                              }
                            } catch (e) {
                              console.error('Sync failed:', e);
                            } finally {
                              setSyncLoading(false);
                            }
                          }}
                          disabled={syncLoading || subscriptionLoading}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {syncLoading ? 'Syncing…' : 'Refresh status'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            router.push('/dashboard?openUpgrade=1');
                          }}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          Update plan
                        </button>
                      </div>
                    </div>
                    {usage && (
                      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Current usage</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-600">
                          <span>Projects:</span>
                          <span className="font-medium text-gray-900">{usage.projects.used} / {usage.projects.max === -1 ? '∞' : usage.projects.max}</span>
                          <span>Storage:</span>
                          <span className="font-medium text-gray-900">{usage.storage.usedFormatted} / {usage.storage.maxFormatted}</span>
                          <span>Paper credits:</span>
                          <span className="font-medium text-gray-900">{usage.paperCredits.used} / {usage.paperCredits.max === -1 ? '∞' : usage.paperCredits.max}{usage.paperCredits.isLifetime ? ' (lifetime)' : ' this month'}</span>
                          <span>Chat today:</span>
                          <span className="font-medium text-gray-900">
                            {usage.chat.max === -1 ? 'Unlimited' : `${usage.chat.used}/${usage.chat.max}`}
                          </span>
                        </div>
                      </div>
                    )}
                    {subscription?.isPro ? (
                      <p className="text-sm text-gray-500">
                        Unlimited projects, no file size limits, unlimited AI chat, and email support.
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500">
                        Upgrade to Pro for unlimited projects, unlimited AI chat, and full access to all features.
                      </p>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'zotero' && (
              <div className="space-y-8">
                <section>
                  <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Zotero
                  </h3>
                  {subscriptionLoading ? (
                    <p className="text-sm text-gray-500">Loading…</p>
                  ) : !subscription?.isPro ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <p className="mb-2 text-sm font-medium text-gray-900">Zotero requires Pro plan</p>
                      <p className="mb-4 text-sm text-gray-600">
                        Connect your Zotero library for citations and references. Pro subscription required.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          router.push('/dashboard?openUpgrade=1');
                        }}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Upgrade to Pro
                      </button>
                    </div>
                  ) : zoteroLoading ? (
                    <p className="text-sm text-gray-500">Checking Zotero status…</p>
                  ) : !zoteroLinked ? (
                    <div className="space-y-6">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="mb-2 text-sm font-medium text-gray-700">Connect with Zotero</p>
                        <p className="mb-3 text-xs text-gray-500">Sign in on Zotero and accept the connection. No key needed.</p>
                        <button
                          type="button"
                          onClick={connectWithZoteroOAuth}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                        >
                          Connect with Zotero (accept in popup)
                        </button>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <p className="mb-2 text-sm font-medium text-gray-700">Or enter your API key</p>
                        <input
                          id="zotero-api-key"
                          type="password"
                          value={zoteroApiKey}
                          onChange={(e) => {
                            setZoteroApiKey(e.target.value);
                            setZoteroError(null);
                          }}
                          placeholder="Paste your Zotero API key"
                          className="mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                        />
                        <p className="mb-3 text-xs text-gray-500">Create a key at Zotero Settings → Feeds/API.</p>
                        <button
                          type="button"
                          onClick={connectToZotero}
                          disabled={zoteroConnecting || !zoteroApiKey.trim()}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {zoteroConnecting ? 'Connecting…' : 'Connect using key'}
                        </button>
                      </div>
                      {zoteroError && (
                        <p className="text-sm text-red-600">{zoteroError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-green-700">
                        Zotero connected {zoteroUserId ? `(user ${zoteroUserId})` : ''}
                      </p>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                        <p className="text-sm font-medium text-gray-700">
                          {projectId ? 'Library/collection for this project' : 'Default library/collection'}
                        </p>
                        <p className="text-xs text-gray-500">
                          {projectId
                            ? 'Load library for the current project. Other projects can use other libraries.'
                            : 'Used when a project has no library set. Open a project and open Settings there to choose a library for that project.'}
                        </p>
                        {zoteroCollectionsLoading ? (
                          <p className="text-sm text-gray-500">Loading collections…</p>
                        ) : (
                          <>
                            <select
                              value={zoteroSelectedCollectionKey}
                              onChange={(e) => {
                                setZoteroSelectedCollectionKey(e.target.value);
                                setZoteroError(null);
                              }}
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                            >
                              <option value="">My Library (entire library)</option>
                              {zoteroCollections.map((col) => (
                                <option key={col.key} value={col.key}>
                                  {col.name} {col.itemCount != null ? `(${col.itemCount} items)` : ''}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={saveZoteroDefaultCollection}
                              disabled={zoteroSavingDefault || zoteroSelectedCollectionKey === (zoteroDefaultCollectionKey ?? '')}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {zoteroSavingDefault ? 'Saving…' : 'Save'}
                            </button>
                            {zoteroDefaultCollectionKey !== null && zoteroDefaultCollectionKey !== '' && zoteroSelectedCollectionKey === (zoteroDefaultCollectionKey ?? '') && (
                              <p className="text-xs text-green-600">
                                {projectId ? 'Library saved for this project.' : 'Saved. This selection will be used for referencing.'}
                              </p>
                            )}
                            {zoteroDefaultCollectionKey === null && zoteroSelectedCollectionKey === '' && (
                              <p className="text-xs text-green-600">
                                {projectId ? 'My Library is saved for this project.' : 'My Library is saved as default.'}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={unlinkZotero}
                        disabled={zoteroUnlinking}
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {zoteroUnlinking ? 'Unlinking…' : 'Unlink Zotero'}
                      </button>
                      {zoteroError && (
                        <p className="text-sm text-red-600">{zoteroError}</p>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(modalContent, document.body);
}
