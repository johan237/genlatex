/**
 * Lightweight semantic/keyword search engine used by /api/search/semantic.
 * No external dependencies; indexes project text files in-memory per process.
 */

import path from 'path';
import { listDir, readFile } from '@/lib/files.js';

const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 160;

const SEARCHABLE_EXTENSIONS = new Set([
  '.tex', '.bib', '.txt', '.md', '.csv', '.tsv', '.json', '.yaml', '.yml',
  '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rs', '.go', '.php', '.rb', '.xml', '.html', '.css', '.scss', '.sql'
]);

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to',
  'was', 'were', 'will', 'with', 'this', 'these', 'those', 'your', 'you'
]);

function normalizeWhitespace(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function tokenize(text) {
  return normalizeWhitespace(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenSet(text) {
  return new Set(tokenize(text));
}

function cosineSimilarity(aMap, bMap) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (const value of aMap.values()) normA += value * value;
  for (const value of bMap.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;

  for (const [token, value] of aMap.entries()) {
    const bValue = bMap.get(token);
    if (bValue) dot += value * bValue;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function toFrequencyMap(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function clampLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(parsed));
}

function isSearchableFile(filePath) {
  const fileName = path.basename(filePath || '');
  if (!fileName || fileName.startsWith('.')) return false;
  if (fileName.toLowerCase().endsWith('.pdf')) return false;
  return SEARCHABLE_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function splitIntoChunks(content) {
  const text = String(content || '');
  if (!text.trim()) return [];

  if (text.length <= CHUNK_SIZE) {
    return [{ text, start: 0, end: text.length }];
  }

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    chunks.push({ text: text.slice(start, end), start, end });
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function snippetFromChunk(chunkText, query) {
  const normalizedChunk = String(chunkText || '').replace(/\s+/g, ' ').trim();
  if (!normalizedChunk) return '';

  const queryText = String(query || '').trim().toLowerCase();
  if (!queryText) return normalizedChunk.slice(0, 220);

  const idx = normalizedChunk.toLowerCase().indexOf(queryText);
  if (idx < 0) return normalizedChunk.slice(0, 220);

  const start = Math.max(0, idx - 90);
  const end = Math.min(normalizedChunk.length, idx + queryText.length + 120);
  return normalizedChunk.slice(start, end);
}

async function collectProjectFiles(projectId, subdir = '') {
  const entries = await listDir(projectId, subdir);
  const files = [];

  for (const entry of entries) {
    const currentPath = subdir ? `${subdir}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      if (!entry.name.startsWith('.')) {
        files.push(...await collectProjectFiles(projectId, currentPath));
      }
    } else if (isSearchableFile(currentPath)) {
      files.push(currentPath);
    }
  }

  return files;
}

function scoreKeyword(queryTokens, queryText, chunkText, chunkTokenSet) {
  if (!queryTokens.length) return 0;
  const lowerChunk = String(chunkText || '').toLowerCase();

  let tokenHits = 0;
  for (const token of queryTokens) {
    if (chunkTokenSet.has(token)) tokenHits += 1;
  }

  const tokenCoverage = tokenHits / queryTokens.length;
  const phraseBonus = queryText && lowerChunk.includes(queryText) ? 0.35 : 0;
  const repeatedHits = queryTokens.reduce((sum, token) => {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    const match = lowerChunk.match(re);
    return sum + (match ? Math.min(match.length, 4) : 0);
  }, 0);
  const densityBonus = Math.min(0.25, repeatedHits * 0.04);

  return tokenCoverage + phraseBonus + densityBonus;
}

function scoreSemantic(queryFreq, querySet, queryText, chunkText) {
  const chunkTokens = tokenize(chunkText);
  if (!chunkTokens.length) return 0;

  const chunkFreq = toFrequencyMap(chunkTokens);
  const chunkSet = new Set(chunkTokens);

  const cosine = cosineSimilarity(queryFreq, chunkFreq);
  let overlap = 0;
  for (const token of querySet) {
    if (chunkSet.has(token)) overlap += 1;
  }
  const overlapRatio = querySet.size > 0 ? overlap / querySet.size : 0;
  const phraseBonus = queryText && String(chunkText || '').toLowerCase().includes(queryText) ? 0.2 : 0;

  return cosine * 0.65 + overlapRatio * 0.35 + phraseBonus;
}

export class SmartSearchEngine {
  static #instance = null;

  static async getInstance() {
    if (!SmartSearchEngine.#instance) {
      SmartSearchEngine.#instance = new SmartSearchEngine();
    }
    return SmartSearchEngine.#instance;
  }

  constructor() {
    this.projectIndex = new Map();
  }

  async indexProject(projectId) {
    if (!projectId) {
      return {
        success: false,
        projectId: null,
        indexedFiles: 0,
        indexedChunks: 0,
        indexedAt: new Date().toISOString(),
        message: 'No projectId provided'
      };
    }

    const filePaths = await collectProjectFiles(projectId);
    const files = [];
    let totalChunks = 0;

    for (const filePath of filePaths) {
      try {
        const content = await readFile(projectId, filePath, { encoding: 'utf8' });
        const text = typeof content === 'string' ? content : Buffer.from(content || '').toString('utf8');
        const byteLength = Buffer.byteLength(text, 'utf8');
        if (!text.trim() || byteLength > MAX_FILE_SIZE_BYTES) continue;

        const chunks = splitIntoChunks(text).map((chunk, idx) => {
          const tokens = tokenize(chunk.text);
          return {
            id: `${filePath}::${idx}`,
            filePath,
            chunkIndex: idx,
            text: chunk.text,
            tokens,
            tokenSet: new Set(tokens),
            tokenFreq: toFrequencyMap(tokens)
          };
        }).filter((chunk) => chunk.tokens.length > 0);

        if (chunks.length > 0) {
          totalChunks += chunks.length;
          files.push({ filePath, chunks });
        }
      } catch (error) {
        console.warn(`[search] Failed to index file ${filePath}:`, error?.message || error);
      }
    }

    const payload = {
      projectId,
      files,
      indexedAt: new Date().toISOString()
    };
    this.projectIndex.set(projectId, payload);

    return {
      success: true,
      projectId,
      indexedFiles: files.length,
      indexedChunks: totalChunks,
      indexedAt: payload.indexedAt
    };
  }

  async #ensureIndexed(projectId) {
    if (!projectId) return null;
    const cached = this.projectIndex.get(projectId);
    if (cached) return cached;
    await this.indexProject(projectId);
    return this.projectIndex.get(projectId) || null;
  }

  #formatResults(results, query, searchType, projectId, limit) {
    return {
      query,
      searchType,
      projectId: projectId || null,
      total: results.length,
      results: results.slice(0, limit).map((row) => ({
        filePath: row.filePath,
        chunkIndex: row.chunkIndex,
        score: Number(row.score.toFixed(4)),
        snippet: snippetFromChunk(row.text, query)
      }))
    };
  }

  async search(query, projectId, options = {}) {
    const queryText = String(query || '').trim();
    const limit = clampLimit(options.limit);
    if (!queryText) {
      return this.#formatResults([], queryText, 'keyword', projectId, limit);
    }

    const index = await this.#ensureIndexed(projectId);
    if (!index) {
      return this.#formatResults([], queryText, 'keyword', projectId, limit);
    }

    const queryTokens = tokenize(queryText);
    if (!queryTokens.length) {
      return this.#formatResults([], queryText, 'keyword', projectId, limit);
    }

    const scored = [];
    const queryLower = queryText.toLowerCase();

    for (const file of index.files) {
      for (const chunk of file.chunks) {
        const score = scoreKeyword(queryTokens, queryLower, chunk.text, chunk.tokenSet);
        if (score > 0.08) {
          scored.push({
            filePath: chunk.filePath,
            chunkIndex: chunk.chunkIndex,
            score,
            text: chunk.text
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return this.#formatResults(scored, queryText, 'keyword', projectId, limit);
  }

  async semanticSearch(query, projectId, options = {}) {
    const queryText = String(query || '').trim();
    const limit = clampLimit(options.limit);
    if (!queryText) {
      return this.#formatResults([], queryText, 'semantic', projectId, limit);
    }

    const index = await this.#ensureIndexed(projectId);
    if (!index) {
      return this.#formatResults([], queryText, 'semantic', projectId, limit);
    }

    const queryTokens = tokenize(queryText);
    if (!queryTokens.length) {
      return this.#formatResults([], queryText, 'semantic', projectId, limit);
    }

    const queryFreq = toFrequencyMap(queryTokens);
    const querySet = new Set(queryTokens);
    const queryLower = queryText.toLowerCase();

    const scored = [];
    for (const file of index.files) {
      for (const chunk of file.chunks) {
        const score = scoreSemantic(queryFreq, querySet, queryLower, chunk.text);
        if (score > 0.05) {
          scored.push({
            filePath: chunk.filePath,
            chunkIndex: chunk.chunkIndex,
            score,
            text: chunk.text
          });
        }
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return this.#formatResults(scored, queryText, 'semantic', projectId, limit);
  }

  async crossDomainSearch(query, projectId, options = {}) {
    const limit = clampLimit(options.limit);
    const semantic = await this.semanticSearch(query, projectId, { ...options, limit: Math.max(limit * 3, 20) });
    const grouped = new Map();

    for (const row of semantic.results || []) {
      const domain = String(row.filePath || '').split('/')[0] || 'root';
      if (!grouped.has(domain)) grouped.set(domain, []);
      grouped.get(domain).push(row);
    }

    // Diversify results by taking top hit from each domain first, then fill.
    const domainQueues = [...grouped.values()].map((rows) => rows.slice().sort((a, b) => b.score - a.score));
    const diversified = [];
    let added = true;

    while (added && diversified.length < limit) {
      added = false;
      for (const queue of domainQueues) {
        if (queue.length === 0 || diversified.length >= limit) continue;
        diversified.push(queue.shift());
        added = true;
      }
    }

    // If still short, append remaining high-score hits.
    if (diversified.length < limit) {
      const remaining = domainQueues.flat().sort((a, b) => b.score - a.score);
      for (const item of remaining) {
        if (diversified.length >= limit) break;
        diversified.push(item);
      }
    }

    return {
      query: semantic.query,
      searchType: 'cross-domain',
      projectId: semantic.projectId,
      total: semantic.total,
      results: diversified.slice(0, limit)
    };
  }
}

