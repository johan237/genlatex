/**
 * GenLaTeX – Robust pdflatex LaTeX Compiler
 * SPDX-License-Identifier: MIT
 * 
 * Full bibliography support with pdflatex + BibTeX/Biber
 */

import fs from "fs/promises";
import path from "path";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const SUPPORT_SCAN_SKIP_DIRS = new Set([".git", "node_modules", "build", ".next", "uploads"]);
const SUPPORT_SCAN_MAX_FILES = 5000;

/**
 * Compile a LaTeX project using pdflatex with FULL bibliography support.
 */
export async function compileLaTeX(projectDir, texFilename = "main.tex") {
  projectDir = path.resolve(projectDir);
  const texPath = path.join(projectDir, texFilename);
  const baseName = texFilename.replace(/\.tex$/i, "");
  const buildDir = path.join(projectDir, "build");
  const pdfPath = path.join(buildDir, `${baseName}.pdf`);
  await fs.mkdir(buildDir, { recursive: true });

  try {
    await fs.access(texPath);
  } catch {
    throw new Error(`File not found: ${texPath}`);
  }

  const pdflatexPath = await findPdfLaTeX();
  if (!pdflatexPath) {
    throw new Error("pdflatex not found. Please install MiKTeX or TeX Live and add to PATH.");
  }

  // Detect bibliography system and files
  const texContent = await fs.readFile(texPath, "utf-8");
  await ensureReferencedStyleAndClassFiles(projectDir, texFilename, texContent);
  const bibInfo = await analyzeBibliography(projectDir, texContent);

  // Compile with proper multi-pass if bibliography is detected
  const result = bibInfo.hasBib 
    ? await runMultiPassCompilation(pdflatexPath, projectDir, texFilename, bibInfo, buildDir)
    : await runSinglePassCompilation(pdflatexPath, projectDir, texFilename, buildDir);

  let pdfExists = false;
  try {
    await fs.access(pdfPath);
    pdfExists = true;
  } catch {
    pdfExists = false;
  }

  return {
    pdfPath: pdfExists ? pdfPath : null,
    log: result.log,
    code: result.code ?? (pdfExists ? 0 : 1),
    blgContent: result.blgContent,
    auxContent: result.auxContent,
    missingBibProcessor: result.missingBibProcessor
  };
}

/**
 * Analyze bibliography setup in the LaTeX document
 */
async function analyzeBibliography(projectDir, texContent) {
  const result = {
    hasBib: false,
    system: "none",
    files: [],
    backend: null, // For biblatex: "biber" or "bibtex"
  };

  // Detect bibliography system
  // Check for biblatex (may span multiple lines)
  if (/\\usepackage.*?{biblatex}/s.test(texContent) || /\\usepackage\[[^\]]*biblatex[^\]]*\]/s.test(texContent)) {
    result.system = "biblatex";
    result.hasBib = true;
    
    // Detect backend (default is biber)
    // Match backend=biber or backend=bibtex, handling multi-line package options
    const backendMatch = texContent.match(/backend\s*=\s*(\w+)/i);
    if (backendMatch) {
      result.backend = backendMatch[1].toLowerCase();
    } else {
      result.backend = "biber"; // biblatex default
    }
  } else if (/\\bibliographystyle|\\bibliography{/.test(texContent)) {
    result.system = "bibtex";
    result.hasBib = true;
  } else if (/\\usepackage.*?{natbib}/.test(texContent)) {
    result.system = "natbib";
    result.hasBib = true;
  }

  // Find .bib files
  if (result.hasBib) {
    try {
      const allFiles = await fs.readdir(projectDir);
      result.files = allFiles.filter((f) => f.endsWith(".bib"));

      // Also check for explicit references in document
      const bibMatch = texContent.match(/\\(?:addbibresource|bibliography)\{([^}]+)\}/g);
      if (bibMatch) {
        bibMatch.forEach((match) => {
          const file = match.match(/\{([^}]+)\}/)[1];
          const bibFile = file.endsWith(".bib") ? file : `${file}.bib`;
          if (!result.files.includes(bibFile)) {
            result.files.push(bibFile);
          }
        });
      }
    } catch (err) {
      console.warn("⚠️  Could not scan for .bib files:", err.message);
    }
  }

  return result;
}

