import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';

const TEXT_EXTENSIONS = new Set([
  '.tex', '.sty', '.cls', '.bib', '.bst', '.def', '.fd', '.cfg', '.txt', '.md'
]);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.eps', '.tif', '.tiff'
]);
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS]);
const MAX_ZIP_BYTES = Math.max(2_000_000, parseInt(process.env.TEMPLATE_FETCH_MAX_ZIP_BYTES || '25000000', 10));
const MAX_FILE_BYTES = Math.max(20_000, parseInt(process.env.TEMPLATE_FETCH_MAX_FILE_BYTES || '5000000', 10));
const MAX_TEMPLATE_FILES = Math.max(10, parseInt(process.env.TEMPLATE_FETCH_MAX_FILES || '140', 10));
const MAX_TEXT_PREVIEW = 180_000;

const TYPE_QUERIES = {
  slides: [
    'latex beamer presentation template',
    'beamer theme template',
    'latex slide deck template'
  ],
  report: [
    'latex technical report template',
    'latex report template',
    'professional latex report'
  ],
  business: [
    'latex business report template',
    'latex executive report template'
  ],
  technical: [
    'latex technical document template',
    'latex specification template'
  ],
  cv: [
    'latex cv template',
    'latex resume template'
  ],
  letter: [
    'latex letter template',
    'latex cover letter template'
  ],
  invoice: [
    'latex invoice template'
  ],
  proposal: [
    'latex proposal template',
    'latex project proposal template'
  ],
  article: [
    'latex article template',
    'latex paper template'
  ]
};

const DOCUMENT_TYPE_ALIASES = {
  presentation: 'slides',
  slide: 'slides',
  deck: 'slides',
  resume: 'cv'
};

function normalizeDocumentType(documentType) {
  const raw = String(documentType || '').trim().toLowerCase();
  if (!raw) return 'article';
  if (TYPE_QUERIES[raw]) return raw;
  if (DOCUMENT_TYPE_ALIASES[raw]) return DOCUMENT_TYPE_ALIASES[raw];
  return 'article';
}

function toPosixPath(inputPath) {
  return String(inputPath || '').replace(/\\/g, '/');
}

function sanitizeRelativePath(relativePath) {
  const normalized = path.posix.normalize(toPosixPath(relativePath).replace(/^\/+/, ''));
  if (!normalized || normalized === '.' || normalized.startsWith('..')) return null;
  return normalized;
}

function stripArchiveRoot(archivePath) {
  const normalized = sanitizeRelativePath(archivePath);
  if (!normalized) return null;
  const parts = normalized.split('/');
  if (parts.length <= 1) return normalized;
  return parts.slice(1).join('/');
}

function extOf(filePath) {
  return path.posix.extname(filePath).toLowerCase();
}

function basename(filePath) {
  return path.posix.basename(filePath).toLowerCase();
}

function dirname(filePath) {
  return path.posix.dirname(filePath);
}

function isIgnoredPath(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower.startsWith('.github/') || lower.startsWith('__macosx/')) return true;
  if (lower.includes('/node_modules/') || lower.includes('/.git/')) return true;
  return false;
}

function buildQueries(documentType, promptText = '') {
  const byType = TYPE_QUERIES[documentType] || TYPE_QUERIES.article;
  const prompt = String(promptText || '').trim();
  const promptSnippet = prompt ? ` ${prompt.slice(0, 120)}` : '';
  const queries = [...byType];
  if (promptSnippet) {
    queries.unshift(`${byType[0]}${promptSnippet}`);
  }
  return Array.from(new Set(queries)).slice(0, 4);
}

function scoreTemplateTex(filePath, content, documentType) {
  const lowerPath = filePath.toLowerCase();
  const base = basename(filePath);
  let score = 0;

  if (base === 'main.tex') score += 60;
  if (base.includes('template')) score += 25;
  if (base.includes('report') && documentType === 'report') score += 28;
  if ((base.includes('slides') || base.includes('beamer') || base.includes('presentation')) && documentType === 'slides') score += 40;
  if ((base.includes('cv') || base.includes('resume')) && documentType === 'cv') score += 35;
  if (base.includes('letter') && documentType === 'letter') score += 30;
  if (base.includes('invoice') && documentType === 'invoice') score += 30;
  if (base.includes('proposal') && documentType === 'proposal') score += 30;
  if (base.includes('article') && documentType === 'article') score += 20;

  if (lowerPath.includes('/example') || lowerPath.includes('/demo') || lowerPath.includes('/test') || lowerPath.includes('/sample')) {
    score -= 25;
  }
  if (lowerPath.includes('/doc') || lowerPath.includes('/tutorial')) {
    score -= 15;
  }

  const text = String(content || '').slice(0, MAX_TEXT_PREVIEW);
  if (/\\documentclass\b/.test(text)) score += 45;
  if (/\\begin\{document\}/.test(text)) score += 20;
  if (/\\title\b/.test(text)) score += 8;
  if (/\\tableofcontents\b/.test(text)) score += 4;

  if (documentType === 'slides') {
    if (/\\documentclass(?:\[[^\]]*\])?\{beamer\}/i.test(text)) score += 55;
    if (/\\begin\{frame\}/i.test(text)) score += 20;
  }
  if (documentType === 'report' || documentType === 'business' || documentType === 'technical' || documentType === 'proposal') {
    if (/\\documentclass(?:\[[^\]]*\])?\{report\}/i.test(text)) score += 35;
    if (/\\chapter\{/.test(text)) score += 8;
  }

  return score;
}

