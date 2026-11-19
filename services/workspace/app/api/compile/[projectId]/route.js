// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { requireProjectAccess } from '@/lib/project-auth.js';
import { getProjectPath, syncProjectToLocal, syncProjectFromLocal, isMinio } from '@/lib/files.js';
import { compileLaTeX } from '@/lib/compile.js';
import { getCompileStatus, resolveCompiledPdfPath } from '@/lib/compile-status.js';
import { parseCompilationErrors } from '@/lib/error-parser.js';
import { normalizeErrors } from '@/lib/error-normalizer.js';
import { correlateErrors, flattenErrorGroups } from '@/lib/error-correlator.js';

/**
 * Find similar image filenames when an image file is reported as not found.
 * Suggests corrections when the file exists with a similar name (e.g. typo: 417fd vs 417df).
 * @param {string} projectDir - Project directory path
 * @param {Array} errors - Array of error objects
 * @returns {Promise<Array>} Errors with added suggestions for image file-not-found cases
 */
async function enrichImageNotFoundErrors(projectDir, errors) {
  if (!errors || !Array.isArray(errors) || errors.length === 0) return errors;

  const imageExts = /\.(png|jpg|jpeg|gif|webp|pdf)$/i;
  const fileNotFoundRe = /File\s+[`'"]?([^`'"]+)[`'"]?\s*(?:not found|cannot find|unable to load)/i;

  for (const err of errors) {
    const msg = (err.message || err.rawMessage || '');
    const match = msg.match(fileNotFoundRe);
    if (!match) continue;

    const missingPath = match[1].trim();
    if (!imageExts.test(missingPath) || !missingPath.includes('images/')) continue;

    const missingName = path.basename(missingPath);
    const imagesDir = path.join(projectDir, 'images');

    try {
      const entries = await fsPromises.readdir(imagesDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile()).map(e => e.name);

      // Find similar filenames (same length, at most 2 chars different)
      const similar = files.filter(f => {
        if (f === missingName) return false;
        if (Math.abs(f.length - missingName.length) > 2) return false;
        let diff = 0;
        const len = Math.min(f.length, missingName.length);
        for (let i = 0; i < len && diff <= 2; i++) {
          if (f[i] !== missingName[i]) diff++;
        }
        diff += Math.abs(f.length - missingName.length);
        return diff <= 2;
      });

      if (similar.length > 0) {
        const suggestion = `Did you mean images/${similar[0]}? (Similar file exists in images/)`;
        err.suggestions = err.suggestions || [];
        if (!err.suggestions.includes(suggestion)) {
          err.suggestions.unshift(suggestion);
        }
      }
    } catch {
      // images/ dir doesn't exist or not readable - skip
    }
  }

  return errors;
}

/**
 * Compilation lock configuration
 * - LOCK_TIMEOUT_MS: Maximum time a lock can be held before considered stale
 * - LOCK_RETRY_DELAY_MS: Delay between retry attempts
 * - LOCK_MAX_RETRIES: Number of times to retry acquiring lock
 */
const LOCK_CONFIG = {
  LOCK_TIMEOUT_MS: 30 * 1000,      // 30 seconds - compilations rarely take longer
  LOCK_RETRY_DELAY_MS: 500,        // 500ms between retries
  LOCK_MAX_RETRIES: 3,             // Retry up to 3 times with delays
};

/**
 * Check if a lock file is stale (too old or from dead process)
 * @param {string} lockPath - Path to lock file
 * @returns {Promise<boolean>} True if lock is stale and should be removed
 */
async function isLockStale(lockPath) {
  try {
    const lockStat = await fsPromises.stat(lockPath);
    const lockAge = Date.now() - lockStat.mtimeMs;
    
    // Lock is stale if older than timeout
    if (lockAge > LOCK_CONFIG.LOCK_TIMEOUT_MS) {
      console.log(`🔓 Lock is stale (${Math.round(lockAge / 1000)}s old), removing`);
      return true;
    }
    
    // Try to read lock data to check if process is still alive
    try {
      const lockData = JSON.parse(await fsPromises.readFile(lockPath, 'utf-8'));
      
      // If lock has a PID, check if that process is still running
      // Note: This only works on the same machine, but that's our use case
      if (lockData.pid && typeof lockData.pid === 'number') {
        try {
          // process.kill with signal 0 checks if process exists without killing it
          process.kill(lockData.pid, 0);
          // Process exists, lock is valid
          return false;
        } catch (killError) {
          // Process doesn't exist (ESRCH) - lock is orphaned
          if (killError.code === 'ESRCH') {
            console.log(`🔓 Lock holder process (PID ${lockData.pid}) no longer exists, removing stale lock`);
            return true;
          }
          // EPERM means process exists but we can't signal it - lock is valid
        }
      }
    } catch (parseError) {
      // Can't read/parse lock file - consider it stale
      console.log('🔓 Lock file unreadable, removing');
      return true;
    }
    
    return false;
  } catch (statError) {
    // Can't stat file - it might have been deleted, consider stale
    return true;
  }
}

/**
 * Remove a stale lock file safely
 * @param {string} lockPath - Path to lock file
 */
async function removeStaLeLock(lockPath) {
  try {
    await fsPromises.unlink(lockPath);
    console.log('🔓 Stale lock removed');
  } catch (err) {
    // Ignore - file might already be gone
  }
}

/**
 * Acquire compilation lock for a project with automatic stale lock cleanup
 * Uses exclusive file creation to prevent race conditions
 * Automatically retries if lock appears to be from a dead process
 * 
 * @param {string} projectDir - Project directory path
 * @returns {Promise<{path: string, acquired: boolean, message?: string}>} Lock result
 */
async function acquireCompilationLock(projectDir) {
  const lockPath = path.join(projectDir, '.compile.lock');
  
  for (let attempt = 0; attempt <= LOCK_CONFIG.LOCK_MAX_RETRIES; attempt++) {
    try {
      // Check if lock exists
      if (fs.existsSync(lockPath)) {
        // Check if it's stale
        if (await isLockStale(lockPath)) {
          await removeStaLeLock(lockPath);
          // Continue to try acquiring
        } else {
          // Lock is fresh and valid
          if (attempt < LOCK_CONFIG.LOCK_MAX_RETRIES) {
            // Wait and retry - the other compilation might finish soon
            console.log(`⏳ Lock held by another process, waiting ${LOCK_CONFIG.LOCK_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${LOCK_CONFIG.LOCK_MAX_RETRIES + 1})`);
            await new Promise(resolve => setTimeout(resolve, LOCK_CONFIG.LOCK_RETRY_DELAY_MS));
            continue;
          }
          // Out of retries
          return { 
            path: lockPath, 
            acquired: false, 
            message: 'Another compilation is in progress. Please wait a moment and try again.'
          };
        }
      }

      // Try to create lock file atomically
      const lockData = JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        target: 'compilation'
      });
      
      try {
        const fd = await fsPromises.open(lockPath, 'wx');
        await fd.writeFile(lockData, 'utf-8');
        await fd.close();
        console.log('🔒 Compilation lock acquired');
        return { path: lockPath, acquired: true };
      } catch (openError) {
        if (openError.code === 'EEXIST') {
          // Race condition - another process created the lock between our check and create
          if (attempt < LOCK_CONFIG.LOCK_MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, LOCK_CONFIG.LOCK_RETRY_DELAY_MS));
            continue;
          }
          return { 
            path: lockPath, 
            acquired: false, 
            message: 'Another compilation started at the same time. Please try again.'
          };
        }
        throw openError;
      }
    } catch (error) {
      console.warn('⚠️ Lock acquisition error:', error.message);
      // On error, try to clean up and continue
      if (attempt < LOCK_CONFIG.LOCK_MAX_RETRIES) {
        await removeStaLeLock(lockPath);
        await new Promise(resolve => setTimeout(resolve, LOCK_CONFIG.LOCK_RETRY_DELAY_MS));
        continue;
      }
    }
  }
  
  // Fallback - couldn't acquire after all retries
  return { 
    path: lockPath, 
    acquired: false, 
    message: 'Could not start compilation. Please try again in a moment.'
  };
}

