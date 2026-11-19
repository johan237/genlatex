/**
 * LimitWarningModal – Shown when user hits a plan limit (chat, paper credits, storage, projects).
 * Offers upgrade CTA and dismiss. Shows renewal date when available.
 */

'use client';

import React from 'react';

/**
 * Format reset date for display
 * @param {string|null} resetDate - ISO date string
 * @returns {string} Formatted date or empty string
 */
function formatResetDate(resetDate) {
  if (!resetDate) return '';
  try {
    return new Date(resetDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return '';
  }
}

const LIMIT_MESSAGES = {
  chat: {
    title: 'Daily chat limit reached',
    body: 'You\'ve used all your chat messages for today. Upgrade to Pro for unlimited AI chat.',
    bodyWithReset: (resetDate) => `You've used all your chat messages for today. Your chat limit resets tomorrow at midnight. Upgrade to Pro for unlimited AI chat.`,
    cta: 'Upgrade to Pro'
  },
  paper: {
    title: 'No generation credits left',
    body: 'You have used all AI generation credits on your current plan. Upgrade to Pro for higher monthly limits.',
    bodyWithReset: (resetDate) => `You have used all AI generation credits. Credits renew on ${formatResetDate(resetDate)}.`,
    cta: 'Upgrade to Pro'
  },
  storage: {
    title: 'Storage limit reached',
    body: 'You\'ve reached your storage limit. Pro includes 10 GB total storage and larger per-project limits.',
    cta: 'Upgrade to Pro'
  },
  projects: {
    title: 'Project limit reached',
    body: 'Free plan allows up to 3 projects. Upgrade to Pro for unlimited projects.',
    cta: 'Upgrade to Pro'
  },
  zotero: {
    title: 'Zotero is a Pro feature',
    body: 'Connect your Zotero library for citations and references. Upgrade to Pro to unlock Zotero integration.',
    cta: 'Upgrade to Pro'
  }
};

export default function LimitWarningModal({ open, onClose, onUpgrade, limitType = 'chat', resetDate = null }) {
  if (!open) return null;

  const config = LIMIT_MESSAGES[limitType] || LIMIT_MESSAGES.chat;
  // Use body with reset date if available and the message type supports it
  const bodyText = resetDate && config.bodyWithReset
    ? config.bodyWithReset(resetDate)
    : config.body;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div
        className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700"
        role="dialog"
        aria-labelledby="limit-modal-title"
        aria-describedby="limit-modal-desc"
      >
        <h2 id="limit-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          {config.title}
        </h2>
        <p id="limit-modal-desc" className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          {bodyText}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              onUpgrade?.();
            }}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            {config.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
