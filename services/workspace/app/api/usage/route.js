/**
 * Usage stats API - returns plan limits and current usage (session-based)
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { getUserUsageSummary } from '@/lib/user-subscription.js';
import { formatBytes } from '@/lib/storage-limits.js';

export async function GET() {
  try {
    const session = await getSessionFromRequest();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const usage = await getUserUsageSummary(session.id);
    if (!usage) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      usage: {
        isPro: usage.isPro,
        subscriptionExpiresAt: usage.subscriptionExpiresAt || null,
        projects: {
          used: usage.projectCount,
          max: usage.limits.maxProjects,
          remaining: usage.limits.maxProjects === -1 ? -1 : Math.max(0, usage.limits.maxProjects - usage.projectCount)
        },
        storage: {
          used: usage.storageUsed,
          usedFormatted: formatBytes(usage.storageUsed),
          max: usage.limits.maxTotalStorage,
          maxFormatted: formatBytes(usage.limits.maxTotalStorage),
          remaining: usage.storageRemaining,
          remainingFormatted: formatBytes(usage.storageRemaining)
        },
        paperCredits: {
          used: usage.paperCreditsUsed,
          max: usage.limits.paperCreditsPerMonth,
          remaining: usage.paperCreditsRemaining,
          resetDate: usage.paperCreditsResetDate,
          isLifetime: usage.isLifetimeCredits || false
        },
        chat: {
          used: usage.chatRequestsToday,
          max: usage.limits.chatRequestsPerDay,
          remaining: usage.chatRemaining,
          resetTime: usage.chatResetTime
        }
      }
    });
  } catch (error) {
    console.error('Usage API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve usage' },
      { status: 500 }
    );
  }
}