function splitCsvLike(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseLatexReferences(texContent) {
  const text = String(texContent || '');
  const refs = {
    tex: [],
    graphics: [],
    bib: [],
    style: [],
    classFile: []
  };

  const addUnique = (target, rawValues) => {
    for (const raw of rawValues) {
      const clean = String(raw || '').trim().replace(/^["']|["']$/g, '');
      if (!clean) continue;
      if (!target.includes(clean)) target.push(clean);
    }
  };

  for (const match of text.matchAll(/\\(?:input|include)\{([^}]+)\}/g)) {
    addUnique(refs.tex, [match[1]]);
  }
  for (const match of text.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    addUnique(refs.graphics, [match[1]]);
  }
  for (const match of text.matchAll(/\\addbibresource(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    addUnique(refs.bib, [match[1]]);
  }
  for (const match of text.matchAll(/\\bibliography\{([^}]+)\}/g)) {
    addUnique(refs.bib, splitCsvLike(match[1]));
  }
  for (const match of text.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    addUnique(refs.style, splitCsvLike(match[1]));
  }
  for (const match of text.matchAll(/\\documentclass(?:\[[^\]]*\])?\{([^}]+)\}/g)) {
    addUnique(refs.classFile, [match[1]]);
  }

  return refs;
}

function resolveRelativeCandidates(baseDir, rawRef, extensions = []) {
  const cleanRef = String(rawRef || '').trim();
  if (!cleanRef) return [];
  const normalizedRaw = cleanRef.replace(/^\.\/+/, '').replace(/^\/+/, '');
  const hasExt = path.posix.extname(normalizedRaw).length > 0;

  const values = [];
  const pushValue = (value) => {
    const sanitized = sanitizeRelativePath(value);
    if (!sanitized) return;
    if (!values.includes(sanitized)) values.push(sanitized);
  };

  if (hasExt || extensions.length === 0) {
    pushValue(path.posix.join(baseDir, normalizedRaw));
    pushValue(normalizedRaw);
  } else {
    for (const ext of extensions) {
      pushValue(path.posix.join(baseDir, `${normalizedRaw}${ext}`));
      pushValue(`${normalizedRaw}${ext}`);
    }
  }

  return values;
}

function pickExisting(candidates, archiveMap) {
  for (const candidate of candidates) {
    if (archiveMap.has(candidate)) return candidate;
  }
  return null;
}

function findByBasename(name, archiveMap) {
  const target = String(name || '').toLowerCase();
  if (!target) return null;
  const hits = [...archiveMap.keys()].filter((key) => basename(key) === target);
  if (!hits.length) return null;
  hits.sort((a, b) => a.length - b.length);
  return hits[0];
}

function safeDecodeText(buffer) {
  if (!buffer || !buffer.length) return '';
  const text = buffer.toString('utf8');
  if (text.includes('\u0000')) return '';
  return text;
}

function collectTemplateFiles(mainTexPath, archiveMap, documentType) {
  const included = new Set([mainTexPath]);
  const queue = [mainTexPath];
  const companionExtensions = new Set(['.sty', '.cls', '.bst', '.bib', '.def', '.fd', '.cfg']);

  while (queue.length > 0) {
    const current = queue.shift();
    const entry = archiveMap.get(current);
    if (!entry || entry.kind !== 'text') continue;

    const refs = parseLatexReferences(entry.text);
    const baseDir = dirname(current);

    for (const texRef of refs.tex) {
      const hit = pickExisting(resolveRelativeCandidates(baseDir, texRef, ['.tex']), archiveMap);
      if (hit && !included.has(hit)) {
        included.add(hit);
        queue.push(hit);
      }
    }

    for (const bibRef of refs.bib) {
      const hit = pickExisting(resolveRelativeCandidates(baseDir, bibRef, ['.bib']), archiveMap);
      if (hit) included.add(hit);
    }

    for (const styleRef of refs.style) {
      const normalized = styleRef.endsWith('.sty') ? styleRef : `${styleRef}.sty`;
      const hit = pickExisting(resolveRelativeCandidates(baseDir, normalized, []), archiveMap)
        || findByBasename(path.posix.basename(normalized), archiveMap);
      if (hit) included.add(hit);
    }

    for (const classRef of refs.classFile) {
      const normalized = classRef.endsWith('.cls') ? classRef : `${classRef}.cls`;
      const hit = pickExisting(resolveRelativeCandidates(baseDir, normalized, []), archiveMap)
        || findByBasename(path.posix.basename(normalized), archiveMap);
      if (hit) included.add(hit);
    }

    for (const imageRef of refs.graphics) {
      const graphicExts = ['.png', '.jpg', '.jpeg', '.pdf', '.svg', '.eps', '.webp', '.bmp'];
      const hit = pickExisting(resolveRelativeCandidates(baseDir, imageRef, graphicExts), archiveMap);
      if (hit) included.add(hit);
    }
  }

  const mainDir = dirname(mainTexPath);
  for (const [filePath, entry] of archiveMap.entries()) {
    if (!entry?.ext || !companionExtensions.has(entry.ext)) continue;
    if (filePath.startsWith(`${mainDir}/`) || dirname(filePath) === mainDir) {
      included.add(filePath);
    }
  }

  const sorted = [...included];
  sorted.sort((a, b) => a.length - b.length);
  return sorted.slice(0, MAX_TEMPLATE_FILES);
}

async function githubRequestJson(url) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'GenLaTeX-TemplateFetcher'
  };
  if (process.env.GITHUB_TEMPLATE_FETCH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TEMPLATE_FETCH_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchRepoArchive(owner, repo, branch) {
  const url = `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(branch)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'GenLaTeX-TemplateFetcher' }
  });
  if (!response.ok) {
    throw new Error(`Template archive download failed (${response.status}) for ${owner}/${repo}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new Error(`Template archive too large: ${buffer.length} bytes`);
  }
  return buffer;
}

