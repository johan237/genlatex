/**
 * Subscription Status Component
 * Displays current subscription plan, usage metrics, and upgrade options
 */

'use client';

import React, { useState, useEffect } from 'react';
import { SUBSCRIPTION_PLANS, PRICING } from '@/lib/subscription-plans.js';

export default function SubscriptionStatus({ userId, onUpgrade }) {
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (userId) {
      loadSubscription();
      loadUsage();
    }
  }, [userId]);

  const loadSubscription = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/subscription?userId=${userId}`);
      const data = await response.json();

      if (data.success) {
        setSubscription(data.subscription);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('Failed to load subscription status');
    } finally {
      setLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      const res = await fetch('/api/usage');
      const data = await res.json();
      if (data.success && data.usage) setUsage(data.usage);
    } catch {
      // Non-blocking
    }
  };

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg border p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-3 bg-gray-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (!subscription) {
    return null;
  }

  const isPro = subscription.planId === 'pro';
  const isAtLimit = !subscription.canCreateProject;

  return (
    <div className={`rounded-lg border p-4 ${isPro ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200' : 'bg-white border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${isPro ? 'bg-blue-500' : 'bg-gray-400'}`}></div>
          <h3 className={`font-semibold ${isPro ? 'text-blue-900' : 'text-gray-900'}`}>
            {subscription.plan.name} Plan
          </h3>
          {isPro && (
            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
              Pro
            </span>
          )}
        </div>
        
        {!isPro && (
          <button
            onClick={handleUpgrade}
            className="bg-blue-600 text-white text-sm px-3 py-1 rounded-md hover:bg-blue-700 transition-colors"
          >
            Upgrade
          </button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Projects:</span>
          <span className={`font-medium ${isAtLimit ? 'text-red-600' : 'text-gray-900'}`}>
            {usage?.projects != null ? `${usage.projects.used} / ${usage.projects.max === -1 ? '∞' : usage.projects.max}` : `${subscription.projectCount} / ${subscription.limits.maxProjects === -1 ? 'Unlimited' : subscription.limits.maxProjects}`}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Storage:</span>
          <span className="text-gray-900">
            {usage?.storage ? `${usage.storage.usedFormatted} / ${usage.storage.maxFormatted}` : (subscription.limits.maxStorageGB === -1 ? 'Unlimited' : `${subscription.limits.maxStorageGB} GB`)}
          </span>
        </div>

        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Paper credits:</span>
          <span className="text-gray-900">
            {usage?.paperCredits != null 
              ? `${usage.paperCredits.used} / ${usage.paperCredits.max === -1 ? '∞' : usage.paperCredits.max}${usage.paperCredits.isLifetime ? ' (lifetime)' : ' per month'}` 
              : (subscription.limits.paperCreditsPerMonth === -1 ? 'Unlimited' : `${subscription.limits.paperCreditsPerMonth}${isPro ? '/month' : ' (lifetime)'}`)}
          </span>
        </div>

        {usage?.paperCredits?.resetDate && !usage?.paperCredits?.isLifetime && (
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">Credits renew:</span>
            <span className="text-gray-900">
              {new Date(usage.paperCredits.resetDate).toLocaleDateString()}
            </span>
          </div>
        )}

        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Chat today:</span>
          <span className="text-gray-900">
            {usage?.chat != null
              ? (usage.chat.max === -1 ? 'Unlimited' : `${usage.chat.used} / ${usage.chat.max}`)
              : (subscription.limits.chatRequestsPerDay === -1 ? 'Unlimited' : '—')}
          </span>
        </div>
      </div>

      {isAtLimit && !isPro && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-yellow-800 text-xs">
            You've reached your project limit. Upgrade to Pro for unlimited projects.
          </p>
        </div>
      )}

      {isPro && (usage?.subscriptionExpiresAt || subscription.expiresAt) && (
        <div className="mt-3 text-xs text-gray-500">
          Subscription renews: {new Date(usage?.subscriptionExpiresAt || subscription.expiresAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