function parseSupportReferences(texContent) {
  const refs = {
    classFiles: [],
    styleFiles: [],
  };
  const addUnique = (target, value) => {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    if (!target.includes(normalized)) target.push(normalized);
  };

  for (const match of texContent.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    addUnique(refs.classFiles, match[1]);
  }
  for (const match of texContent.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    const raw = String(match[1] || "");
    for (const part of raw.split(",")) {
      addUnique(refs.styleFiles, part);
    }
  }
  return refs;
}

function normalizeSupportRef(refName, extension) {
  const raw = String(refName || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\/g, "/");
  if (!raw || raw.startsWith("http://") || raw.startsWith("https://")) {
    return null;
  }
  const normalized = raw.replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!normalized) return null;
  const ext = path.posix.extname(normalized);
  if (ext && ext.toLowerCase() !== extension.toLowerCase()) {
    return null;
  }
  if (!ext) {
    return `${normalized}${extension}`;
  }
  return normalized;
}

async function findSupportFileByBasename(projectDir, basenameTarget) {
  const stack = [projectDir];
  let scanned = 0;
  const target = String(basenameTarget || "").toLowerCase();
  if (!target) return null;

  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (scanned >= SUPPORT_SCAN_MAX_FILES) return null;
      scanned += 1;
      const absolute = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (SUPPORT_SCAN_SKIP_DIRS.has(entry.name)) continue;
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.toLowerCase() === target) {
        return absolute;
      }
    }
  }

  return null;
}

async function ensureReferencedStyleAndClassFiles(projectDir, texFilename, texContent) {
  const refs = parseSupportReferences(texContent);
  const texDir = path.posix.dirname(texFilename.replace(/\\/g, "/"));
  const touched = [];

  const processRef = async (rawRef, extension) => {
    const normalizedRef = normalizeSupportRef(rawRef, extension);
    if (!normalizedRef) return;

    // Ignore package/class names that are not project-relative paths.
    const hasPathHint = normalizedRef.includes("/") || normalizedRef.includes(".");
    if (!hasPathHint) return;

    const relativeFromProject = texDir && texDir !== "."
      ? path.posix.normalize(path.posix.join(texDir, normalizedRef))
      : path.posix.normalize(normalizedRef);
    if (!relativeFromProject || relativeFromProject.startsWith("..")) return;

    const expectedPath = path.join(projectDir, relativeFromProject);
    try {
      await fs.access(expectedPath);
      return;
    } catch {
      // continue
    }

    const candidate = await findSupportFileByBasename(projectDir, path.posix.basename(relativeFromProject));
    if (!candidate) return;

    const candidateResolved = path.resolve(candidate);
    const expectedResolved = path.resolve(expectedPath);
    if (candidateResolved === expectedResolved) return;

    await fs.mkdir(path.dirname(expectedPath), { recursive: true });
    await fs.copyFile(candidate, expectedPath);
    touched.push(relativeFromProject);
  };

  for (const classRef of refs.classFiles) {
    await processRef(classRef, ".cls");
  }
  for (const styleRef of refs.styleFiles) {
    await processRef(styleRef, ".sty");
  }

  if (touched.length > 0) {
    console.log(`ℹ️ Repaired missing style/class paths: ${touched.join(", ")}`);
  }
}


/**
 * Run single-pass compilation (no bibliography)
 */