async function buildArchiveMapFromZip(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const archiveMap = new Map();

  for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const stripped = stripArchiveRoot(zipPath);
    const relativePath = sanitizeRelativePath(stripped);
    if (!relativePath || isIgnoredPath(relativePath)) continue;

    const ext = extOf(relativePath);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;
    if (zipEntry._data?.uncompressedSize && zipEntry._data.uncompressedSize > MAX_FILE_BYTES) continue;

    const buffer = await zipEntry.async('nodebuffer');
    if (buffer.length > MAX_FILE_BYTES) continue;

    if (TEXT_EXTENSIONS.has(ext)) {
      const text = safeDecodeText(buffer);
      if (!text.trim()) continue;
      archiveMap.set(relativePath, { kind: 'text', ext, size: buffer.length, text });
    } else if (BINARY_EXTENSIONS.has(ext)) {
      archiveMap.set(relativePath, { kind: 'binary', ext, size: buffer.length, base64: buffer.toString('base64') });
    }
  }

  return archiveMap;
}

function scoreRepositoryItem(item, documentType, promptText) {
  const name = String(item?.name || '').toLowerCase();
  const description = String(item?.description || '').toLowerCase();
  const prompt = String(promptText || '').toLowerCase();
  const stars = Number(item?.stargazers_count || 0);
  let score = Math.min(stars, 5000) / 200;

  const boost = (keyword, points = 5) => {
    if (name.includes(keyword) || description.includes(keyword) || prompt.includes(keyword)) score += points;
  };

  boost('latex', 4);
  boost('template', 5);
  if (documentType === 'slides') {
    boost('beamer', 12);
    boost('presentation', 8);
    boost('slides', 8);
  }
  if (documentType === 'report') {
    boost('report', 10);
  }
  if (documentType === 'cv') {
    boost('cv', 10);
    boost('resume', 10);
  }
  if (documentType === 'letter') {
    boost('letter', 9);
  }
  if (documentType === 'invoice') {
    boost('invoice', 12);
  }
  if (documentType === 'proposal') {
    boost('proposal', 10);
  }

  if (item?.archived) score -= 20;
  if (item?.fork) score -= 2;
  return score;
}

function serializeTemplateFiles(paths, archiveMap) {
  const files = {};
  for (const templatePath of paths) {
    const entry = archiveMap.get(templatePath);
    if (!entry) continue;
    if (entry.kind === 'text') {
      files[templatePath] = entry.text;
    } else if (entry.kind === 'binary') {
      files[templatePath] = {
        __encoding: 'base64',
        mime_type: entry.ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream',
        data: entry.base64
      };
    }
  }
  return files;
}

