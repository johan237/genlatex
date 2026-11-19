/**
 * GenLaTeX – MinIO (S3-compatible) storage implementation
 * Object key layout: {projectId}/{relativePath}
 * 
 * Design principles:
 * - Singleton client with lazy initialization
 * - Automatic bucket creation on first use
 * - Path traversal protection via normalization
 * - Graceful error handling with specific error codes
 * - Stream-based operations for memory efficiency
 */

import * as Minio from 'minio';
import fsPromises from 'fs/promises';
import path from 'path';

// Configuration with validation
// Ensure absolute path - relative paths fail when PM2 runs from different directory
const basePath = path.resolve(process.env.PROJECT_PATH || './data/projects');
const bucket = process.env.MINIO_BUCKET || 'genlatex-projects';

// Singleton state
let _client = null;
let _bucketEnsured = false;
let _clientInitPromise = null;

// Connection retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

/**
 * Validate MinIO configuration
 * @throws {Error} if required configuration is missing
 */
function validateConfig() {
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;
  
  if (!accessKey || !secretKey) {
    throw new Error(
      '[MinIO] Configuration error: MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required when USE_MINIO=true'
    );
  }
}

/**
 * Get or create MinIO client (singleton with lazy initialization)
 * @returns {Minio.Client} MinIO client instance
 */
function getClient() {
  if (_client) return _client;
  
  validateConfig();
  
  const useSSL = process.env.MINIO_USE_SSL === 'true';
  const endpoint = process.env.MINIO_ENDPOINT || 'localhost';
  const port = parseInt(process.env.MINIO_PORT || '9000', 10);
  
  _client = new Minio.Client({
    endPoint: endpoint,
    port,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY,
    secretKey: process.env.MINIO_SECRET_KEY,
  });
  
  console.log(`[MinIO] Client initialized: ${useSSL ? 'https' : 'http'}://${endpoint}:${port}`);
  return _client;
}

/**
 * Ensure bucket exists with retry logic
 * Uses a promise lock to prevent concurrent bucket creation attempts
 */
async function ensureBucket() {
  if (_bucketEnsured) return;
  
  // Use promise lock to prevent race conditions
  if (_clientInitPromise) {
    await _clientInitPromise;
    return;
  }
  
  _clientInitPromise = (async () => {
    const client = getClient();
    let lastError = null;
    
    for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const exists = await client.bucketExists(bucket);
        if (!exists) {
          await client.makeBucket(bucket, 'us-east-1');
          console.log(`[MinIO] Bucket "${bucket}" created`);
        }
        _bucketEnsured = true;
        return;
      } catch (err) {
        lastError = err;
        // Don't retry on authentication errors
        if (err.code === 'AccessDenied' || err.code === 'InvalidAccessKeyId') {
          throw new Error(`[MinIO] Authentication failed: ${err.message}`);
        }
        
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
            RETRY_CONFIG.maxDelayMs
          );
          console.warn(`[MinIO] Bucket check failed (attempt ${attempt + 1}), retrying in ${delay}ms:`, err.message);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Log warning but don't fail - bucket might already exist
    console.warn('[MinIO] Could not ensure bucket after retries:', lastError?.message);
    _bucketEnsured = true; // Assume bucket exists to avoid repeated failures
  })();
  
  await _clientInitPromise;
  _clientInitPromise = null;
}

/**
 * Sanitize and construct object key from projectId and relativePath
 * Prevents path traversal attacks and normalizes paths
 *
 * IMPORTANT: MinIO/S3 rejects keys containing "." or ".." as path components.
 * We must filter these out completely, not just sanitize them.
 *
 * @param {string} projectId - Project identifier
 * @param {string} relativePath - Relative path within project
 * @returns {string} Sanitized object key
 * @throws {Error} if projectId is invalid
 */