async function runSinglePassCompilation(pdflatexPath, projectDir, texFilename, buildDir) {
  const baseName = texFilename.replace(/\.tex$/, "");
  const auxPath = path.join(buildDir, `${baseName}.aux`);
  
  const result = await runPdfLaTeXPass(pdflatexPath, projectDir, texFilename, buildDir);
  
  // Read .aux file if it exists (for error parsing)
  let auxContent = null;
  try {
    auxContent = await fs.readFile(auxPath, 'utf-8').catch(() => null);
  } catch {
    // .aux file might not exist
  }
  
  return {
    code: result.code,
    log: result.log,
    blgContent: undefined,
    auxContent: auxContent || undefined,
    missingBibProcessor: undefined
  };
}

/**
 * Run multi-pass compilation: pdflatex -> bibtex -> pdflatex -> pdflatex
 */
async function runMultiPassCompilation(pdflatexPath, projectDir, texFilename, bibInfo, buildDir) {
  const env = {
    ...process.env,
  };
  const pathSep = process.platform === "win32" ? ";" : ":";
  env.TEXINPUTS = "." + pathSep + projectDir + pathSep + (process.env.TEXINPUTS || "");
  env.BIBINPUTS = "." + pathSep + projectDir + pathSep + (process.env.BIBINPUTS || "");
  env.BSTINPUTS = "." + pathSep + projectDir + pathSep + (process.env.BSTINPUTS || "");

  let allOutput = "";
  const baseName = texFilename.replace(/\.tex$/, "");
  const auxPath = path.join(buildDir, `${baseName}.aux`);

  let missingBibProcessor = null;

  // Step 1: pdflatex (first pass - generates .aux file)
  const pass1 = await runPdfLaTeXPass(pdflatexPath, projectDir, texFilename, buildDir, env);
  allOutput += pass1.log + "\n";
  
  // Check if .aux file was created (indicates successful pass, even with warnings)
  try {
    await fs.access(auxPath);
  } catch {
    // No .aux file means real failure
    return { ...pass1, missingBibProcessor: missingBibProcessor || undefined };
  }

  // Step 2: bibtex (processes bibliography)
  const bibProcessor = await findBibliographyProcessor(bibInfo);
  if (!bibProcessor) {
    const processorName = bibInfo.system === "biblatex" && bibInfo.backend === "biber" 
      ? "biber" 
      : "bibtex";
    // Only log if bibliography is actually needed
    if (bibInfo.hasBib) {
      console.warn(`⚠️  ${processorName} not found - bibliography may be incomplete`);
      missingBibProcessor = processorName;
    }
  } else {
    const bibResult = await runBibliographyProcessor(
      bibProcessor.path,
      bibProcessor.name,
      projectDir,
      path.posix.join('build', baseName),
      buildDir,
      env
    );
    allOutput += bibResult.log + "\n";
  }

  // Step 3: pdflatex (second pass - includes bibliography)
  const pass3 = await runPdfLaTeXPass(pdflatexPath, projectDir, texFilename, buildDir, env);
  allOutput += pass3.log + "\n";
  
  // Check if PDF was created (indicates successful pass, even with warnings)
  const pdfPath = path.join(buildDir, `${baseName}.pdf`);
  try {
    await fs.access(pdfPath);
  } catch {
    // No PDF means real failure
    return { ...pass3, missingBibProcessor: missingBibProcessor || undefined };
  }

  // Step 4: pdflatex (third pass - resolves all references)
  const pass4 = await runPdfLaTeXPass(pdflatexPath, projectDir, texFilename, buildDir, env);
  allOutput += pass4.log + "\n";

  // Store BibTeX log and aux content for error parsing
  let blgContent = null;
  let auxContent = null;
  try {
    const blgPath = path.join(buildDir, `${baseName}.blg`);
    blgContent = await fs.readFile(blgPath, 'utf-8').catch(() => null);
  } catch {
    // .blg file might not exist
  }
  try {
    auxContent = await fs.readFile(auxPath, 'utf-8').catch(() => null);
  } catch {
    // .aux file might not exist
  }

  // Final check: PDF should still exist
  try {
    await fs.access(pdfPath);
    // Return success code (0) if PDF exists, regardless of exit code
    // Include BibTeX log and aux content for error parsing
    return { 
      code: 0, 
      log: allOutput,
      blgContent: blgContent || undefined,
      auxContent: auxContent || undefined,
      missingBibProcessor: missingBibProcessor || undefined
    };
  } catch {
    return { 
      code: pass4.code, 
      log: allOutput,
      blgContent: blgContent || undefined,
      auxContent: auxContent || undefined,
      missingBibProcessor: missingBibProcessor || undefined
    };
  }
}

