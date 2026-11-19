// SPDX-License-Identifier: MIT

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { pool, getProject, getProjectsByUserId } from './db.js';
import { getProjectPath, ensureProjectDir, readFile, writeFile, fileExists } from './files.js';

const PROJECTS_FILE = path.join(process.cwd(), 'data', 'projects.json');
const DEFAULT_PROJECT_TYPE = 'document';
const DEFAULT_PROJECT_DIRS = ['sections', 'styles', 'assets', 'build', 'uploads'];

// Ensure data directory exists
async function ensureDataDir() {
  const dataDir = path.dirname(PROJECTS_FILE);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// Load projects from file
export async function loadProjects() {
  try {
    console.log('📁 Loading projects from:', PROJECTS_FILE);
    await ensureDataDir();
    
    try {
      const data = await fs.readFile(PROJECTS_FILE, 'utf8');
      
      // Try to parse JSON
      try {
        const projects = JSON.parse(data);
        console.log('📋 Loaded projects:', projects);
        return projects;
      } catch (parseError) {
        // JSON parsing failed - try to recover
        console.error('❌ JSON parse error:', parseError.message);
        const errorPosition = parseInt(parseError.message.match(/position (\d+)/)?.[1] || '0');
        console.error('   Position:', errorPosition);
        
        // Backup corrupted file first
        const backupPath = PROJECTS_FILE + '.corrupted.' + Date.now();
        await fs.writeFile(backupPath, data);
        console.log('💾 Backed up corrupted file to:', backupPath);
        
        // Strategy 1: Try to extract valid JSON up to the error position
        if (errorPosition > 0) {
          // Find the last complete object/array boundary before the error
          let bestEnd = errorPosition;
          
          // Look backwards from error position to find a valid closing brace/bracket
          for (let i = errorPosition - 1; i >= 0; i--) {
            const char = data[i];
            if (char === '}' || char === ']') {
              // Check if this might be the end of the root object
              const testData = data.substring(0, i + 1);
              try {
                const testProjects = JSON.parse(testData);
                // If it parses, check if it's a valid projects object structure
                if (typeof testProjects === 'object' && testProjects !== null && !Array.isArray(testProjects)) {
                  console.log('✅ Found valid JSON ending at position', i + 1);
                  await saveProjects(testProjects);
                  return testProjects;
                }
              } catch (e) {
                // Not valid, continue searching
              }
            }
          }
        }
        
        // Strategy 2: Try to find the root object boundaries by counting braces
        let braceCount = 0;
        let bracketCount = 0;
        let inString = false;
        let escapeNext = false;
        let lastValidEnd = -1;
        
        for (let i = 0; i < data.length; i++) {
          const char = data[i];
          
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          
          if (char === '"' && !escapeNext) {
            inString = !inString;
            continue;
          }
          
          if (inString) continue;
          
          if (char === '{') braceCount++;
          if (char === '}') {
            braceCount--;
            if (braceCount === 0 && bracketCount === 0) {
              // Found end of root object
              lastValidEnd = i + 1;
            }
          }
          if (char === '[') bracketCount++;
          if (char === ']') bracketCount--;
        }
        
        if (lastValidEnd > 0) {
          try {
            const recoveredData = data.substring(0, lastValidEnd);
            const projects = JSON.parse(recoveredData);
            if (typeof projects === 'object' && projects !== null && !Array.isArray(projects)) {
              console.log('✅ Recovered projects using brace counting (ending at position', lastValidEnd, ')');
              await saveProjects(projects);
              return projects;
            }
          } catch (e) {
            console.error('❌ Brace counting recovery failed:', e.message);
          }
        }
        
        // Strategy 3: Try progressively shorter truncations
        for (let truncateAt = Math.min(errorPosition, data.length - 1); truncateAt > 100; truncateAt -= 10) {
          // Find the last closing brace before truncateAt
          for (let i = truncateAt; i >= truncateAt - 100 && i >= 0; i--) {
            if (data[i] === '}') {
              try {
                const testData = data.substring(0, i + 1);
                const testProjects = JSON.parse(testData);
                if (typeof testProjects === 'object' && testProjects !== null && !Array.isArray(testProjects)) {
                  console.log('✅ Recovered projects using progressive truncation (ending at position', i + 1, ')');
                  await saveProjects(testProjects);
                  return testProjects;
                }
              } catch (e) {
                // Continue trying
              }
            }
          }
        }
        
        // If all recovery strategies failed, return empty
        console.error('❌ All recovery strategies failed, returning empty projects');
        return {};
      }
    } catch (readError) {
      // File doesn't exist or can't be read
      if (readError.code === 'ENOENT') {
        console.log('📁 Projects file does not exist, creating new one');
        return {};
      }
      throw readError;
    }
  } catch (error) {
    console.error('❌ Error loading projects:', error.message);
    console.error('   Stack:', error.stack);
    return {};
  }
}

// Save projects to file
export async function saveProjects(projects) {
  try {
    console.log('💾 Saving projects to:', PROJECTS_FILE);
    await ensureDataDir();
    
    // Validate that projects is a valid object
    if (typeof projects !== 'object' || projects === null || Array.isArray(projects)) {
      throw new Error('Invalid projects data: must be an object');
    }
    
    // Stringify with error handling
    let jsonString;
    try {
      jsonString = JSON.stringify(projects, null, 2);
    } catch (stringifyError) {
      console.error('❌ Error stringifying projects:', stringifyError);
      throw new Error('Failed to serialize projects data: ' + stringifyError.message);
    }
    
    // Validate JSON by parsing it back
    try {
      JSON.parse(jsonString);
    } catch (validateError) {
      console.error('❌ Generated JSON is invalid:', validateError);
      throw new Error('Generated JSON is invalid: ' + validateError.message);
    }
    
    // Write atomically: write to temp file first, then rename
    const tempPath = PROJECTS_FILE + '.tmp';
    await fs.writeFile(tempPath, jsonString, 'utf8');
    await fs.rename(tempPath, PROJECTS_FILE);
    
    console.log('✅ Projects saved successfully');
  } catch (error) {
    console.error('❌ Error saving projects:', error.message);
    console.error('   Stack:', error.stack);
    throw error;
  }
}

// Get projects shared with a user (collaborator projects) from PostgreSQL
async function getSharedProjects(userId, userEmail) {
  try {
    // Find projects shared with this user by email or user_id
    const result = await pool.query(
      `SELECT
        p.id, p.name, p.created_at, p.user_id as owner_id,
        ps.permission, ps.shared_with_email,
        u.email as owner_email
       FROM project_shares ps
       JOIN projects p ON ps.project_id = p.id
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ps.shared_with_user_id = $1
          OR ps.shared_with_email = $2
       ORDER BY ps.created_at DESC`,
      [userId, userEmail || '']
    );

    // Format as project objects with isShared flag
    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      created_at: row.created_at,
      user_id: row.owner_id,
      owner_email: row.owner_email,
      isShared: true,
      permission: row.permission, // 'view' or 'edit'
      type: 'shared'
    }));
  } catch (error) {
    console.error('⚠️ Error fetching shared projects:', error.message);
    return [];
  }
}