function objectKey(projectId, relativePath) {
  // Validate projectId (should be alphanumeric with hyphens/underscores)
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('[MinIO] Invalid projectId: must be a non-empty string');
  }

  // Sanitize projectId - remove any path separators
  const sanitizedProjectId = projectId.replace(/[\/\\]/g, '');
  if (sanitizedProjectId !== projectId) {
    console.warn(`[MinIO] ProjectId contained path separators, sanitized: ${projectId} -> ${sanitizedProjectId}`);
  }

  // Handle empty or null relativePath - return just the projectId prefix
  if (!relativePath || relativePath.trim() === '') {
    return `${sanitizedProjectId}/`;
  }

  // Normalize and sanitize relative path
  // MinIO/S3 rejects keys containing "." or ".." as path components
  // 1. Convert backslashes to forward slashes first
  // 2. Split by / and filter out dangerous components
  // 3. Rejoin with forward slashes
  let normalized = String(relativePath)
    .replace(/\\/g, '/')           // Backslash to forward slash
    .replace(/\/+/g, '/');         // Collapse multiple slashes

  // Split and filter path components - remove ".", "..", and empty parts
  const parts = normalized.split('/').filter(part => {
    if (!part) return false;           // Empty parts
    if (part === '.') return false;    // Current directory reference
    if (part === '..') return false;   // Parent directory reference
    return true;
  });

  // Rejoin the safe parts
  normalized = parts.join('/');

  return normalized ? `${sanitizedProjectId}/${normalized}` : `${sanitizedProjectId}/`;
}

function resolveProjectDir(projectId) {
  return path.join(basePath, projectId);
}

export function getProjectPath(userId, projectId) {
  return path.join(basePath, projectId);
}