// Timeout for pdflatex compilation (per pass) - prevents hanging on bad input
const PDFLATEX_TIMEOUT_MS = 120 * 1000; // 120 seconds per pass

/**
 * Run a single pdflatex compilation pass.
 */
function runPdfLaTeXPass(pdflatexPath, projectDir, texFilename, buildDir, env) {
  return new Promise((resolve) => {
    // Use provided env or set up environment with search paths for LaTeX files
    if (!env) {
      env = {
        ...process.env,
      };
      const pathSep = process.platform === "win32" ? ";" : ":";
      env.TEXINPUTS = "." + pathSep + projectDir + pathSep + (process.env.TEXINPUTS || "");
      env.BIBINPUTS = "." + pathSep + projectDir + pathSep + (process.env.BIBINPUTS || "");
      env.BSTINPUTS = "." + pathSep + projectDir + pathSep + (process.env.BSTINPUTS || "");
    }

    // Keep all compiler artifacts under build/ for clean project roots.
    const args = [
      "-interaction=nonstopmode",
      "-halt-on-error",
      `-output-directory=${path.relative(projectDir, buildDir) || 'build'}`,
      "-synctex=1",  // Enable SyncTeX for PDF-source synchronization
      texFilename,
    ];

    const proc = spawn(pdflatexPath, args, {
      cwd: projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let forceKillTimeoutId = null;

    // Set up timeout to kill pdflatex if it takes too long
    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.warn(`⚠️ pdflatex timed out after ${PDFLATEX_TIMEOUT_MS / 1000} seconds, killing process...`);

      // On Windows, kill() terminates the process; on Unix, SIGTERM allows graceful shutdown
      proc.kill('SIGTERM');

      // Force kill after 5 seconds if SIGTERM doesn't work (mainly for Unix)
      forceKillTimeoutId = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          // Process might already be dead
        }
      }, 5000);
    }, PDFLATEX_TIMEOUT_MS);

    proc.stdout.on("data", (d) => {
      const text = d.toString();
      output += text;
    });

    proc.stderr.on("data", (d) => {
      const text = d.toString();
      output += text;
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      const cleanLog = output
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");

      if (timedOut) {
        resolve({
          code: -1,
          log: cleanLog + `\n\n❌ Compilation timed out after ${PDFLATEX_TIMEOUT_MS / 1000} seconds. This may indicate an infinite loop in your LaTeX document.`
        });
      } else {
        resolve({ code, log: cleanLog });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      resolve({ code: 1, log: `Error running pdflatex: ${err.message}` });
    });
  });
}

// Timeout for bibliography processor (bibtex/biber)
const BIBTEX_TIMEOUT_MS = 60 * 1000; // 60 seconds - bibliography processing is usually fast

/**
 * Run bibliography processor (bibtex or biber).
 */