/**
 * Release compilation lock
 * @param {Object} lockResult - Lock result from acquireCompilationLock
 */
async function releaseCompilationLock(lockResult) {
  if (lockResult && lockResult.path && lockResult.acquired) {
    try {
      await fsPromises.unlink(lockResult.path);
      console.log('🔓 Compilation lock released');
    } catch (error) {
      // Ignore errors when releasing lock - file might already be gone
    }
  }
}

export async function POST(req, { params }) {
  const { projectId } = await params;
  const access = await requireProjectAccess(projectId, { requireEdit: true });
  if (access instanceof NextResponse) return access;

  const body = await req.json();
  const target = body.target || 'main.tex';

  console.log(`🔧 Compile request for project ${projectId}, target: ${target}`);

  let lockHandle = null;
  let dir; // Declare in outer scope for error handler

  try {
    // When using MinIO, sync project to local dir before compile (Option A: shared dir)
    if (isMinio()) {
      await syncProjectToLocal(projectId);
    }

    // Get project directory using file storage
    dir = path.resolve(process.cwd(), getProjectPath(access.userId, projectId));

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      return NextResponse.json({
        ok: false,
        log: `Project directory not found: ${dir}`,
        errors: [],
        target
      });
    }

    // Acquire compilation lock (with automatic retry and stale lock cleanup)
    lockHandle = await acquireCompilationLock(dir);
    if (!lockHandle.acquired) {
      // Could not acquire lock after retries
      const systemError = normalizeErrors([{
        type: 'warning',
        engine: 'system',
        message: lockHandle.message || 'Compilation busy',
        rawMessage: lockHandle.message || 'Another compilation is in progress. Please try again.',
        line: null,
        file: null,
        severity: 'warning'
      }], { projectDir: dir });
      
      return NextResponse.json({
        ok: false,
        log: lockHandle.message || 'Another compilation is in progress. Please try again.',
        errors: [],
        warnings: systemError,
        allIssues: systemError,
        target,
        pdfAvailable: fs.existsSync(resolveCompiledPdfPath(dir, target)),
        retryable: true  // Signal to frontend that this is a temporary issue
      });
    }

    // Check if PDF is already up to date (incremental compilation)
    const status = await getCompileStatus(dir, target);
    if (status.pdfExists && status.upToDate) {
      // PDF is up to date, return success without compiling
      await releaseCompilationLock(lockHandle);
      return NextResponse.json({
        ok: true,
        log: 'PDF is up to date, no compilation needed.',
        target,
        errors: [],
        warnings: [],
        allIssues: [],
        userMessage: '✅ PDF is up to date',
        pdfAvailable: true,
        stats: {
          errors: 0,
          warnings: 0,
          ignorable: 0
        }
      });
    }

    // Compile using pdflatex
    const { code, log, pdfPath: compiledPdfPath, blgContent, auxContent, missingBibProcessor } = await compileLaTeX(dir, target);
    const pdfExists = !!(compiledPdfPath && fs.existsSync(compiledPdfPath));
    const compileOk = code === 0 && pdfExists;

    // Find and read .bib files for error detection
    const bibFiles = [];
    try {
      const files = await fsPromises.readdir(dir);
      const bibFileNames = files.filter(f => f.endsWith('.bib'));
      
      for (const bibFileName of bibFileNames) {
        try {
          const bibPath = path.join(dir, bibFileName);
          const bibContent = await fsPromises.readFile(bibPath, 'utf-8');
          bibFiles.push({
            path: bibPath,
            content: bibContent
          });
        } catch (err) {
          console.warn(`⚠️ Could not read .bib file ${bibFileName}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('⚠️ Could not scan for .bib files:', err.message);
    }

    // Parse errors from pdflatex log, BibTeX log, and .bib files
    const parsedIssues = parseCompilationErrors(log, {
      engine: 'pdflatex',
      blgContent: blgContent,
      auxContent: auxContent,
      projectDir: dir,
      bibFiles: bibFiles
    });
    if (missingBibProcessor) {
      parsedIssues.push({
        type: 'warning',
        engine: 'system',
        message: `Bibliography processor not found (${missingBibProcessor}). Bibliography may be incomplete.`,
        rawMessage: `${missingBibProcessor} not found`,
        line: null,
        file: null,
        severity: 'warning'
      });
    }
    
    // Normalize errors to unified format
    const allIssues = normalizeErrors(parsedIssues, {
      projectDir: dir,
      logText: log
    });

    // Enrich image "file not found" errors with "did you mean" suggestions when similar file exists
    await enrichImageNotFoundErrors(dir, allIssues);
    
    // Correlate errors to group related ones
    const errorGroups = correlateErrors(allIssues);
    const correlatedIssues = flattenErrorGroups(errorGroups);
    
    // Separate critical errors from warnings (use correlated issues)
    const issuesToProcess = correlatedIssues.length > 0 ? correlatedIssues : allIssues;
    // An issue is a critical error if:
    // 1. It has type === 'error' (LaTeX errors), OR
    // 2. It has severity === 'error' AND is not marked as ignorable
    const criticalErrors = issuesToProcess.filter(issue => 
      (issue.type === 'error') || (issue.severity === 'error' && !issue.isIgnorable)
    );
    
    // An issue is a warning if:
    // 1. It has type === 'warning', OR
    // 2. It has severity === 'warning', OR
    // 3. It is marked as ignorable (cosmetic issues like overfull hbox)
    const warnings = issuesToProcess.filter(issue => 
      (issue.type === 'warning') || (issue.severity === 'warning') || (issue.isIgnorable === true)
    );
    
    // Create comprehensive error message with accurate counts
    const ok = compileOk && criticalErrors.length === 0;
    let userMessage = '';
    if (ok) {
      if (warnings.length > 0) {
        const ignorableCount = warnings.filter(w => w.isIgnorable === true).length;
        const importantWarnings = warnings.filter(w => !w.isIgnorable).length;
        
        userMessage = '✅ Compilation successful';
        if (importantWarnings > 0) {
          userMessage += ` with ${importantWarnings} warning(s)`;
        }
        if (ignorableCount > 0) {
          userMessage += ` (${ignorableCount} cosmetic warning${ignorableCount > 1 ? 's' : ''} hidden)`;
        }
      } else {
        userMessage = '✅ Compilation successful';
      }
    } else {
      if (criticalErrors.length > 0) {
        const errorPlural = criticalErrors.length > 1 ? 'errors' : 'error';
        userMessage = `❌ Compilation failed with ${criticalErrors.length} ${errorPlural}. Review the Compiler Log below and fix the highlighted issues before compiling again.`;
        if (warnings.length > 0) {
          const warningPlural = warnings.length > 1 ? 'warnings' : 'warning';
          userMessage += ` ${warnings.length} ${warningPlural} were also detected.`;
        }
      } else {
        userMessage = '❌ Compilation failed. No critical errors were parsed, but the Compiler Log below contains details you should review and address before compiling again.';
      }
    }

    // Log only critical failures to console
    if (!ok && criticalErrors.length > 0) {
      console.error(`❌ Compilation failed: ${criticalErrors.length} error(s)`);
    }

    // When using MinIO, push local output (e.g. PDF) back to MinIO
    if (isMinio() && dir) {
      await syncProjectFromLocal(projectId).catch((err) => console.warn('Sync from local to MinIO after compile:', err.message));
    }

    return NextResponse.json({
      ok,
      log,
      target,
      errors: criticalErrors, // Only send critical errors to UI
      warnings: warnings, // Send warnings separately
      allIssues: issuesToProcess, // Full list with correlation metadata
      errorGroups: errorGroups, // Include groups for UI display
      userMessage: userMessage,
      pdfAvailable: pdfExists,
      stats: {
        errors: criticalErrors.length,
        warnings: warnings.length,
        ignorable: warnings.filter(w => w.isIgnorable).length
      }
    });
  } catch (error) {
    console.error(`❌ Compilation error: ${error.message}`);
    const systemError = normalizeErrors([{
      type: 'error',
      engine: 'system',
      message: error.message,
      rawMessage: `Compilation failed: ${error.message}`,
      line: null,
      file: null,
      severity: 'error'
    }], { projectDir: dir });
    
    return NextResponse.json({
      ok: false,
      log: `Compilation failed: ${error.message}`,
      target,
      errors: systemError,
      warnings: [],
      allIssues: systemError,
      pdfAvailable: false
    });
  } finally {
    // Always release lock
    await releaseCompilationLock(lockHandle);
  }
}