export async function ensureProjectDir(userId, projectId) {
  const dir = path.join(basePath, projectId);
  // Create local directory (needed for operations like ZIP extraction that use local FS)
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

export function readTextFile(userId, projectId, filename) {
  return readFile(projectId, filename, { encoding: 'utf8' }).then((buf) => (buf != null ? (Buffer.isBuffer(buf) ? buf.toString('utf8') : buf) : ''));
}

export async function writeTextFile(userId, projectId, filename, content) {
  await writeFile(projectId, filename, typeof content === 'string' ? content : String(content));
  return path.join(basePath, projectId, filename);
}

/**
 * Convert a readable stream to a Buffer with memory limit protection
 * @param {ReadableStream} stream - Input stream
 * @param {number} maxSize - Maximum allowed size in bytes (default 100MB)
 * @returns {Promise<Buffer>} Buffer containing stream data
 * @throws {Error} if stream exceeds maxSize
 */
function streamToBuffer(stream, maxSize = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    
    stream.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        stream.destroy();
        reject(new Error(`[MinIO] Stream exceeded maximum size of ${maxSize} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err) => {
      reject(new Error(`[MinIO] Stream error: ${err.message}`));
    });
  });
}

/**
 * Read file content from MinIO
 * @param {string} projectId - Project identifier
 * @param {string} relativePath - Relative path within project
 * @param {Object} options - Read options
 * @param {string} [options.encoding] - If specified, return string instead of Buffer
 * @returns {Promise<Buffer|string|null>} File content or null if not found
 */
export async function readFile(projectId, relativePath, options = {}) {
  await ensureBucket();
  const key = objectKey(projectId, relativePath);
  const client = getClient();
  
  try {
    const stream = await client.getObject(bucket, key);
    const buf = await streamToBuffer(stream);
    const encoding = options.encoding;
    return encoding ? buf.toString(encoding) : buf;
  } catch (err) {
    // Handle various "not found" error formats from MinIO
    if (isNotFoundError(err)) {
      return null;
    }
    // Log unexpected errors for debugging
    console.error(`[MinIO] readFile error for ${key}:`, err.message);
    throw err;
  }
}

/**
 * Check if error indicates object not found
 * @param {Error} err - Error to check
 * @returns {boolean} True if error indicates not found
 */
function isNotFoundError(err) {
  if (!err) return false;
  const code = err.code || '';
  const message = err.message || '';
  return (
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'ENOENT' ||
    message.includes('NoSuchKey') ||
    message.includes('not exist') ||
    message.includes('does not exist') ||
    message.includes('The specified key does not exist')
  );
}

/**
 * Write file content to MinIO (single source of truth).
 * @param {string} projectId - Project identifier
 * @param {string} relativePath - Relative path within project
 * @param {Buffer|string} content - File content to write
 * @throws {Error} if write fails
 */
export async function writeFile(projectId, relativePath, content) {
  await ensureBucket();
  const key = objectKey(projectId, relativePath);
  const client = getClient();
  
  // Convert content to Buffer if needed
  const data = Buffer.isBuffer(content) 
    ? content 
    : Buffer.from(content, typeof content === 'string' ? 'utf8' : undefined);
  
  // Validate content size (max 5GB for single PUT)
  const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
  if (data.length > maxSize) {
    throw new Error(`[MinIO] File too large: ${data.length} bytes exceeds maximum of ${maxSize} bytes`);
  }
  
  try {
    await client.putObject(bucket, key, data, data.length);
  } catch (err) {
    console.error(`[MinIO] writeFile error for ${key}:`, err.message);
    throw new Error(`[MinIO] Failed to write ${key}: ${err.message}`);
  }
}

/**
 * Check if file exists in MinIO
 * @param {string} projectId - Project identifier
 * @param {string} relativePath - Relative path within project
 * @returns {Promise<boolean>} True if file exists
 */
export async function fileExists(projectId, relativePath) {
  await ensureBucket();
  const key = objectKey(projectId, relativePath);
  const client = getClient();
  
  try {
    await client.statObject(bucket, key);
    return true;
  } catch (err) {
    // Only return false for "not found" errors, throw on other errors
    if (isNotFoundError(err)) {
      return false;
    }
    // Log and re-throw unexpected errors
    console.error(`[MinIO] fileExists error for ${key}:`, err.message);
    throw err;
  }
}

/**
 * Convert a stream of objects to an array with limit protection
 * @param {ReadableStream} stream - Input stream
 * @param {number} maxItems - Maximum number of items (default 10000)
 * @returns {Promise<Array>} Array of items from stream
 */
function streamToArray(stream, maxItems = 10000) {
  return new Promise((resolve, reject) => {
    const items = [];
    
    stream.on('data', (item) => {
      if (items.length >= maxItems) {
        console.warn(`[MinIO] streamToArray: reached limit of ${maxItems} items`);
        return;
      }
      items.push(item);
    });
    
    stream.on('end', () => resolve(items));
    stream.on('error', (err) => {
      reject(new Error(`[MinIO] Stream error: ${err.message}`));
    });
  });
}

/**
 * List entries under projectId/subdir. MinIO has no real dirs; we derive from key prefixes.
 * Uses recursive=true to get ALL objects (ensures uploaded files and nested folders appear).
 * Derives dirs from keys with '/', files from keys without nested '/'.
 * @returns {Promise<Array<{ name: string, isDirectory: boolean }>>}
 */
export async function listDir(projectId, subdir = '') {
  await ensureBucket();
  const prefix = objectKey(projectId, subdir);
  const client = getClient();
  const stream = client.listObjectsV2(bucket, prefix, true);
  const items = await streamToArray(stream);
  const seen = new Set();
  const dirs = new Set();
  for (const obj of items) {
    const key = obj.name || obj.prefix;
    if (!key || !key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length).replace(/^\/+/, '');
    if (!rest) continue;
    const first = rest.split('/')[0];
    if (!first) continue;
    if (rest.includes('/')) {
      dirs.add(first);
    } else {
      seen.add(first);
    }
  }
  const result = [];
  for (const name of dirs) {
    result.push({ name, isDirectory: true });
  }
  for (const name of seen) {
    if (!dirs.has(name)) result.push({ name, isDirectory: false });
  }
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export async function deleteProjectFiles(userId, projectId) {
  await ensureBucket();
  const prefix = `${projectId}/`;
  const client = getClient();
  const stream = client.listObjectsV2(bucket, prefix, true);
  const items = await streamToArray(stream);
  const keys = items.map((o) => o.name).filter(Boolean);
  if (keys.length === 0) return;
  await client.removeObjects(bucket, keys);
}

/**
 * Get total storage size used by a project (all objects under project prefix).
 * @param {string} projectId - Project ID
 * @returns {Promise<number>} Total bytes used
 */
export async function getProjectStorageSize(projectId) {
  await ensureBucket();
  const prefix = `${String(projectId || '').trim()}/`;
  if (!prefix || prefix === '/') return 0;
  const client = getClient();
  const stream = client.listObjectsV2(bucket, prefix, true);
  const items = await streamToArray(stream);
  return items.reduce((sum, obj) => sum + (Number(obj.size) || 0), 0);
}

export async function atomicWriteFileByPath(filePath, content, encoding = 'utf8') {
  const absBase = path.resolve(process.cwd(), basePath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(absBase + path.sep) && normalized !== absBase) {
    throw new Error('atomicWriteFileByPath: filePath must be under PROJECT_PATH');
  }
  const rel = path.relative(absBase, path.dirname(normalized));
  const projectId = rel.split(path.sep)[0];
  const relativePath = path.relative(path.join(absBase, projectId), path.join(path.dirname(normalized), path.basename(normalized))).replace(/\\/g, '/');
  await writeFile(projectId, relativePath, Buffer.from(content, encoding));
}

/**
 * Sync project from MinIO to local temp directory (for compile operations ONLY).
 * Downloads all objects with the project prefix to local filesystem.
 * 
 * NOTE: This should ONLY be used for operations that require local files (e.g., LaTeX compilation).
 * All other file operations should use readFile/writeFile directly with MinIO.
 * 
 * @param {string} projectId - Project identifier
 * @returns {Promise<{synced: number, errors: number}>} Sync statistics
 */
export async function syncProjectToLocal(projectId) {
  await ensureBucket();

  const projectKey = String(projectId || '').trim();
  if (!projectKey) {
    throw new Error('[MinIO] syncProjectToLocal requires a valid projectId');
  }

  const prefix = `${projectKey}/`;
  const client = getClient();
  const localDir = resolveProjectDir(projectKey);
  const normalizedBase = path.resolve(basePath);
  const normalizedLocal = path.resolve(localDir);
  if (
    normalizedLocal === normalizedBase ||
    !normalizedLocal.startsWith(normalizedBase + path.sep)
  ) {
    throw new Error('[MinIO] syncProjectToLocal path validation failed');
  }
  
  let synced = 0;
  let errors = 0;

  const SUPPORT_EXTS = new Set(['.sty', '.cls', '.bst', '.def', '.fd', '.cfg', '.bib']);

  function normalizeSupportFileContent(filePath, buffer) {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORT_EXTS.has(ext)) {
      return null;
    }
    const text = buffer.toString('utf-8');
    let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    if (!lines.length) {
      return normalized;
    }
    const blank = lines.reduce((count, line) => count + (line.trim() ? 0 : 1), 0);
    const nonBlank = lines.length - blank;
    if (nonBlank && blank >= nonBlank * 0.7) {
      const collapsed = [];
      let prevBlank = false;
      for (const line of lines) {
        const isBlank = !line.trim();
        if (isBlank && prevBlank) {
          continue;
        }
        collapsed.push(line);
        prevBlank = isBlank;
      }
      normalized = collapsed.join('\n');
    }
    if (normalized === text) {
      return null;
    }
    return normalized;
  }
  
  try {
    const stream = client.listObjectsV2(bucket, prefix, true);
    const items = await streamToArray(stream);
    
    // Clear local cache to keep MinIO as the source of truth
    try {
      await fsPromises.rm(localDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`[MinIO] Failed to clear local cache for ${projectId}:`, err.message);
    }

    // Create local directory
    await fsPromises.mkdir(localDir, { recursive: true });
    
    // Process items in batches for better performance
    const BATCH_SIZE = 10;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (obj) => {
        if (!obj.name || !obj.name.startsWith(prefix)) return;
        
        const relativePath = obj.name.slice(prefix.length).replace(/^\/+/, '');
        if (!relativePath) return;
        
        // Security: validate path doesn't escape local directory
        const localPath = path.join(localDir, relativePath.replace(/\//g, path.sep));
        const normalizedLocal = path.normalize(localPath);
        if (!normalizedLocal.startsWith(path.normalize(localDir))) {
          console.warn(`[MinIO] Skipping suspicious path: ${relativePath}`);
          errors++;
          return;
        }
        
        try {
          const dir = path.dirname(localPath);
          await fsPromises.mkdir(dir, { recursive: true });
          
          const dataStream = await client.getObject(bucket, obj.name);
          const buf = await streamToBuffer(dataStream);
          await fsPromises.writeFile(localPath, buf);
          const normalized = normalizeSupportFileContent(localPath, buf);
          if (normalized !== null) {
            await fsPromises.writeFile(localPath, normalized, 'utf-8');
          }
          synced++;
        } catch (err) {
          console.warn(`[MinIO] Failed to sync ${obj.name}:`, err.message);
          errors++;
        }
      }));
    }
    
    if (synced > 0 || errors > 0) {
      console.log(`[MinIO] syncProjectToLocal ${projectId}: ${synced} files synced, ${errors} errors`);
    }
  } catch (err) {
    console.error(`[MinIO] syncProjectToLocal failed for ${projectId}:`, err.message);
    throw err;
  }
  
  return { synced, errors };
}

/**
 * Sync project from local PROJECT_PATH/projectId to MinIO (after compile/agent).
 * Uploads all local files to MinIO with the project prefix.
 * @param {string} projectId - Project identifier
 * @returns {Promise<{synced: number, errors: number}>} Sync statistics
 */
export async function syncProjectFromLocal(projectId) {
  await ensureBucket();
  
  const localDir = resolveProjectDir(projectId);
  
  // Check if local directory exists
  try {
    await fsPromises.access(localDir);
  } catch {
    return { synced: 0, errors: 0 };
  }
  
  const client = getClient();
  const prefixLen = localDir.length + 1;
  
  let synced = 0;
  let errors = 0;
  
  // Collect all files first
  const filesToSync = [];
  
  async function collectFiles(dir) {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      
      for (const e of entries) {
        // Skip hidden files and common temp files
        if (e.name.startsWith('.') || e.name.endsWith('.tmp') || e.name.endsWith('.lock')) {
          continue;
        }
        
        const full = path.join(dir, e.name);
        
        if (e.isDirectory()) {
          await collectFiles(full);
        } else {
          const relativePath = full.slice(prefixLen).replace(/\\/g, '/');
          filesToSync.push({ full, relativePath });
        }
      }
    } catch (err) {
      console.warn(`[MinIO] Failed to read directory ${dir}:`, err.message);
      errors++;
    }
  }
  
  await collectFiles(localDir);
  
  // Upload files in batches
  const BATCH_SIZE = 10;
  for (let i = 0; i < filesToSync.length; i += BATCH_SIZE) {
    const batch = filesToSync.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async ({ full, relativePath }) => {
      try {
        const key = objectKey(projectId, relativePath);
        const buf = await fsPromises.readFile(full);
        await client.putObject(bucket, key, buf, buf.length);
        synced++;
      } catch (err) {
        console.warn(`[MinIO] Failed to upload ${relativePath}:`, err.message);
        errors++;
      }
    }));
  }
  
  if (synced > 0 || errors > 0) {
    console.log(`[MinIO] syncProjectFromLocal ${projectId}: ${synced} files synced, ${errors} errors`);
  }
  
  return { synced, errors };
}

/**
 * Delete a single file from MinIO.
 * @param {string} projectId - Project ID
 * @param {string} relativePath - Relative path within the project
 * @throws {Error} if deletion fails (except for not-found errors)
 */
export async function deleteFile(projectId, relativePath) {
  await ensureBucket();
  const key = objectKey(projectId, relativePath);
  const client = getClient();
  
  try {
    await client.removeObject(bucket, key);
  } catch (err) {
    // Ignore if file doesn't exist (idempotent delete)
    if (!isNotFoundError(err)) {
      console.error(`[MinIO] deleteFile error for ${key}:`, err.message);
      throw err;
    }
  }
}

/**
 * Delete a folder and all objects under it from MinIO (prefix-based).
 * @param {string} projectId - Project ID
 * @param {string} relativeDirPath - Relative path of the folder within the project
 */
export async function deleteFolder(projectId, relativeDirPath) {
  await ensureBucket();
  const prefix = objectKey(projectId, relativeDirPath);
  const prefixWithSlash = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const client = getClient();
  const stream = client.listObjectsV2(bucket, prefixWithSlash, true);
  const items = await streamToArray(stream);
  const keys = items.map((o) => o.name).filter(Boolean);
  if (keys.length === 0) return;
  await client.removeObjects(bucket, keys);
}

/**
 * Rename/move a file within a project in MinIO.
 * MinIO doesn't support atomic rename, so we copy then delete.
 * This operation is NOT atomic - if delete fails after copy, both files may exist.
 * @param {string} projectId - Project ID
 * @param {string} oldPath - Old relative path
 * @param {string} newPath - New relative path
 * @throws {Error} if copy or delete fails
 */
export async function renameFile(projectId, oldPath, newPath) {
  await ensureBucket();
  const oldKey = objectKey(projectId, oldPath);
  const newKey = objectKey(projectId, newPath);
  const client = getClient();

  try {
    // Copy to new location first
    await client.copyObject(bucket, newKey, `/${bucket}/${oldKey}`);
    
    // Delete old file
    try {
      await client.removeObject(bucket, oldKey);
    } catch (deleteErr) {
      // Log but don't fail - copy succeeded, user can manually clean up
      console.warn(`[MinIO] renameFile: copy succeeded but delete failed for ${oldKey}:`, deleteErr.message);
    }
  } catch (err) {
    console.error(`[MinIO] renameFile error from ${oldKey} to ${newKey}:`, err.message);
    throw new Error(`[MinIO] Failed to rename ${oldPath} to ${newPath}: ${err.message}`);
  }
}

/**
 * Copy a file within a project in MinIO.
 * @param {string} projectId - Project ID
 * @param {string} srcPath - Source relative path
 * @param {string} destPath - Destination relative path
 * @throws {Error} if copy fails
 */
export async function copyFile(projectId, srcPath, destPath) {
  await ensureBucket();
  const srcKey = objectKey(projectId, srcPath);
  const destKey = objectKey(projectId, destPath);
  const client = getClient();

  try {
    await client.copyObject(bucket, destKey, `/${bucket}/${srcKey}`);
  } catch (err) {
    console.error(`[MinIO] copyFile error from ${srcKey} to ${destKey}:`, err.message);
    throw new Error(`[MinIO] Failed to copy ${srcPath} to ${destPath}: ${err.message}`);
  }
}

/**
 * Delete a file by its absolute path (for backward compatibility).
 * Extracts projectId and relativePath from the path.
 * @param {string} filePath - Absolute file path
 */
export async function deleteFileByPath(filePath) {
  const absBase = path.resolve(process.cwd(), basePath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(absBase + path.sep) && normalized !== absBase) {
    console.warn('deleteFileByPath: filePath not under PROJECT_PATH, skipping MinIO delete');
    return;
  }

  const relativeToBase = path.relative(absBase, normalized);
  const parts = relativeToBase.split(path.sep).filter(Boolean);

  if (parts.length < 1) {
    console.warn('deleteFileByPath: could not extract projectId from path');
    return;
  }

  const projectId = parts[0];
  const relativePath = parts.slice(1).join('/');

  if (relativePath) {
    await deleteFile(projectId, relativePath);
  }
}

export function isMinio() {
  return true;
}
