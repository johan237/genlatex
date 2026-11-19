// SPDX-License-Identifier: MIT

import path from 'path';
import * as storage from './storage/index.js';

// Ensure absolute path - relative paths fail when PM2 runs from different directory
const basePath = path.resolve(process.env.PROJECT_PATH || './data/projects');

export function getUserPath(userId) {
  return basePath;
}

export function getProjectPath(userId, projectId) {
  return storage.getProjectPath(userId, projectId);
}

export function ensureProjectDir(userId, projectId) {
  return storage.ensureProjectDir(userId, projectId);
}

export function readTextFile(userId, projectId, filename) {
  return storage.readTextFile(userId, projectId, filename);
}

export function writeTextFile(userId, projectId, filename, content) {
  return storage.writeTextFile(userId, projectId, filename, content);
}

/** Read file content (async). Returns Buffer or string if options.encoding set. */
export async function readFile(projectId, relativePath, options = {}) {
  return storage.readFile(projectId, relativePath, options);
}

/** Write file content (async). */
export async function writeFile(projectId, relativePath, content) {
  return storage.writeFile(projectId, relativePath, content);
}

/** Check if file exists (async). */
export async function fileExists(projectId, relativePath) {
  return storage.fileExists(projectId, relativePath);
}

/** List entries in project (optionally under subdir). Returns [{ name, isDirectory }]. */
export async function listDir(projectId, subdir = '') {
  return storage.listDir(projectId, subdir);
}

export async function deleteProjectFiles(userId, projectId) {
  return storage.deleteProjectFiles(userId, projectId);
}

/**
 * Atomic write by full file path (for backward compatibility).
 * When MinIO and path is under PROJECT_PATH/projectId, writes to MinIO by projectId/relativePath.
 * Otherwise uses storage atomicWriteFileByPath (FS atomic rename, or MinIO putObject).
 */
export async function atomicWriteFile(filePath, content, encoding = 'utf8') {
  const resolvedBase = path.resolve(process.cwd(), basePath);
  const normalizedPath = path.normalize(path.resolve(filePath));
  if (normalizedPath.startsWith(resolvedBase + path.sep)) {
    const relativeToBase = path.relative(resolvedBase, normalizedPath);
    const parts = relativeToBase.split(path.sep).filter(Boolean);
    if (parts.length >= 1) {
      const projectId = parts[0];
      const relativePath = parts.slice(1).join(path.sep);
      if (storage.isMinio()) {
        await storage.writeFile(projectId, relativePath, Buffer.from(content, encoding));
        return;
      }
    }
  }
  await storage.atomicWriteFileByPath(filePath, content, encoding);
}

/** Sync project from MinIO to local (for compile/agent). No-op when using FS. */
export async function syncProjectToLocal(projectId) {
  return storage.syncProjectToLocal(projectId);
}

/** Sync project from local to MinIO (after compile/agent). No-op when using FS. */
export async function syncProjectFromLocal(projectId) {
  return storage.syncProjectFromLocal(projectId);
}

/** Delete a single file within a project. */
export async function deleteFile(projectId, relativePath) {
  return storage.deleteFile(projectId, relativePath);
}

/** Delete a folder and all contents within a project (MinIO: removes all objects under prefix). */
export async function deleteFolder(projectId, relativeDirPath) {
  return storage.deleteFolder(projectId, relativeDirPath);
}

/** Rename/move a file within a project. */
export async function renameFile(projectId, oldPath, newPath) {
  return storage.renameFile(projectId, oldPath, newPath);
}

/** Copy a file within a project. */
export async function copyFile(projectId, srcPath, destPath) {
  return storage.copyFile(projectId, srcPath, destPath);
}

/** Delete a file by its absolute path (works with both FS and MinIO). */
export async function deleteFileByPath(filePath) {
  return storage.deleteFileByPath(filePath);
}

export function isMinio() {
  return storage.isMinio();
}