// Map DB row to project shape expected by API (id, name, created_at, user_id, type, metadata)
function dbRowToProject(row) {
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    user_id: row.user_id,
    type: row.type || DEFAULT_PROJECT_TYPE,
    metadata: row.metadata || {},
    isOwner: true,
    isShared: false
  };
}

// Get projects for a user (owned from DB + shared/collaborator projects)
export async function getUserProjects(userId, userEmail = null) {
  console.log('👤 Getting projects for user:', userId);

  // Load owned projects from database
  let ownedRows = await getProjectsByUserId(userId);

  // One-time migration: if DB has no projects for this user, try syncing from JSON
  if (ownedRows.length === 0) {
    const projects = await loadProjects();
    if (projects[userId]?.length > 0) {
      console.log(`🔄 Migrating ${projects[userId].length} projects from JSON to DB for user ${userId}`);
      for (const p of projects[userId]) {
        await syncProjectToDatabase(p, userId);
      }
      ownedRows = await getProjectsByUserId(userId);
    }
  }

  const ownedProjects = ownedRows.map(row => dbRowToProject(row));

  // Get shared projects from PostgreSQL (collaborator projects)
  const sharedProjects = await getSharedProjects(userId, userEmail);

  // Combine owned + shared, avoiding duplicates
  const ownedIds = new Set(ownedProjects.map(p => p.id));
  const allProjects = [
    ...ownedProjects,
    ...sharedProjects.filter(p => !ownedIds.has(p.id))
  ];

  console.log(`📋 User projects: ${ownedProjects.length} owned, ${sharedProjects.length} shared`);
  return allProjects.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Sanitize project name for filesystem safety
function sanitizeProjectName(name) {
  if (!name || typeof name !== 'string') return '';
  
  // Replace filesystem-unsafe characters with underscore
  return name
    .replace(/[/\\:*?"<>|]/g, '_')  // Windows/Linux unsafe chars
    .replace(/[\x00-\x1F\x7F]/g, '_') // Control characters
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim();
}

// Generate project name from description or random value
function generateProjectName(description) {
  if (!description || typeof description !== 'string' || !description.trim()) {
    // Generate random project name
    const randomSuffix = Math.floor(1000 + Math.random() * 9000); // 4-digit number
    return `Project-${randomSuffix}`;
  }
  
  // Extract meaningful words from description
  const words = description.trim().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    return `Project-${randomSuffix}`;
  }
  
  // Take first 3-5 words, capitalize first letter of each
  const nameWords = words.slice(0, Math.min(5, words.length));
  return nameWords
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

async function ensureProjectScaffold(projectId) {
  for (const dirName of DEFAULT_PROJECT_DIRS) {
    const markerPath = `${dirName}/.gitkeep`;
    try {
      const exists = await fileExists(projectId, markerPath);
      if (!exists) {
        await writeFile(projectId, markerPath, '');
      }
    } catch (error) {
      console.warn(`⚠️ Failed to create scaffold marker ${markerPath}:`, error?.message || error);
    }
  }
}

function buildProjectManifest(project, metadata = {}) {
  const templateId = metadata?.documentTemplate || metadata?.template || 'default';
  return {
    id: project.id,
    name: project.name,
    template: templateId,
    createdAt: project.created_at,
    updatedAt: project.created_at,
    files: [
      { path: 'main.tex', type: 'latex' },
      { path: 'references.bib', type: 'bibtex' }
    ],
    tags: []
  };
}

// Sync a project to PostgreSQL database
async function syncProjectToDatabase(project, userId) {
  try {
    // First ensure user exists in database
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      // Create placeholder user if doesn't exist
      console.log(`📝 Creating placeholder user in DB: ${userId}`);
      await pool.query(
        `INSERT INTO users (id, email, password_hash, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userId, `user-${userId.substring(0, 8)}@placeholder.local`, 'placeholder']
      );
    }

    // Insert project into database
    await pool.query(
      `INSERT INTO projects (id, user_id, name, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [project.id, userId, project.name, project.created_at]
    );
    console.log(`✅ Project synced to PostgreSQL: ${project.id}`);
  } catch (error) {
    console.error(`⚠️ Failed to sync project to database (non-fatal):`, error.message);
  }
}

// Create a new project (DB is source of truth)
export async function createProject(userId, name, options = {}) {
  console.log('➕ Creating project for user:', userId, 'with name:', name, 'options:', options);

  // Ensure name exists, generate if needed
  let projectName = (name || '').trim();
  if (!projectName) {
    projectName = generateProjectName(options.metadata?.description || '');
    console.log(`📝 Generated project name: "${projectName}"`);
  }

  // Sanitize project name
  const sanitizedName = sanitizeProjectName(projectName);

  // Check for duplicate project names in DB and add suffix if needed
  const existingRows = await getProjectsByUserId(userId);
  const existingNames = existingRows.map(p => p.name.toLowerCase());
  let finalName = sanitizedName;
  let counter = 2;
  while (existingNames.includes(finalName.toLowerCase())) {
    finalName = `${sanitizedName}-${counter}`;
    counter++;
  }
  if (finalName !== sanitizedName) {
    console.log(`⚠️ Duplicate project name detected. Using: "${finalName}"`);
  }

  const projectId = crypto.randomUUID();
  const created_at = new Date().toISOString();
  let normalizedType = String(options.type || options.metadata?.type || DEFAULT_PROJECT_TYPE).toLowerCase();
  if (normalizedType === 'research' || normalizedType === 'review') {
    normalizedType = DEFAULT_PROJECT_TYPE;
  }
  const normalizedMetadata = options.metadata && typeof options.metadata === 'object' ? options.metadata : {};
  const project = {
    id: projectId,
    name: finalName,
    user_id: userId,
    created_at,
    type: normalizedType || DEFAULT_PROJECT_TYPE,
    metadata: normalizedMetadata
  };

  // Insert into PostgreSQL (source of truth)
  await pool.query(
    `INSERT INTO projects (id, user_id, name, created_at)
     VALUES ($1, $2, $3, $4)`,
    [projectId, userId, finalName, created_at]
  );
  console.log('📄 Project created in DB:', projectId);

  // Create project directory structure (storage layer: FS or MinIO)
  await ensureProjectDir(project.user_id ?? undefined, project.id);
  await ensureProjectScaffold(project.id);

  const projectMetadata = {
    id: project.id,
    name: project.name,
    type: project.type,
    metadata: project.metadata,
    createdAt: project.created_at,
    updatedAt: project.created_at,
    template: normalizedMetadata.documentTemplate || normalizedMetadata.template || 'default',
    editor: normalizedMetadata.editor || 'latex',
    aiGenerated: false
  };

  await writeFile(project.id, 'project_metadata.json', JSON.stringify(projectMetadata, null, 2));
  await writeFile(project.id, 'project.json', JSON.stringify(buildProjectManifest(project, normalizedMetadata), null, 2));

  const editor = normalizedMetadata.editor || 'latex';
  const fileName = editor === 'latex' ? 'main.tex' : 'main.md';
  const basicContent = getBasicContent(project.type, editor, project.name);
  await writeFile(project.id, fileName, basicContent);

  if (editor === 'latex') {
    const bibContent = `% Add BibTeX entries here as needed.
% Example:
% @misc{example,
%   title  = {Example source},
%   author = {Author, Name},
%   year   = {2026}
% }
`;
    await writeFile(project.id, 'references.bib', bibContent);
    console.log('📚 Created references.bib file');
  }

  return project;
}

// Get basic content based on project type and editor
function getBasicContent(projectType, editor, projectName) {
  if (editor === 'latex') {
    return getBasicLaTeXContent(projectType, projectName);
  } else {
    return getBasicMarkdownContent(projectType, projectName);
  }
}

/** Escape plain text for safe use inside LaTeX (\\title{}, \\textbf{}, etc.). */
function escapeForLaTeX(str) {
  if (str == null || typeof str !== 'string') return '';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    switch (c) {
      case '\\': out += '\\textbackslash{}'; break;
      case '{': out += '\\{'; break;
      case '}': out += '\\}'; break;
      case '&': out += '\\&'; break;
      case '%': out += '\\%'; break;
      case '$': out += '\\$'; break;
      case '#': out += '\\#'; break;
      case '_': out += '\\_'; break;
      case '~': out += '\\textasciitilde{}'; break;
      case '^': out += '\\^{}'; break;
      default: out += c;
    }
  }
  return out;
}

function getBasicLaTeXContent(projectType, projectName) {
  const normalizedType = String(projectType || DEFAULT_PROJECT_TYPE).toLowerCase();
  const safeName = escapeForLaTeX(projectName);

  switch (normalizedType) {
    case 'slides':
    case 'presentation':
      return `\\documentclass{beamer}
\\usetheme{Madrid}
\\title{${safeName}}
\\author{GenLaTeX}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\begin{frame}{Agenda}
  \\tableofcontents
\\end{frame}

\\section{Context}
\\begin{frame}{Context}
  \\begin{itemize}
    \\item Background
    \\item Goal
    \\item Scope
  \\end{itemize}
\\end{frame}

\\section{Main Points}
\\begin{frame}{Main Points}
  \\begin{itemize}
    \\item Point one
    \\item Point two
    \\item Point three
  \\end{itemize}
\\end{frame}

\\section{Conclusion}
\\begin{frame}{Conclusion}
  \\begin{itemize}
    \\item Summary
    \\item Recommendations
    \\item Next steps
  \\end{itemize}
\\end{frame}

\\end{document}`;

    case 'cv':
    case 'resume':
      return `\\documentclass[11pt,a4paper,sans]{moderncv}
\\moderncvstyle{classic}
\\moderncvcolor{blue}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[scale=0.85]{geometry}

\\name{${safeName}}{}
\\title{Curriculum Vitae}
\\email{your.email@example.com}
\\phone[mobile]{+1 (000) 000-0000}

\\begin{document}

\\makecvtitle

\\vspace{0.5cm}
\\section{Professional Summary}
Write a concise summary aligned with your target role.

\\section{Experience}
\\begin{itemize}
  \\item Role - Organization (Year--Year): measurable impact and responsibilities.
\\end{itemize}

\\section{Skills}
Technical skills, tools, and domain strengths.

\\section{Education}
Degree, Institution, Year.

\\end{document}`;

    case 'letter':
      return `\\documentclass[11pt]{letter}
\\usepackage[utf8]{inputenc}
\\signature{Your Name}
\\address{Your Address \\\\ City, Country}

\\begin{document}

\\begin{letter}{Recipient Name \\\\ Recipient Organization \\\\ Recipient Address}
\\opening{Dear Recipient Name,}

This letter addresses your requested topic and provides the key details in a professional tone.

\\closing{Sincerely,}

\\end{letter}
\\end{document}`;

    case 'invoice':
      return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{geometry}
\\usepackage{booktabs}
\\geometry{margin=1in}
\\setlength{\\parindent}{0pt}

\\begin{document}

\\textbf{Invoice} \\hfill Date: \\today

\\vspace{0.5cm}
\\textbf{From:} Your Company\\
\\textbf{To:} Client Name

\\vspace{0.5cm}
\\begin{tabular}{p{0.65\\linewidth}r}
\\toprule
Description & Amount \\\\
\\midrule
Service A & 0.00 \\\\
Service B & 0.00 \\\\
\\midrule
Total & 0.00 \\\\
\\bottomrule
\\end{tabular}

\\vspace{0.5cm}
Payment due within 30 days.

\\end{document}`;

    default:
      return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{geometry}
\\usepackage{hyperref}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\geometry{margin=1in}

\\title{${safeName}}
\\author{GenLaTeX}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Describe the objective, audience, and scope of this document.

\\section{Main Content}
Develop the core content, evidence, and structure requested by the user.

\\section{Conclusion}
Summarize key points and provide next steps.

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }
}

function getBasicMarkdownContent(projectType, projectName) {
  const normalizedType = String(projectType || DEFAULT_PROJECT_TYPE).toLowerCase();

  if (normalizedType === 'slides' || normalizedType === 'presentation') {
    return `# ${projectName}

## Slide 1 - Title

## Slide 2 - Context

## Slide 3 - Main Points

## Slide 4 - Conclusion`;
  }

  if (normalizedType === 'cv' || normalizedType === 'resume') {
    return `# ${projectName}

## Professional Summary

## Experience

## Skills

## Education`;
  }

  if (normalizedType === 'letter') {
    return `# Letter

Dear Recipient,

Write your letter body here.

Sincerely,

Your Name`;
  }

  if (normalizedType === 'invoice') {
    return `# Invoice

## From

## To

## Line Items

## Total

## Payment Terms`;
  }

  return `# ${projectName}

## Introduction

## Main Content

## Conclusion`;
}


/**
 * Ensure project_metadata.json exists; create with default from DB if missing.
 * Use before reading metadata when storage may not have it (e.g. MinIO sync, legacy projects).
 */
export async function ensureProjectMetadata(projectId) {
  const row = await getProject(projectId);
  if (!row) return;

  const metadataExists = await fileExists(projectId, 'project_metadata.json');
  const rowMetadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  if (!metadataExists) {
    const projectMetadata = {
      id: row.id,
      name: row.name,
      type: row.type || DEFAULT_PROJECT_TYPE,
      metadata: rowMetadata,
      createdAt: row.created_at,
      editor: 'latex',
      aiGenerated: !!rowMetadata.aiGeneration,
      aiGeneration: rowMetadata.aiGeneration || null
    };
    await writeFile(projectId, 'project_metadata.json', JSON.stringify(projectMetadata, null, 2));
  }

  const manifestExists = await fileExists(projectId, 'project.json');
  if (!manifestExists) {
    const manifestSeed = {
      id: row.id,
      name: row.name,
      created_at: row.created_at
    };
    await writeFile(projectId, 'project.json', JSON.stringify(buildProjectManifest(manifestSeed, rowMetadata), null, 2));
  }

  await ensureProjectScaffold(projectId);
}

// Get a project by ID (from DB first, then JSON fallback)
export async function getProjectById(projectId) {
  const row = await getProject(projectId);
  if (row) {
    return { project: dbRowToProject(row), userId: row.user_id };
  }
  // Fallback: search in JSON (e.g. before migration)
  const projects = await loadProjects();
  for (const userId in projects) {
    const userProjects = projects[userId] || [];
    const project = userProjects.find(p => p.id === projectId);
    if (project) {
      return { project: { ...project, isOwner: true, isShared: false }, userId };
    }
  }
  return null;
}

// Delete a project (from DB; CASCADE removes project_shares, etc.)
export async function deleteProject(userId, projectId) {
  const result = await pool.query(
    `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
    [projectId, userId]
  );
  if (result.rowCount > 0) {
    console.log('🗑️ Project deleted from DB:', projectId);
  }
}

// Update a project's name (DB + project_metadata.json on disk)
export async function updateProjectName(userId, projectId, name) {
  const trimmedName = (name || '').trim();
  if (!trimmedName) {
    throw new Error('Project name cannot be empty');
  }

  const sanitizedName = sanitizeProjectName(trimmedName);
  const result = await pool.query(
    `UPDATE projects SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
    [sanitizedName, projectId, userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('Project not found');
  }

  try {
    const metadataContent = await readFile(projectId, 'project_metadata.json', { encoding: 'utf-8' });
    const metadata = JSON.parse(metadataContent != null ? (Buffer.isBuffer(metadataContent) ? metadataContent.toString('utf-8') : metadataContent) : '{}');
    metadata.name = sanitizedName;
    await writeFile(projectId, 'project_metadata.json', JSON.stringify(metadata, null, 2));

    // Project name and document title (main.tex \title) are separate — do not modify main.tex
  } catch (error) {
    console.warn('⚠️ Failed to update project metadata name:', error?.message || error);
  }

  return dbRowToProject(row);
}
