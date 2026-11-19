/**
 * Centralized project path normalization and validation.
 * Use for all file paths within a project (no directory traversal, relative only).
 */

import path from 'path';

/**
 * Normalize and validate a project-relative file path.
 * Rejects empty, directory traversal (..), and absolute paths.
 * @param {string} input - Raw path from client or body
 * @returns {string|null} Normalized relative path (forward slashes, no leading/trailing slashes) or null if invalid
 */
export function normalizeProjectPath(input) {
  if (input == null || typeof input !== 'string') return null;
  const trimmed = input.trim();
  const normalized = path.normalize(trimmed).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '').trim();
  if (normalized === '') return null;
  if (normalized.includes('..') || path.isAbsolute(trimmed)) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some(s => s === '..')) return null;
  return normalized;
}

/**
 * Resolve a stored research file path (may be legacy absolute or relative) to an absolute path.
 * @param {string} projectRoot - Absolute path to project directory
 * @param {string} storedPath - Value from research_files.file_path (absolute or relative)
 * @returns {string} Absolute path for comparison or storage APIs
 */
export function resolveResearchFilePath(projectRoot, storedPath) {
  if (storedPath == null || typeof storedPath !== 'string' || !storedPath.trim()) return path.join(projectRoot, '');
  const trimmed = storedPath.trim();
  if (path.isAbsolute(trimmed)) {
    return path.normalize(trimmed);
  }
  return path.resolve(projectRoot, trimmed);
}
