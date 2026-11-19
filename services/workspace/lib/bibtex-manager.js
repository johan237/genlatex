/**
 * BibTeX Management System
 * Handles BibTeX parsing, validation, and AI-powered citation features
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class BibTeXManager {
  constructor() {
    this.entries = new Map();
    this.crossrefService = new CrossRefService();
  }

  /**
   * Load BibTeX file
   */
  async loadBibTeX(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const content = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(content);
      
      // Clear existing entries and load new ones
      this.entries.clear();
      for (const entry of entries) {
        this.entries.set(entry.key, entry);
      }
      
      return {
        success: true,
        entries_loaded: entries.length,
        entries
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save BibTeX file
   */
  async saveBibTeX(projectId, entries = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const entriesToSave = entries || Array.from(this.entries.values());
      const content = this.generateBibTeX(entriesToSave);
      
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(bibtexPath, content, 'utf-8');
      
      return {
        success: true,
        entries_saved: entriesToSave.length,
        path: bibtexPath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse BibTeX content
   */
  parseBibTeX(content) {
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;
    let currentField = null;
    let braceLevel = 0;
    let inEntry = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('%')) {
        continue;
      }
      
      // Start of new entry
      const entryMatch = line.match(/@(\w+)\s*\{\s*([^,]+),?\s*$/);
      if (entryMatch) {
        if (currentEntry) {
          entries.push(currentEntry);
        }
        
        currentEntry = {
          type: entryMatch[1],
          key: entryMatch[2],
          fields: {},
          raw: line
        };
        inEntry = true;
        continue;
      }
      
      // End of entry
      if (inEntry && line === '}') {
        if (currentEntry) {
          entries.push(currentEntry);
          currentEntry = null;
        }
        inEntry = false;
        continue;
      }
      
      // Field parsing
      if (inEntry && currentEntry) {
        const fieldMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          let fieldValue = fieldMatch[2];
          
          // Handle multi-line fields
          if (fieldValue.endsWith(',') || fieldValue.endsWith('}')) {
            fieldValue = fieldValue.slice(0, -1);
          }
          
          // Remove braces
          if (fieldValue.startsWith('{') && fieldValue.endsWith('}')) {
            fieldValue = fieldValue.slice(1, -1);
          }
          
          currentEntry.fields[fieldName] = fieldValue;
        }
      }
    }
    
    return entries;
  }

  /**
   * Generate BibTeX content from entries
   */
  generateBibTeX(entries) {
    let content = '';
    
    for (const entry of entries) {
      content += `@${entry.type}{${entry.key},\n`;
      
      for (const [field, value] of Object.entries(entry.fields)) {
        content += `  ${field}={${this.escapeBibTeX(value)}},\n`;
      }
      
      // Remove trailing comma
      content = content.replace(/,\n$/, '\n');
      content += '}\n\n';
    }
    
    return content;
  }

  /**
   * Add new entry
   */
  addEntry(entry) {
    if (!entry.key) {
      entry.key = this.generateKey(entry);
    }
    
    this.entries.set(entry.key, entry);
    return entry.key;
  }

  /**
   * Update existing entry
   */
  updateEntry(key, updates) {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    
    Object.assign(entry.fields, updates);
    return true;
  }

  /**
   * Remove entry
   */
  removeEntry(key) {
    return this.entries.delete(key);
  }

  /**
   * Get entry by key
   */
  getEntry(key) {
    return this.entries.get(key);
  }

  /**
   * Search entries
   */
  searchEntries(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [key, entry] of this.entries) {
      const searchableText = [
        key,
        entry.type,
        entry.fields.title || '',
        entry.fields.author || '',
        entry.fields.journal || '',
        entry.fields.booktitle || '',
        entry.fields.abstract || ''
      ].join(' ').toLowerCase();
      
      if (searchableText.includes(queryLower)) {
        results.push(entry);
      }
    }
    
    return results;
  }

  /**
   * Get all entries
   */
  getAllEntries() {
    return Array.from(this.entries.values());
  }

  /**
   * Validate BibTeX entries
   */
  validateEntries() {
    const validation = {
      valid: 0,
      invalid: 0,
      errors: [],
      warnings: []
    };
    
    for (const [key, entry] of this.entries) {
      const entryValidation = this.validateEntry(entry);
      
      if (entryValidation.valid) {
        validation.valid++;
      } else {
        validation.invalid++;
        validation.errors.push(...entryValidation.errors);
      }
      
      validation.warnings.push(...entryValidation.warnings);
    }
    
    return validation;
  }

  /**
   * Validate individual entry
   */
  validateEntry(entry) {
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    // Check required fields
    const requiredFields = this.getRequiredFields(entry.type);
    for (const field of requiredFields) {
      if (!entry.fields[field]) {
        validation.valid = false;
        validation.errors.push(`Missing required field '${field}' in entry '${entry.key}'`);
      }
    }
    
    // Check field formats
    if (entry.fields.year && !/^\d{4}$/.test(entry.fields.year)) {
      validation.warnings.push(`Invalid year format in entry '${entry.key}'`);
    }
    
    if (entry.fields.author && !entry.fields.author.includes(' and ')) {
      validation.warnings.push(`Consider using ' and ' for multiple authors in entry '${entry.key}'`);
    }
    
    // Check for duplicate keys
    const duplicateKeys = Array.from(this.entries.keys()).filter(k => k === entry.key);
    if (duplicateKeys.length > 1) {
      validation.warnings.push(`Duplicate key '${entry.key}' found`);
    }
    
    return validation;
  }

  /**
   * Get required fields for entry type
   */
  getRequiredFields(type) {
    const requiredFields = {
      'article': ['title', 'author', 'journal', 'year'],
      'book': ['title', 'author', 'publisher', 'year'],
      'inproceedings': ['title', 'author', 'booktitle', 'year'],
      'incollection': ['title', 'author', 'booktitle', 'publisher', 'year'],
      'phdthesis': ['title', 'author', 'school', 'year'],
      'mastersthesis': ['title', 'author', 'school', 'year'],
      'techreport': ['title', 'author', 'institution', 'year'],
      'misc': ['title']
    };
    
    return requiredFields[type] || ['title'];
  }

  /**
   * Generate entry key
   */
  generateKey(entry) {
    const author = entry.fields.author || 'unknown';
    const year = entry.fields.year || 'unknown';
    const title = entry.fields.title || 'untitled';
    
    // Extract first author's last name
    const firstAuthor = author.split(' and ')[0].trim();
    const lastName = firstAuthor.split(' ').pop().toLowerCase();
    
    // Extract first significant word from title
    const titleWords = title.toLowerCase().split(/\s+/);
    const firstWord = titleWords.find(word => word.length > 3) || 'item';
    
    return `${lastName}${year}${firstWord}`;
  }

  /**
   * AI-powered citation suggestions
   */
  async getCitationSuggestions(paperContent, limit = 10) {
    try {
      // Extract keywords from paper content
      const keywords = this.extractKeywords(paperContent);
      
      // Find relevant entries
      const suggestions = [];
      for (const keyword of keywords.slice(0, 5)) {
        const matches = this.searchEntries(keyword);
        suggestions.push(...matches);
      }
      
      // Remove duplicates and rank by relevance
      const uniqueSuggestions = suggestions.filter((entry, index, self) => 
        index === self.findIndex(e => e.key === entry.key)
      );
      
      // Rank by keyword frequency
      const rankedSuggestions = uniqueSuggestions.map(entry => ({
        entry,
        relevance: this.calculateRelevance(entry, keywords)
      })).sort((a, b) => b.relevance - a.relevance);
      
      return {
        success: true,
        suggestions: rankedSuggestions.slice(0, limit).map(s => s.entry),
        keywords_used: keywords.slice(0, 5)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate relevance score for entry
   */
  calculateRelevance(entry, keywords) {
    const searchableText = [
      entry.fields.title || '',
      entry.fields.author || '',
      entry.fields.journal || '',
      entry.fields.booktitle || '',
      entry.fields.abstract || ''
    ].join(' ').toLowerCase();
    
    let score = 0;
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      const matches = searchableText.match(regex);
      if (matches) {
        score += matches.length;
      }
    }
    
    return score;
  }

  /**
   * Extract keywords from text
   */
  extractKeywords(text) {
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    const stopWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'this', 'that', 'these', 'those', 'is', 'are', 'was',
      'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'can', 'shall', 'paper', 'section', 'figure', 'table', 'results',
      'analysis', 'method', 'approach', 'system', 'data', 'study'
    ]);
    
    const filteredWords = words.filter(word => !stopWords.has(word));
    
    const wordCount = {};
    for (const word of filteredWords) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
    
    return Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20)
      .map(([word]) => word);
  }

  /**
   * Generate BibTeX from DOI
   */
  async generateFromDOI(doi) {
    try {
      const metadata = await this.crossrefService.getMetadata(doi);
      
      if (metadata.success) {
        const entry = this.convertMetadataToEntry(metadata.data);
        return {
          success: true,
          entry
        };
      } else {
        return metadata;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate BibTeX from URL
   */
  async generateFromURL(url) {
    try {
      // Try to extract DOI from URL
      const doiMatch = url.match(/doi\.org\/(.+)/);
      if (doiMatch) {
        return await this.generateFromDOI(doiMatch[1]);
      }
      
      // Try to extract metadata from webpage
      const metadata = await this.extractWebpageMetadata(url);
      
      if (metadata.success) {
        const entry = this.convertMetadataToEntry(metadata.data);
        return {
          success: true,
          entry
        };
      } else {
        return metadata;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Convert metadata to BibTeX entry
   */
  convertMetadataToEntry(metadata) {
    const entry = {
      type: this.determineEntryType(metadata),
      key: this.generateKeyFromMetadata(metadata),
      fields: {}
    };
    
    // Map common fields
    if (metadata.title) entry.fields.title = metadata.title;
    if (metadata.author) entry.fields.author = metadata.author;
    if (metadata.year) entry.fields.year = metadata.year;
    if (metadata.journal) entry.fields.journal = metadata.journal;
    if (metadata.publisher) entry.fields.publisher = metadata.publisher;
    if (metadata.doi) entry.fields.doi = metadata.doi;
    if (metadata.url) entry.fields.url = metadata.url;
    if (metadata.abstract) entry.fields.abstract = metadata.abstract;
    
    return entry;
  }

  /**
   * Determine entry type from metadata
   */
  determineEntryType(metadata) {
    if (metadata.journal) return 'article';
    if (metadata.booktitle) return 'inproceedings';
    if (metadata.publisher && !metadata.journal) return 'book';
    return 'misc';
  }

  /**
   * Generate key from metadata
   */
  generateKeyFromMetadata(metadata) {
    const author = metadata.author || 'unknown';
    const year = metadata.year || 'unknown';
    const title = metadata.title || 'untitled';
    
    const firstAuthor = author.split(' and ')[0].trim();
    const lastName = firstAuthor.split(' ').pop().toLowerCase();
    const titleWords = title.toLowerCase().split(/\s+/);
    const firstWord = titleWords.find(word => word.length > 3) || 'item';
    
    return `${lastName}${year}${firstWord}`;
  }

  /**
   * Extract metadata from webpage
   */
  async extractWebpageMetadata(url) {
    // This would require a web scraping service
    // For now, return a basic implementation
    return {
      success: false,
      error: 'Webpage metadata extraction not implemented'
    };
  }

  /**
   * Find unused references
   */
  findUnusedReferences(paperContent) {
    const usedKeys = this.extractUsedKeys(paperContent);
    const allKeys = Array.from(this.entries.keys());
    const unusedKeys = allKeys.filter(key => !usedKeys.includes(key));
    
    return {
      used: usedKeys.length,
      unused: unusedKeys.length,
      unused_keys: unusedKeys
    };
  }

  /**
   * Extract used citation keys from paper content
   */
  extractUsedKeys(content) {
    const citeRegex = /\\cite\{([^}]+)\}/g;
    const keys = [];
    let match;
    
    while ((match = citeRegex.exec(content)) !== null) {
      const citedKeys = match[1].split(',').map(k => k.trim());
      keys.push(...citedKeys);
    }
    
    return [...new Set(keys)]; // Remove duplicates
  }

  /**
   * Fix malformed entries
   */
  fixMalformedEntries() {
    const fixes = [];
    
    for (const [key, entry] of this.entries) {
      const fixes_applied = [];
      
      // Fix common issues
      if (entry.fields.author && !entry.fields.author.includes(' and ')) {
        // Check if there are multiple authors separated by commas
        if (entry.fields.author.includes(',')) {
          entry.fields.author = entry.fields.author.replace(/,/g, ' and ');
          fixes_applied.push('Fixed author separators');
        }
      }
      
      if (entry.fields.year && !/^\d{4}$/.test(entry.fields.year)) {
        // Try to extract year from date string
        const yearMatch = entry.fields.year.match(/(\d{4})/);
        if (yearMatch) {
          entry.fields.year = yearMatch[1];
          fixes_applied.push('Extracted year from date');
        }
      }
      
      if (fixes_applied.length > 0) {
        fixes.push({
          key,
          fixes: fixes_applied
        });
      }
    }
    
    return fixes;
  }

  /**
   * Escape special characters for BibTeX
   */
  escapeBibTeX(text) {
    if (!text) return '';
    
    return text
      .replace(/\\/g, '\\textbackslash{}')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\&/g, '\\&')
      .replace(/\$/g, '\\$')
      .replace(/%/g, '\\%')
      .replace(/#/g, '\\#')
      .replace(/\^/g, '\\textasciicircum{}')
      .replace(/_/g, '\\_')
      .replace(/~/g, '\\textasciitilde{}');
  }

  /**
   * Merge multiple BibTeX files
   */
  async mergeBibTeXFiles(filePaths) {
    const allEntries = new Map();
    
    for (const filePath of filePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entries = this.parseBibTeX(content);
        
        for (const entry of entries) {
          if (allEntries.has(entry.key)) {
            // Handle duplicate keys
            const existing = allEntries.get(entry.key);
            const merged = this.mergeEntries(existing, entry);
            allEntries.set(entry.key, merged);
          } else {
            allEntries.set(entry.key, entry);
          }
        }
      } catch (error) {
        console.warn(`Could not read file ${filePath}:`, error.message);
      }
    }
    
    return Array.from(allEntries.values());
  }

  /**
   * Merge two entries
   */
  mergeEntries(entry1, entry2) {
    const merged = { ...entry1 };
    
    // Merge fields, preferring non-empty values
    for (const [field, value] of Object.entries(entry2.fields)) {
      if (!merged.fields[field] || merged.fields[field].trim() === '') {
        merged.fields[field] = value;
      }
    }
    
    return merged;
  }
}

/**
 * CrossRef Service for DOI metadata
 */
class CrossRefService {
  constructor() {
    this.baseUrl = 'https://api.crossref.org';
  }

  async getMetadata(doi) {
    try {
      const response = await fetch(`${this.baseUrl}/works/${encodeURIComponent(doi)}`);
      
      if (response.ok) {
        const data = await response.json();
        const message = data.message;
        
        return {
          success: true,
          data: {
            title: message.title?.[0] || '',
            author: this.formatAuthors(message.author),
            year: message.published?.['date-parts']?.[0]?.[0] || '',
            journal: message['container-title']?.[0] || '',
            publisher: message.publisher || '',
            doi: message.DOI || '',
            url: message.URL || '',
            abstract: message.abstract || ''
          }
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  formatAuthors(authors) {
    if (!authors || !Array.isArray(authors)) {
      return '';
    }
    
    return authors.map(author => {
      const given = author.given || '';
      const family = author.family || '';
      return `${given} ${family}`.trim();
    }).join(' and ');
  }
}
