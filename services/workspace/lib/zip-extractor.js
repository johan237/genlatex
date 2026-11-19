/**
 * ZIP file extraction utility with recursive support
 * - Preserves folder structure (no flattening)
 * - Unwraps single root folder to avoid project/ProjectName/ProjectName/ nesting
 * - Avoids duplicate files (same path from root and inside folder)
 */

import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs/promises';

const SUPPORTED_EXTENSIONS = [
  '.csv', '.xlsx', '.xls', '.json', '.xml', '.yaml', '.yml',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.cpp', '.c', '.go', '.rs',
  '.ipynb', '.pdf', '.md', '.txt', '.tex', '.bib', '.bibtex',
  '.png', '.jpg', '.jpeg', '.gif', '.svg'
];

/**
 * Find the common root folder if all files are under a single top-level directory.
 * e.g. ["MyProject/main.tex", "MyProject/figures/x.png"] -> "MyProject"
 * e.g. ["main.tex", "figures/x.png"] -> null (no single root)
 */
function getSingleRootFolder(entryNames) {
  if (entryNames.length === 0) return null;
  const parts = entryNames.map(name => {
    const normalized = name.replace(/\\/g, '/').replace(/\/+$/, '');
    return normalized.split('/');
  });
  const firstPart = parts[0][0];
  if (!firstPart) return null; // root-level file
  const allUnderSameRoot = parts.every(p => p[0] === firstPart);
  return allUnderSameRoot ? firstPart : null;
}

/**
 * Normalize entry path: strip leading slashes, use forward slashes
 */
function normalizeEntryPath(entryName) {
  return entryName.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Extract ZIP file recursively, supporting nested ZIPs.
 * Preserves folder structure and unwraps single root folder to avoid duplicates.
 * @param {string} zipPath - Path to the ZIP file
 * @param {string} extractToDir - Directory to extract files to
 * @param {number} depth - Current recursion depth
 * @param {string} relativePrefix - Prefix for nested zip paths (e.g. "folder/" when extracting folder/nested.zip)
 * @returns {Promise<Array>} - Array of extracted file information
 */
export async function extractZipRecursively(zipPath, extractToDir, depth = 0, relativePrefix = '') {
  if (depth > 5) {
    throw new Error('Maximum ZIP nesting depth (5) exceeded');
  }

  const extractedFiles = [];

  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    // Collect file entries (skip dirs, hidden, __MACOSX)
    const fileEntries = zipEntries.filter(entry => {
      if (entry.isDirectory) return false;
      const name = normalizeEntryPath(entry.entryName);
      if (name.startsWith('.') || name.includes('__MACOSX/')) return false;
      return true;
    });

    const entryNames = fileEntries.map(e => normalizeEntryPath(e.entryName));
    const rootFolder = getSingleRootFolder(entryNames);
    const stripPrefix = rootFolder ? `${rootFolder}/` : '';

    const extractToDirResolved = path.resolve(extractToDir);
    const writtenPaths = new Set();
    const writtenBasenames = new Map(); // basename -> relativePath (prefer path in folder over root)

    for (const entry of fileEntries) {
      const entryName = normalizeEntryPath(entry.entryName);
      const fileName = path.basename(entryName);
      const fileExt = path.extname(fileName).toLowerCase();

      // Check if this is a nested ZIP
      if (fileExt === '.zip') {
        const nestedZipPath = path.join(extractToDir, `temp_${Date.now()}_${depth}_${fileName}`);
        await fs.writeFile(nestedZipPath, entry.getData());

        const parentPath = path.dirname(entryName);
        const nestedPrefix = stripPrefix ? parentPath.replace(stripPrefix, '') : parentPath;
        const nestedRelativePrefix = nestedPrefix && nestedPrefix !== '.' ? `${nestedPrefix}/` : '';

        const nestedFiles = await extractZipRecursively(nestedZipPath, extractToDir, depth + 1, nestedRelativePrefix);
        extractedFiles.push(...nestedFiles);

        await fs.unlink(nestedZipPath).catch(() => {});
        continue;
      }

      if (!SUPPORTED_EXTENSIONS.includes(fileExt)) {
        continue;
      }

      // Compute relative path: strip single root folder, apply prefix for nested zips
      let relativePath = stripPrefix ? entryName.replace(stripPrefix, '') : entryName;
      relativePath = relativePrefix ? path.join(relativePrefix, relativePath).replace(/\\/g, '/') : relativePath;

      const targetPath = path.resolve(extractToDir, relativePath);

      if (!targetPath.startsWith(extractToDirResolved + path.sep) && targetPath !== extractToDirResolved) {
        console.warn(`Skipping file with invalid path: ${entry.entryName}`);
        continue;
      }

      const basename = path.basename(relativePath);
      const inFolder = path.dirname(relativePath) !== '.';
      const existing = writtenBasenames.get(basename);
      if (existing) {
        const existingInFolder = path.dirname(existing) !== '.';
        if (inFolder && !existingInFolder) {
          const existingTarget = path.resolve(extractToDir, existing);
          try {
            await fs.unlink(existingTarget);
          } catch (err) {
            console.warn('[zip-extractor] Failed to unlink existing file:', existing, err?.message);
          }
          writtenPaths.delete(existing);
          writtenBasenames.delete(basename);
          extractedFiles.splice(extractedFiles.findIndex(f => f.relativePath === existing), 1);
        } else if (!inFolder && existingInFolder) {
          continue;
        } else if (writtenPaths.has(relativePath)) {
          continue;
        }
      }
      if (writtenPaths.has(relativePath)) continue;
      writtenPaths.add(relativePath);
      writtenBasenames.set(basename, relativePath);

      const fileDir = path.dirname(targetPath);
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(targetPath, entry.getData());

      extractedFiles.push({
        originalName: entry.entryName,
        fileName: path.dirname(relativePath) !== '.' ? relativePath : path.basename(relativePath),
        filePath: targetPath,
        relativePath,
        fileSize: entry.header.size,
        fileType: fileExt.slice(1)
      });
    }

    return extractedFiles;
  } catch (error) {
    throw new Error(`ZIP extraction failed: ${error.message}`);
  }
}

/**
 * Check if a file is a ZIP file
 */
export function isZipFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.zip';
}