async function tryFetchTemplateFromRepo(repo, documentType, promptText) {
  const owner = repo?.owner?.login;
  const name = repo?.name;
  if (!owner || !name) return null;

  const branch = repo?.default_branch || 'main';
  const zipBuffer = await fetchRepoArchive(owner, name, branch);
  const archiveMap = await buildArchiveMapFromZip(zipBuffer);
  if (archiveMap.size === 0) return null;

  const texFiles = [...archiveMap.entries()]
    .filter(([, entry]) => entry.kind === 'text' && entry.ext === '.tex')
    .map(([filePath, entry]) => ({
      filePath,
      score: scoreTemplateTex(filePath, entry.text, documentType),
      text: entry.text
    }))
    .sort((a, b) => b.score - a.score);

  if (!texFiles.length) return null;
  const main = texFiles[0];
  if (main.score < 30) return null;

  const selectedPaths = collectTemplateFiles(main.filePath, archiveMap, documentType);
  if (!selectedPaths.length) return null;

  const files = serializeTemplateFiles(selectedPaths, archiveMap);
  if (!Object.keys(files).length) return null;

  return {
    success: true,
    provider: 'github',
    repository: `${owner}/${name}`,
    repository_url: repo?.html_url || null,
    main_template_path: main.filePath,
    template_files: files,
    fetched_files_count: Object.keys(files).length
  };
}

export async function fetchOnlineTemplateBundle({
  documentType = 'article',
  documentTemplate = null,
  promptText = '',
  maxRepoCandidates = 4
} = {}) {
  const normalizedType = normalizeDocumentType(documentType);
  const queries = buildQueries(normalizedType, promptText);
  let lastError = null;

  for (const query of queries) {
    try {
      const searchUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${query} language:TeX`)}&sort=stars&order=desc&per_page=10`;
      const payload = await githubRequestJson(searchUrl);
      const repos = Array.isArray(payload?.items) ? payload.items : [];
      if (!repos.length) continue;

      repos.sort((a, b) => scoreRepositoryItem(b, normalizedType, promptText) - scoreRepositoryItem(a, normalizedType, promptText));
      const candidates = repos.slice(0, maxRepoCandidates);

      for (const repo of candidates) {
        try {
          const result = await tryFetchTemplateFromRepo(repo, normalizedType, promptText);
          if (result?.success) {
            return {
              ...result,
              query,
              requested_template: documentTemplate || null,
              requested_type: normalizedType
            };
          }
        } catch (repoError) {
          lastError = repoError;
        }
      }
    } catch (searchError) {
      lastError = searchError;
    }
  }

  return {
    success: false,
    error: lastError ? String(lastError.message || lastError) : 'No suitable online template found.',
    requested_type: normalizedType,
    requested_template: documentTemplate || null
  };
}

export async function saveOnlineTemplateBundle(projectPath, templateBundle, { replaceExisting = true } = {}) {
  const files = templateBundle?.template_files || {};
  const templateEntries = Object.entries(files);
  if (!templateEntries.length) {
    return { success: false, error: 'No template files to save.' };
  }

  const absoluteProjectPath = path.resolve(projectPath);
  const templateDir = path.join(absoluteProjectPath, 'template');

  if (replaceExisting) {
    await fs.rm(templateDir, { recursive: true, force: true }).catch(() => {});
  }
  await fs.mkdir(templateDir, { recursive: true });

  const savedFiles = [];
  for (const [relativeRawPath, content] of templateEntries) {
    const relativePath = sanitizeRelativePath(relativeRawPath);
    if (!relativePath) continue;

    const destination = path.resolve(templateDir, relativePath);
    if (!destination.startsWith(path.resolve(templateDir))) continue;
    await fs.mkdir(path.dirname(destination), { recursive: true });

    if (
      content &&
      typeof content === 'object' &&
      !Array.isArray(content) &&
      String(content.__encoding || content.encoding || '').toLowerCase() === 'base64'
    ) {
      const base64 = String(content.data || content.content || '');
      const buffer = Buffer.from(base64, 'base64');
      await fs.writeFile(destination, buffer);
      savedFiles.push({
        relativePath,
        absolutePath: destination,
        bytes: buffer.length,
        kind: 'binary'
      });
    } else {
      const text = String(content ?? '');
      await fs.writeFile(destination, text, 'utf-8');
      savedFiles.push({
        relativePath,
        absolutePath: destination,
        bytes: Buffer.byteLength(text, 'utf8'),
        kind: 'text'
      });
    }
  }

  return {
    success: true,
    templateDir,
    savedFiles,
    metadata: {
      provider: templateBundle.provider,
      repository: templateBundle.repository,
      repository_url: templateBundle.repository_url,
      main_template_path: templateBundle.main_template_path,
      query: templateBundle.query,
      requested_type: templateBundle.requested_type,
      requested_template: templateBundle.requested_template
    }
  };
}