function runBibliographyProcessor(processorPath, processorName, projectDir, baseName, workingDir, env) {
  return new Promise((resolve) => {
    const args = [baseName];

    const proc = spawn(processorPath, args, {
      cwd: workingDir || projectDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let timedOut = false;
    let forceKillTimeoutId = null;

    // Set up timeout for bibliography processor
    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.warn(`⚠️ ${processorName} timed out after ${BIBTEX_TIMEOUT_MS / 1000} seconds, killing process...`);
      proc.kill('SIGTERM');
      forceKillTimeoutId = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch (e) {
          // Process might already be dead
        }
      }, 5000);
    }, BIBTEX_TIMEOUT_MS);

    proc.stdout.on("data", (d) => {
      output += d.toString();
    });

    proc.stderr.on("data", (d) => {
      output += d.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      const cleanLog = output
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");

      if (timedOut) {
        resolve({
          code: -1,
          log: cleanLog + `\n\n❌ ${processorName} timed out after ${BIBTEX_TIMEOUT_MS / 1000} seconds.`
        });
      } else {
        resolve({ code, log: cleanLog });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      resolve({
        code: 1,
        log: `Error running ${processorName}: ${err.message}`
      });
    });
  });
}

/**
 * Find bibliography processor (bibtex or biber) based on bibliography system.
 */
async function findBibliographyProcessor(bibInfo) {
  let processorName;
  
  if (bibInfo.system === "biblatex") {
    processorName = bibInfo.backend === "biber" ? "biber" : "bibtex";
  } else {
    processorName = "bibtex";
  }

  const candidates = getProcessorCandidates(processorName);
  const isWindows = process.platform === "win32";

  for (const cmd of candidates) {
    try {
      // For PATH-based commands on Windows, use exec (more reliable)
      // For specific paths, use spawn
      const isPathCommand = isWindows && (cmd === processorName || cmd === processorName + ".exe");
      
      if (isPathCommand) {
        // Use exec for PATH resolution on Windows
        await execAsync(`"${cmd}" --version`, { timeout: 5000 });
      } else {
        // Use spawn for specific file paths
        await new Promise((res, rej) => {
          const p = spawn(cmd, ["--version"], { 
            stdio: "ignore"
          });
          
          const timeout = setTimeout(() => {
            p.kill();
            rej(new Error("Timeout"));
          }, 5000);
          
          p.on("close", (c) => {
            clearTimeout(timeout);
            if (c === 0) {
              res();
            } else {
              rej(new Error(`Exit code ${c}`));
            }
          });
          p.on("error", (err) => {
            clearTimeout(timeout);
            rej(err);
          });
        });
      }
      return { path: cmd, name: processorName };
    } catch {
      continue;
    }
  }
  return null;
}


/**
 * Get candidate paths for bibliography processor.
 * Prioritizes PATH resolution first, then falls back to common installation paths.
 */
function getProcessorCandidates(processorName) {
  const isWindows = process.platform === "win32";
  const candidates = [];
  
  // First, try from PATH (this is what works when user runs it directly)
  // On Windows, try both with and without .exe extension
  if (isWindows) {
    candidates.push(processorName);           // Try without extension first (PATH resolution)
    candidates.push(processorName + ".exe"); // Try with extension as fallback
  } else {
    candidates.push(processorName);
  }

  // Then fall back to common installation paths
  if (isWindows) {
    // MiKTeX paths
    candidates.push(
      "C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\" + processorName + ".exe",
      "C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\" + processorName + ".exe",
      path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "MiKTeX", "miktex", "bin", "x64", processorName + ".exe"),
    );
    
    // TeX Live paths
    const texLiveYears = ["2025", "2024", "2023", "2022", "2021"];
    for (const year of texLiveYears) {
      candidates.push(
        `C:\\texlive\\${year}\\bin\\windows\\${processorName}.exe`,  // TeX Live 2025+ uses 'windows' directory
        `C:\\texlive\\${year}\\bin\\win32\\${processorName}.exe`,
        `C:\\texlive\\${year}\\bin\\win64\\${processorName}.exe`,
      );
    }
  } else {
    // Unix paths
    candidates.push(
      `/usr/bin/${processorName}`,
      `/usr/local/bin/${processorName}`,
      `/opt/homebrew/bin/${processorName}`,
    );
  }

  return candidates;
}

/**
 * Get pdflatex version
 */
