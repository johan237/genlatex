/**
 * GenLaTeX – File system storage implementation
 * Uses PROJECT_PATH for project directories.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

// Ensure absolute path - relative paths fail when PM2 runs from different directory
const basePath = path.resolve(process.env.PROJECT_PATH || './data/projects');

function isValidProjectId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (id.includes('..') || id.includes('/') || id.includes('\\')) return false;
  return true;
}

function resolveProjectDir(projectId) {
  if (!isValidProjectId(projectId)) {
    throw new Error('Invalid project id');
  }
  return path.join(basePath, projectId);
}

function resolvePath(projectId, relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(resolveProjectDir(projectId), normalized);
}

export function getProjectPath(userId, projectId) {
  if (!isValidProjectId(projectId)) {
    throw new Error('Invalid project id');
  }
  return path.join(basePath, projectId);
}

export async function ensureProjectDir(userId, projectId) {
  const dir = resolveProjectDir(projectId);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

export function readTextFile(userId, projectId, filename) {
  const filePath = resolvePath(projectId, filename);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

export async function writeTextFile(userId, projectId, filename, content) {
  const dir = await ensureProjectDir(userId, projectId);
  const filePath = path.join(dir, filename);
  await fsPromises.writeFile(filePath, content, 'utf8');
  return filePath;
}

export async function readFile(projectId, relativePath, options = {}) {
  const filePath = resolvePath(projectId, relativePath);
  try {
    const encoding = options.encoding;
    return encoding
      ? await fsPromises.readFile(filePath, encoding)
      : await fsPromises.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeFile(projectId, relativePath, content) {
  const filePath = resolvePath(projectId, relativePath);
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, typeof content === 'string' ? 'utf8' : undefined);
  await fsPromises.writeFile(filePath, data);
}

export async function fileExists(projectId, relativePath) {
  const filePath = resolvePath(projectId, relativePath);
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * List entries in a project (optionally under a subdir).
 * @returns {Promise<Array<{ name: string, isDirectory: boolean }>>}
 */
export async function listDir(projectId, subdir = '') {
  const dir = resolvePath(projectId, subdir);
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function deleteProjectFiles(userId, projectId) {
  const dir = resolveProjectDir(projectId);
  try {
    await fsPromises.rm(dir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Failed to delete project files at ${dir}:`, error);
      throw error;
    }
  }
}

export async function atomicWriteFileByPath(filePath, content, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  await fsPromises.mkdir(dir, { recursive: true });
  const tempName = `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`;
  const tempPath = path.join(dir, tempName);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxRetries = 5;
  try {
    await fsPromises.writeFile(tempPath, content, encoding);
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fsPromises.rename(tempPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (error && (error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EBUSY')) {
          await sleep(100 * Math.pow(2, attempt));
          await fsPromises.unlink(filePath).catch(() => {});
        } else {
          throw error;
        }
      }
    }
    console.warn(`⚠️ Atomic rename failed after ${maxRetries} retries, falling back to direct write:`, lastError?.message);
    await fsPromises.unlink(tempPath).catch(() => {});
    await fsPromises.writeFile(filePath, content, encoding);
  } catch (error) {
    await fsPromises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

/** No-op for FS; sync is only used with MinIO. */
export async function syncProjectToLocal(projectId) {
  return Promise.resolve();
}

/** No-op for FS. */
export async function syncProjectFromLocal(projectId) {
  return Promise.resolve();
}

/**
 * Delete a single file from the filesystem.
 * @param {string} projectId - Project ID
 * @param {string} relativePath - Relative path within the project
 */
export async function deleteFile(projectId, relativePath) {
  const filePath = resolvePath(projectId, relativePath);
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    // Ignore if file doesn't exist
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Delete a folder and all contents (FS: no-op for API parity; delete route uses fs.rm directly).
 * @param {string} projectId - Project ID
 * @param {string} relativeDirPath - Relative path of the folder within the project
 */
export async function deleteFolder(projectId, relativeDirPath) {
  const dirPath = resolvePath(projectId, relativeDirPath);
  try {
    await fsPromises.rm(dirPath, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Rename/move a file within a project.
 * @param {string} projectId - Project ID
 * @param {string} oldPath - Old relative path
 * @param {string} newPath - New relative path
 */
export async function renameFile(projectId, oldPath, newPath) {
  const oldFilePath = resolvePath(projectId, oldPath);
  const newFilePath = resolvePath(projectId, newPath);

  // Ensure destination directory exists
  const destDir = path.dirname(newFilePath);
  await fsPromises.mkdir(destDir, { recursive: true });

  await fsPromises.rename(oldFilePath, newFilePath);
}

/**
 * Copy a file within a project.
 * @param {string} projectId - Project ID
 * @param {string} srcPath - Source relative path
 * @param {string} destPath - Destination relative path
 */
export async function copyFile(projectId, srcPath, destPath) {
  const srcFilePath = resolvePath(projectId, srcPath);
  const destFilePath = resolvePath(projectId, destPath);

  // Ensure destination directory exists
  const destDir = path.dirname(destFilePath);
  await fsPromises.mkdir(destDir, { recursive: true });

  await fsPromises.copyFile(srcFilePath, destFilePath);
}

/**
 * Delete a file by its absolute path.
 * @param {string} filePath - Absolute file path
 */
export async function deleteFileByPath(filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    // Ignore if file doesn't exist
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }
}

export function isMinio() {
  return false;
}

/**
 * Get total storage size used by a project (all files recursively).
 * @param {string} projectId - Project ID
 * @returns {Promise<number>} Total bytes used
 */
export async function getProjectStorageSize(projectId) {
  const dir = resolveProjectDir(projectId);
  let total = 0;
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await getDirSizeRecursive(fullPath);
      } else {
        const stat = await fsPromises.stat(fullPath);
        total += stat.size;
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  return total;
}

async function getDirSizeRecursive(dirPath) {
  let total = 0;
  const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += await getDirSizeRecursive(fullPath);
    } else {
      const stat = await fsPromises.stat(fullPath);
      total += stat.size;
    }
  }
  return total;
}
