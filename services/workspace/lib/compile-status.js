/**
 * Shared compile-status logic: dependency mtimes and "PDF up to date" check.
 * Used by the compile API (skip when up to date) and the status endpoint.
 */

import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

export function resolveCompiledPdfPath(projectDir, target) {
  const pdfName = target.replace(/\.tex$/i, '.pdf');
  const buildPath = path.join(projectDir, 'build', pdfName);
  if (fs.existsSync(buildPath)) {
    return buildPath;
  }
  const rootPath = path.join(projectDir, pdfName);
  if (fs.existsSync(rootPath)) {
    return rootPath;
  }
  return buildPath;
}

/**
 * Find all files that the main tex file depends on (\input, \include, \bibliography, \addbibresource)
 * and return the most recent modification time among all of them.
 * @param {string} projectDir - Project directory path
 * @param {string} texContent - Content of the main tex file
 * @returns {Promise<Date>} Most recent modification time of any dependency
 */
export async function getLatestDependencyMtime(projectDir, texContent) {
  const dependencyFiles = new Set();

  // Find \input{...} and \include{...} files
  const inputMatches = texContent.matchAll(/\\(?:input|include)\{([^}]+)\}/g);
  for (const match of inputMatches) {
    let filename = match[1].trim();
    if (!filename.endsWith('.tex')) {
      filename += '.tex';
    }
    dependencyFiles.add(filename);
  }

  // Find \bibliography{...} files (can have multiple comma-separated)
  const bibMatches = texContent.matchAll(/\\bibliography\{([^}]+)\}/g);
  for (const match of bibMatches) {
    const files = match[1].split(',').map(f => f.trim());
    for (let filename of files) {
      if (!filename.endsWith('.bib')) {
        filename += '.bib';
      }
      dependencyFiles.add(filename);
    }
  }

  // Find \addbibresource{...} files (biblatex style)
  const addbibMatches = texContent.matchAll(/\\addbibresource\{([^}]+)\}/g);
  for (const match of addbibMatches) {
    let filename = match[1].trim();
    if (!filename.endsWith('.bib')) {
      filename += '.bib';
    }
    dependencyFiles.add(filename);
  }

  // Also scan for any .bib files in the project directory (in case they're implicitly used)
  try {
    const allFiles = await fsPromises.readdir(projectDir);
    for (const file of allFiles) {
      if (file.endsWith('.bib')) {
        dependencyFiles.add(file);
      }
    }
  } catch (err) {
    // Ignore errors reading directory
  }

  let latestMtime = new Date(0);
  for (const filename of dependencyFiles) {
    const filePath = path.join(projectDir, filename);
    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (stat.mtime > latestMtime) {
          latestMtime = stat.mtime;
        }
      }
    } catch (err) {
      // File might not exist or be inaccessible, skip it
    }
  }

  return latestMtime;
}

/**
 * Check whether the PDF exists and is up to date (newer than main .tex and all dependencies).
 * @param {string} projectDir - Project directory path
 * @param {string} target - Main .tex filename (e.g. 'main.tex')
 * @returns {Promise<{ pdfExists: boolean, upToDate: boolean }>}
 */
export async function getCompileStatus(projectDir, target) {
  const pdfPath = resolveCompiledPdfPath(projectDir, target);
  const texPath = path.join(projectDir, target);

  const pdfExists = fs.existsSync(pdfPath);
  if (!pdfExists || !fs.existsSync(texPath)) {
    return { pdfExists: !!pdfExists, upToDate: false };
  }

  const pdfStat = fs.statSync(pdfPath);
  const texStat = fs.statSync(texPath);
  const pdfMtime = pdfStat.mtime;

  let texContent = '';
  try {
    texContent = await fsPromises.readFile(texPath, 'utf-8');
  } catch (err) {
    return { pdfExists: true, upToDate: false };
  }

  const latestDependencyMtime = await getLatestDependencyMtime(projectDir, texContent);
  const mainFileNewer = texStat.mtime > pdfMtime;
  const dependencyNewer = latestDependencyMtime > pdfMtime;
  const upToDate = !mainFileNewer && !dependencyNewer;

  return { pdfExists: true, upToDate };
}
