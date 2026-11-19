/**
 * Zotero Integration Module
 * Handles Zotero API integration for reference management
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class ZoteroIntegration {
  constructor(userId, apiKey) {
    this.userId = userId;
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.zotero.org';
    this.headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Test Zotero API connection
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/users/${this.userId}`, {
        headers: this.headers
      });
      
      if (response.ok) {
        const userInfo = await response.json();
        return {
          success: true,
          user: userInfo.username,
          name: userInfo.name
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

  /**
   * Get all collections for the user
   */
  async getCollections() {
    try {
      const response = await fetch(`${this.baseUrl}/users/${this.userId}/collections`, {
        headers: this.headers
      });
      
      if (response.ok) {
        const collections = await response.json();
        return {
          success: true,
          collections: collections.map(col => ({
            key: col.key,
            name: col.data.name,
            parent: col.data.parentCollection,
            itemCount: col.meta.numItems
          }))
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

  /** Max items to fetch in one sync to avoid long waits for large libraries */
  static get MAX_SYNC_ITEMS() {
    return 200;
  }

  /**
   * Get items from a specific collection
   */
  async getCollectionItems(collectionKey, limit = 100) {
    const cappedLimit = Math.min(Number(limit) || 100, ZoteroIntegration.MAX_SYNC_ITEMS);
    try {
      const response = await fetch(
        `${this.baseUrl}/users/${this.userId}/collections/${collectionKey}/items?limit=${cappedLimit}`,
        { headers: this.headers }
      );
      
      if (response.ok) {
        const items = await response.json();
        return {
          success: true,
          items: items.map(item => this.formatZoteroItem(item))
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

  /**
   * Get all items from user's library
   */
  async getAllItems(limit = 500) {
    const cappedLimit = Math.min(Number(limit) || 500, ZoteroIntegration.MAX_SYNC_ITEMS);
    try {
      const response = await fetch(
        `${this.baseUrl}/users/${this.userId}/items?limit=${cappedLimit}`,
        { headers: this.headers }
      );
      
      if (response.ok) {
        const items = await response.json();
        return {
          success: true,
          items: items.map(item => this.formatZoteroItem(item))
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

  /**
   * Search items by query
   */
  async searchItems(query, limit = 50) {
    try {
      const response = await fetch(
        `${this.baseUrl}/users/${this.userId}/items?q=${encodeURIComponent(query)}&limit=${limit}`,
        { headers: this.headers }
      );
      
      if (response.ok) {
        const items = await response.json();
        return {
          success: true,
          items: items.map(item => this.formatZoteroItem(item)),
          query
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

  /**
   * Sync Zotero collection to local BibTeX file (capped at MAX_SYNC_ITEMS for large libraries)
   */
  async syncCollectionToBibTeX(projectId, collectionKey, options = {}) {
    try {
      const limit = Math.min(Number(options.limit) || 100, ZoteroIntegration.MAX_SYNC_ITEMS);
      const itemsResult = await this.getCollectionItems(collectionKey, limit);
      
      if (!itemsResult.success) {
        return itemsResult;
      }

      const bibtexEntries = itemsResult.items.map(item => this.convertToBibTeX(item));
      const bibtexContent = bibtexEntries.join('\n\n');
      
      // Save to project directory
      const projectPath = path.resolve(process.cwd(), getProjectPath(this.userId ?? undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(bibtexPath, bibtexContent, 'utf-8');
      
      // Save sync metadata
      const syncMetadata = {
        synced_at: new Date().toISOString(),
        collection_key: collectionKey,
        item_count: itemsResult.items.length,
        zotero_user: this.userId
      };
      
      const metadataPath = path.join(projectPath, 'zotero_sync.json');
      await fs.writeFile(metadataPath, JSON.stringify(syncMetadata, null, 2));
      
      return {
        success: true,
        items_synced: itemsResult.items.length,
        bibtex_path: bibtexPath,
        metadata: syncMetadata
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Sync all user items to BibTeX (capped at MAX_SYNC_ITEMS for large libraries)
   */
  async syncAllToBibTeX(projectId, options = {}) {
    try {
      const limit = Math.min(Number(options.limit) || 500, ZoteroIntegration.MAX_SYNC_ITEMS);
      const itemsResult = await this.getAllItems(limit);
      
      if (!itemsResult.success) {
        return itemsResult;
      }

      const bibtexEntries = itemsResult.items.map(item => this.convertToBibTeX(item));
      const bibtexContent = bibtexEntries.join('\n\n');
      
      // Save to project directory
      const projectPath = path.resolve(process.cwd(), getProjectPath(this.userId ?? undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      await fs.mkdir(projectPath, { recursive: true });
      await fs.writeFile(bibtexPath, bibtexContent, 'utf-8');
      
      // Save sync metadata
      const syncMetadata = {
        synced_at: new Date().toISOString(),
        sync_type: 'all_items',
        item_count: itemsResult.items.length,
        zotero_user: this.userId
      };
      
      const metadataPath = path.join(projectPath, 'zotero_sync.json');
      await fs.writeFile(metadataPath, JSON.stringify(syncMetadata, null, 2));
      
      return {
        success: true,
        items_synced: itemsResult.items.length,
        bibtex_path: bibtexPath,
        metadata: syncMetadata
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get citation suggestions based on paper content
   */
  async getCitationSuggestions(paperContent, limit = 10) {
    try {
      // Extract keywords from paper content
      const keywords = this.extractKeywords(paperContent);
      
      // Search Zotero for relevant items
      const suggestions = [];
      
      for (const keyword of keywords.slice(0, 5)) {
        const searchResult = await this.searchItems(keyword, 5);
        if (searchResult.success) {
          suggestions.push(...searchResult.items);
        }
      }
      
      // Remove duplicates and limit results
      const uniqueSuggestions = suggestions.filter((item, index, self) => 
        index === self.findIndex(t => t.key === item.key)
      ).slice(0, limit);
      
      return {
        success: true,
        suggestions: uniqueSuggestions,
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
   * Format Zotero item for consistent use
   */
  formatZoteroItem(item) {
    const data = item.data;
    
    return {
      key: item.key,
      type: data.itemType,
      title: data.title || '',
      authors: this.extractAuthors(data),
      year: data.date ? new Date(data.date).getFullYear() : null,
      journal: data.publicationTitle || data.journalAbbreviation || '',
      publisher: data.publisher || '',
      doi: data.DOI || '',
      url: data.url || '',
      abstract: data.abstractNote || '',
      tags: data.tags ? data.tags.map(tag => tag.tag) : [],
      collections: data.collections || [],
      dateAdded: data.dateAdded,
      dateModified: data.dateModified
    };
  }

  /**
   * Extract authors from Zotero item
   */
  extractAuthors(data) {
    const authors = [];
    
    if (data.creators) {
      for (const creator of data.creators) {
        if (creator.firstName && creator.lastName) {
          authors.push(`${creator.firstName} ${creator.lastName}`);
        } else if (creator.name) {
          authors.push(creator.name);
        }
      }
    }
    
    return authors;
  }

  /**
   * Convert Zotero item to BibTeX format
   */
  convertToBibTeX(item) {
    const formatted = this.formatZoteroItem(item);
    const bibtexKey = this.generateBibTeXKey(formatted);
    
    let bibtex = `@${this.getBibTeXType(formatted.type)}{${bibtexKey},\n`;
    
    // Add title
    if (formatted.title) {
      bibtex += `  title={${this.escapeBibTeX(formatted.title)}},\n`;
    }
    
    // Add authors
    if (formatted.authors.length > 0) {
      bibtex += `  author={${formatted.authors.join(' and ')}},\n`;
    }
    
    // Add year
    if (formatted.year) {
      bibtex += `  year={${formatted.year}},\n`;
    }
    
    // Add journal/booktitle
    if (formatted.journal) {
      if (formatted.type === 'journalArticle') {
        bibtex += `  journal={${this.escapeBibTeX(formatted.journal)}},\n`;
      } else {
        bibtex += `  booktitle={${this.escapeBibTeX(formatted.journal)}},\n`;
      }
    }
    
    // Add publisher
    if (formatted.publisher) {
      bibtex += `  publisher={${this.escapeBibTeX(formatted.publisher)}},\n`;
    }
    
    // Add DOI
    if (formatted.doi) {
      bibtex += `  doi={${formatted.doi}},\n`;
    }
    
    // Add URL
    if (formatted.url) {
      bibtex += `  url={${formatted.url}},\n`;
    }
    
    // Add abstract
    if (formatted.abstract) {
      bibtex += `  abstract={${this.escapeBibTeX(formatted.abstract)}},\n`;
    }
    
    // Remove trailing comma and close
    bibtex = bibtex.replace(/,\n$/, '\n');
    bibtex += '}';
    
    return bibtex;
  }

  /**
   * Generate BibTeX key from item
   */
  generateBibTeXKey(item) {
    const firstAuthor = item.authors[0] || 'unknown';
    const lastName = firstAuthor.split(' ').pop().toLowerCase();
    const year = item.year || 'unknown';
    const titleWord = item.title ? item.title.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') : 'item';
    
    return `${lastName}${year}${titleWord}`;
  }

  /**
   * Get BibTeX type from Zotero type
   */
  getBibTeXType(zoteroType) {
    const typeMap = {
      'journalArticle': 'article',
      'book': 'book',
      'bookSection': 'incollection',
      'conferencePaper': 'inproceedings',
      'thesis': 'phdthesis',
      'report': 'techreport',
      'webpage': 'misc',
      'document': 'misc'
    };
    
    return typeMap[zoteroType] || 'misc';
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
   * Extract keywords from paper content
   */
  extractKeywords(content) {
    // Simple keyword extraction - can be enhanced with NLP
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3);
    
    // Remove common words
    const stopWords = new Set([
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
      'by', 'from', 'this', 'that', 'these', 'those', 'is', 'are', 'was',
      'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must',
      'can', 'shall', 'paper', 'section', 'figure', 'table', 'results',
      'analysis', 'method', 'approach', 'system', 'data', 'study'
    ]);
    
    const filteredWords = words.filter(word => !stopWords.has(word));
    
    // Count word frequency
    const wordCount = {};
    for (const word of filteredWords) {
      wordCount[word] = (wordCount[word] || 0) + 1;
    }
    
    // Return top keywords
    return Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 20)
      .map(([word]) => word);
  }

  /**
   * Get citation autocomplete suggestions
   */
  async getAutocompleteSuggestions(query, limit = 10) {
    try {
      const searchResult = await this.searchItems(query, limit);
      
      if (searchResult.success) {
        return {
          success: true,
          suggestions: searchResult.items.map(item => ({
            key: item.key,
            citation: this.generateCitation(item),
            title: item.title,
            authors: item.authors.join(', '),
            year: item.year
          }))
        };
      } else {
        return searchResult;
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate citation string from item
   */
  generateCitation(item) {
    const authors = item.authors.length > 0 ? item.authors.join(', ') : 'Unknown';
    const year = item.year || 'n.d.';
    const title = item.title || 'Untitled';
    
    return `${authors} (${year}). ${title}`;
  }

  /**
   * Validate BibTeX file
   */
  async validateBibTeX(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(this.userId ?? undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const content = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(content);
      
      const validation = {
        total_entries: entries.length,
        valid_entries: 0,
        invalid_entries: 0,
        errors: [],
        warnings: []
      };
      
      for (const entry of entries) {
        const entryValidation = this.validateBibTeXEntry(entry);
        if (entryValidation.valid) {
          validation.valid_entries++;
        } else {
          validation.invalid_entries++;
          validation.errors.push(...entryValidation.errors);
        }
        validation.warnings.push(...entryValidation.warnings);
      }
      
      return {
        success: true,
        validation
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
    const entryRegex = /@(\w+)\s*\{\s*([^,]+),\s*([^}]+)\}/g;
    
    let match;
    while ((match = entryRegex.exec(content)) !== null) {
      entries.push({
        type: match[1],
        key: match[2],
        fields: this.parseBibTeXFields(match[3])
      });
    }
    
    return entries;
  }

  /**
   * Parse BibTeX fields
   */
  parseBibTeXFields(fieldsString) {
    const fields = {};
    const fieldRegex = /(\w+)\s*=\s*\{([^}]*)\}/g;
    
    let match;
    while ((match = fieldRegex.exec(fieldsString)) !== null) {
      fields[match[1]] = match[2];
    }
    
    return fields;
  }

  /**
   * Validate individual BibTeX entry
   */
  validateBibTeXEntry(entry) {
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    // Check required fields based on type
    const requiredFields = {
      'article': ['title', 'author', 'journal', 'year'],
      'book': ['title', 'author', 'publisher', 'year'],
      'inproceedings': ['title', 'author', 'booktitle', 'year'],
      'misc': ['title']
    };
    
    const required = requiredFields[entry.type] || ['title'];
    
    for (const field of required) {
      if (!entry.fields[field]) {
        validation.valid = false;
        validation.errors.push(`Missing required field '${field}' in entry '${entry.key}'`);
      }
    }
    
    // Check for common issues
    if (entry.fields.author && !entry.fields.author.includes(' and ')) {
      validation.warnings.push(`Single author in entry '${entry.key}' - consider using ' and ' for multiple authors`);
    }
    
    if (entry.fields.year && !/^\d{4}$/.test(entry.fields.year)) {
      validation.warnings.push(`Invalid year format in entry '${entry.key}'`);
    }
    
    return validation;
  }

  /**
   * Process Zotero directory for memory enrichment
   * @param {string} directoryPath - Path to Zotero directory
   * @param {string} projectId - Project ID
   * @returns {object} Processed Zotero content {entries, pdfs}
   */
  async processZoteroDirectory(directoryPath, projectId) {
    const result = {
      entries: [],
      pdfs: []
    };

    try {
      console.log(`📚 Processing Zotero directory: ${directoryPath}`);

      // Find all .bib files
      const bibFiles = await this.findBibFiles(directoryPath);
      console.log(`📄 Found ${bibFiles.length} .bib files`);

      // Parse each .bib file
      for (const bibFile of bibFiles) {
        try {
          const entries = await this.parseBibFile(bibFile);
          result.entries.push(...entries);
        } catch (error) {
          console.warn(`Failed to parse .bib file ${bibFile}:`, error.message);
        }
      }

      // Find PDF files
      const pdfFiles = await this.findPDFFiles(directoryPath);
      console.log(`📕 Found ${pdfFiles.length} PDF files`);

      for (const pdfFile of pdfFiles) {
        result.pdfs.push({
          path: pdfFile,
          filename: path.basename(pdfFile),
          entryId: this.findAssociatedEntry(pdfFile, result.entries)
        });
      }

      console.log(`✅ Processed ${result.entries.length} entries and ${result.pdfs.length} PDFs`);
      return result;
    } catch (error) {
      console.error('Error processing Zotero directory:', error);
      return result;
    }
  }

  /**
   * Find all .bib files in directory recursively
   * @param {string} directory - Directory to search
   * @returns {Promise<array>} Array of .bib file paths
   */
  async findBibFiles(directory) {
    const bibFiles = [];
    const maxDepth = 5;

    const walkDir = async (dir, depth = 0) => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await walkDir(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith('.bib')) {
            bibFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Could not read directory ${dir}:`, error.message);
      }
    };

    await walkDir(directory);
    return bibFiles;
  }

  /**
   * Find all PDF files in directory recursively
   * @param {string} directory - Directory to search
   * @returns {Promise<array>} Array of PDF file paths
   */
  async findPDFFiles(directory) {
    const pdfFiles = [];
    const maxDepth = 5;

    const walkDir = async (dir, depth = 0) => {
      if (depth > maxDepth || pdfFiles.length >= 100) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (pdfFiles.length >= 100) break;

          const fullPath = path.join(dir, entry.name);

          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            await walkDir(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            pdfFiles.push(fullPath);
          }
        }
      } catch (error) {
        console.warn(`Could not read directory ${dir}:`, error.message);
      }
    };

    await walkDir(directory);
    return pdfFiles;
  }

  /**
   * Parse BibTeX file and extract entries
   * @param {string} bibPath - Path to .bib file
   * @returns {Promise<array>} Array of bibliographic entries
   */
  async parseBibFile(bibPath) {
    const entries = [];

    try {
      const content = await fs.readFile(bibPath, 'utf-8');

      // Simple BibTeX parser
      // Matches: @type{key, field = {value}, ...}
      const entryRegex = /@(\w+)\s*\{\s*([^,]+),\s*([\s\S]*?)(?=\n@|\n\s*$)/g;
      let match;

      while ((match = entryRegex.exec(content)) !== null) {
        const type = match[1].toLowerCase();
        const id = match[2].trim();
        const fieldsText = match[3];

        const entry = {
          type,
          id,
          title: this.extractField(fieldsText, 'title'),
          authors: this.extractAuthors(fieldsText),
          year: this.extractField(fieldsText, 'year'),
          journal: this.extractField(fieldsText, 'journal'),
          booktitle: this.extractField(fieldsText, 'booktitle'),
          abstract: this.extractField(fieldsText, 'abstract'),
          doi: this.extractField(fieldsText, 'doi'),
          url: this.extractField(fieldsText, 'url'),
          keywords: this.extractKeywords(fieldsText)
        };

        entries.push(entry);
      }

      return entries;
    } catch (error) {
      console.error(`Error parsing .bib file ${bibPath}:`, error);
      return entries;
    }
  }

  /**
   * Extract field value from BibTeX fields text
   * @param {string} fieldsText - BibTeX fields text
   * @param {string} fieldName - Field name to extract
   * @returns {string|null} Field value or null
   */
  extractField(fieldsText, fieldName) {
    const regex = new RegExp(`${fieldName}\\s*=\\s*[{"']([^}"']+)[}"']`, 'i');
    const match = fieldsText.match(regex);
    return match ? match[1].trim() : null;
  }

  /**
   * Extract authors from BibTeX fields text
   * @param {string} fieldsText - BibTeX fields text
   * @returns {array} Array of author names
   */
  extractAuthors(fieldsText) {
    const authorField = this.extractField(fieldsText, 'author');
    if (!authorField) return [];

    // Split by ' and ' or ' AND '
    return authorField.split(/\s+and\s+/i).map(a => a.trim());
  }

  /**
   * Extract keywords from BibTeX fields text
   * @param {string} fieldsText - BibTeX fields text
   * @returns {array} Array of keywords
   */
  extractKeywords(fieldsText) {
    const keywordsField = this.extractField(fieldsText, 'keywords');
    if (!keywordsField) return [];

    return keywordsField.split(/[,;]/).map(k => k.trim()).filter(k => k.length > 0);
  }

  /**
   * Find associated entry for a PDF file
   * @param {string} pdfPath - Path to PDF file
   * @param {array} entries - Array of bibliographic entries
   * @returns {string|null} Entry ID or null
   */
  findAssociatedEntry(pdfPath, entries) {
    const pdfName = path.basename(pdfPath, '.pdf').toLowerCase();

    for (const entry of entries) {
      // Try to match by ID
      if (entry.id.toLowerCase() === pdfName) {
        return entry.id;
      }

      // Try to match by title (partial)
      if (entry.title) {
        const titleWords = entry.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const matchedWords = titleWords.filter(word => pdfName.includes(word));
        if (matchedWords.length >= 2) {
          return entry.id;
        }
      }
    }

    return null;
  }

  /**
   * We do not extract or store PDF content from Zotero locally.
   * PDF/fulltext is accessed on-demand via the Zotero API when the user (or AI) requests it;
   * the backend (genlatex-agent) uses Zotero tools to call the API as needed.
   */
}