async function getPdfLaTeXVersion(pdflatexPath) {
  return new Promise((resolve) => {
    const proc = spawn(pdflatexPath, ["--version"], { stdio: "pipe" });
    let output = "";
    proc.stdout.on("data", (d) => (output += d.toString()));
    proc.stderr.on("data", (d) => (output += d.toString()));
    proc.on("close", () => {
      // Try to extract version from output
      const match = output.match(/(?:pdfTeX|pdfLaTeX)\s+(\d+\.\d+\.\d+)/i) ||
                   output.match(/Version\s+(\d+\.\d+)/i) ||
                   output.match(/(\d+\.\d+\.\d+)/);
      resolve(match ? match[1] : "unknown");
    });
    proc.on("error", () => resolve("unknown"));
  });
}

/**
 * Find the pdflatex executable path across platforms.
 * On Windows, uses exec for PATH resolution (more reliable than spawn with shell).
 */
async function findPdfLaTeX() {
  const candidates = getPdfLaTeXCandidates();
  const isWindows = process.platform === "win32";

  for (const cmd of candidates) {
    try {
      // For PATH-based commands on Windows, use exec (more reliable)
      // For specific paths, use spawn
      const isPathCommand = isWindows && (cmd === "pdflatex" || cmd === "pdflatex.exe");
      
      if (isPathCommand) {
        // Use exec for PATH resolution on Windows
        await execAsync(`"${cmd}" --version`, { timeout: 5000 });
      } else {
        // Use spawn for specific file paths
        await new Promise((res, rej) => {
          const p = spawn(cmd, ["--version"], { 
            stdio: "ignore"
          });
          
          const timeout = setTimeout(() => {
            p.kill();
            rej(new Error("Timeout"));
          }, 5000);
          
          p.on("close", (c) => {
            clearTimeout(timeout);
            if (c === 0) {
              res();
            } else {
              rej(new Error(`Exit code ${c}`));
            }
          });
          p.on("error", (err) => {
            clearTimeout(timeout);
            rej(err);
          });
        });
      }
      return cmd;
    } catch {
      // Continue to next candidate
      continue;
    }
  }
  return null;
}

/**
 * Get candidate paths for pdflatex.
 * Prioritizes PATH resolution first, then falls back to common installation paths.
 */
function getPdfLaTeXCandidates() {
  const isWindows = process.platform === "win32";
  const candidates = [];
  
  // First, try pdflatex from PATH (this is what works when user runs it directly)
  // On Windows, try both with and without .exe extension
  if (isWindows) {
    candidates.push("pdflatex");      // Try without extension first (PATH resolution)
    candidates.push("pdflatex.exe");  // Try with extension as fallback
  } else {
    candidates.push("pdflatex");
  }

  // Then fall back to common installation paths
  if (isWindows) {
    // MiKTeX paths
    candidates.push(
      "C:\\Program Files\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe",
      "C:\\Program Files (x86)\\MiKTeX\\miktex\\bin\\pdflatex.exe",
      path.join(process.env.USERPROFILE || "", "AppData", "Local", "Programs", "MiKTeX", "miktex", "bin", "x64", "pdflatex.exe"),
    );
    
    // TeX Live paths
    const texLiveYears = ["2025", "2024", "2023", "2022", "2021"];
    for (const year of texLiveYears) {
      candidates.push(
        `C:\\texlive\\${year}\\bin\\windows\\pdflatex.exe`,  // TeX Live 2025+ uses 'windows' directory
        `C:\\texlive\\${year}\\bin\\win32\\pdflatex.exe`,
        `C:\\texlive\\${year}\\bin\\win64\\pdflatex.exe`,
      );
    }
  } else {
    // Unix paths
    candidates.push(
      "/usr/bin/pdflatex",
      "/usr/local/bin/pdflatex",
      "/opt/homebrew/bin/pdflatex",
    );
  }

  return candidates;
}
