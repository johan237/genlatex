/**
 * Storage limits configuration for research files
 */

import { getUser, getProject, getProjectsByUserId } from './db.js';
import * as storage from './storage/index.js';

export const STORAGE_LIMITS = {
  free: {
    maxFileSize: 20 * 1024 * 1024,        // 20MB per file
    maxProjectTotal: 60 * 1024 * 1024,    // 60MB per project
    maxTotalStorage: 180 * 1024 * 1024,   // 180MB total across all projects
    maxFiles: 20
  },
  pro: {
    maxFileSize: 100 * 1024 * 1024,       // 100MB per file
    maxProjectTotal: 2 * 1024 * 1024 * 1024,  // 2GB per project
    maxTotalStorage: 10 * 1024 * 1024 * 1024,  // 10GB total
    maxFiles: 500
  }
};

/**
 * Check if a file upload would exceed storage quotas
 * @param {string} userId - User ID
 * @param {string} projectId - Project ID
 * @param {number} newFileSize - Size of file to be uploaded
 * @returns {Promise<boolean>} - Returns true if within quota, throws error otherwise
 */
export async function checkStorageQuota(userId, projectId, newFileSize) {
  const user = await getUser(userId);
  const project = await getProject(projectId);

  if (!user) {
    throw new Error('User not found');
  }

  if (!project) {
    throw new Error('Project not found');
  }

  const limits = (user.is_pro || user.is_admin) ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;

  // Check file size
  if (newFileSize > limits.maxFileSize) {
    const maxSizeMB = limits.maxFileSize / (1024 * 1024);
    throw new Error(`File exceeds maximum size of ${maxSizeMB}MB`);
  }

  // Check project total (actual storage: LaTeX, images, research files, etc.)
  let currentSize = 0;
  try {
    currentSize = await storage.getProjectStorageSize(projectId);
  } catch {
    currentSize = project.research_files_size || 0;
  }
  if (currentSize + newFileSize > limits.maxProjectTotal) {
    const availableGB = (limits.maxProjectTotal - currentSize) / (1024 * 1024 * 1024);
    const limitGB = limits.maxProjectTotal / (1024 * 1024 * 1024);
    throw new Error(
      `Project storage limit exceeded. ${availableGB.toFixed(2)}GB available of ${limitGB}GB total.`
    );
  }

  // Check file count
  const currentCount = project.research_file_count || 0;
  if (currentCount >= limits.maxFiles) {
    throw new Error(`Project file limit exceeded. Maximum ${limits.maxFiles} files allowed.`);
  }

  // Check total storage across all user projects (actual file storage)
  const totalUsed = await getUserTotalStorageUsed(userId);
  if (totalUsed + newFileSize > limits.maxTotalStorage) {
    const remaining = limits.maxTotalStorage - totalUsed;
    throw new Error(
      `Total storage limit exceeded. You have ${formatBytes(remaining)} remaining of ${formatBytes(limits.maxTotalStorage)} total.`
    );
  }

  return true;
}

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Size in bytes
 * @returns {string} - Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Get storage stats for a project
 * @param {string} projectId - Project ID
 * @param {boolean} isPro - Whether user is pro
 * @returns {Promise<object>} - Storage statistics
 */
export async function getStorageStats(projectId, isPro) {
  const project = await getProject(projectId);
  const limits = isPro ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;

  let used = 0;
  try {
    used = await storage.getProjectStorageSize(projectId);
  } catch {
    used = project?.research_files_size || 0;
  }
  const fileCount = project?.research_file_count || 0;

  return {
    used,
    usedFormatted: formatBytes(used),
    total: limits.maxProjectTotal,
    totalFormatted: formatBytes(limits.maxProjectTotal),
    percentage: (used / limits.maxProjectTotal) * 100,
    fileCount,
    maxFiles: limits.maxFiles,
    remaining: limits.maxProjectTotal - used,
    remainingFormatted: formatBytes(limits.maxProjectTotal - used)
  };
}

/**
 * Get total storage used by a user across all projects (actual file storage: LaTeX, images, research files, etc.)
 * @param {string} userId - User ID
 * @returns {Promise<number>} - Total bytes used
 */
export async function getUserTotalStorageUsed(userId) {
  const projects = await getProjectsByUserId(userId);
  let total = 0;
  for (const p of projects) {
    try {
      total += await storage.getProjectStorageSize(p.id);
    } catch (err) {
      console.warn(`[storage] Failed to get size for project ${p.id}:`, err?.message);
    }
  }
  return total;
}

/**
 * Check if adding newFileSize would exceed total storage quota
 * @param {string} userId - User ID
 * @param {number} newFileSize - Size of file(s) to add in bytes
 * @returns {Promise<{ allowed: boolean, used: number, max: number, remaining: number }>}
 */
export async function checkTotalStorageQuota(userId, newFileSize) {
  const user = await getUser(userId);
  if (!user) throw new Error('User not found');
  const limits = (user.is_pro || user.is_admin) ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;
  const used = await getUserTotalStorageUsed(userId);
  const remaining = Math.max(0, limits.maxTotalStorage - used);
  const allowed = used + newFileSize <= limits.maxTotalStorage;
  return { allowed, used, max: limits.maxTotalStorage, remaining };
}

/**
 * Get comprehensive storage info for a user
 * @param {string} userId - User ID
 * @returns {Promise<object>} - Storage info
 */
export async function getStorageInfo(userId) {
  const user = await getUser(userId);
  if (!user) throw new Error('User not found');
  const limits = (user.is_pro || user.is_admin) ? STORAGE_LIMITS.pro : STORAGE_LIMITS.free;
  const used = await getUserTotalStorageUsed(userId);
  return {
    used,
    usedFormatted: formatBytes(used),
    max: limits.maxTotalStorage,
    maxFormatted: formatBytes(limits.maxTotalStorage),
    remaining: Math.max(0, limits.maxTotalStorage - used),
    remainingFormatted: formatBytes(Math.max(0, limits.maxTotalStorage - used)),
    percentage: limits.maxTotalStorage > 0 ? (used / limits.maxTotalStorage) * 100 : 0,
    maxFileSize: limits.maxFileSize,
    maxProjectTotal: limits.maxProjectTotal,
    maxFiles: limits.maxFiles
  };
}
