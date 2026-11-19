/**
 * Advanced Bibliography Manager
 * Comprehensive bibliography management with formatting, validation, and citation tools
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class BibliographyManager {
  constructor() {
    this.citationStyles = new Map();
    this.loadCitationStyles();
  }

  /**
   * Load built-in citation styles
   */
  loadCitationStyles() {
    // IEEE style
    this.citationStyles.set('ieee', {
      name: 'IEEE',
      description: 'Institute of Electrical and Electronics Engineers',
      format: this.formatIEEECitation.bind(this),
      inTextFormat: this.formatIEEETextCitation.bind(this)
    });

    // APA style
    this.citationStyles.set('apa', {
      name: 'APA',
      description: 'American Psychological Association',
      format: this.formatAPACitation.bind(this),
      inTextFormat: this.formatAPATextCitation.bind(this)
    });

    // MLA style
    this.citationStyles.set('mla', {
      name: 'MLA',
      description: 'Modern Language Association',
      format: this.formatMLACitation.bind(this),
      inTextFormat: this.formatMLATextCitation.bind(this)
    });

    // Chicago style
    this.citationStyles.set('chicago', {
      name: 'Chicago',
      description: 'Chicago Manual of Style',
      format: this.formatChicagoCitation.bind(this),
      inTextFormat: this.formatChicagoTextCitation.bind(this)
    });

    // ACM style
    this.citationStyles.set('acm', {
      name: 'ACM',
      description: 'Association for Computing Machinery',
      format: this.formatACMCitation.bind(this),
      inTextFormat: this.formatACMTextCitation.bind(this)
    });
  }

  /**
   * Format citation according to style
   */
  formatCitation(entry, style = 'ieee') {
    const styleHandler = this.citationStyles.get(style);
    if (!styleHandler) {
      throw new Error(`Unknown citation style: ${style}`);
    }

    return styleHandler.format(entry);
  }

  /**
   * Format in-text citation
   */
  formatInTextCitation(entry, style = 'ieee', context = {}) {
    const styleHandler = this.citationStyles.get(style);
    if (!styleHandler) {
      throw new Error(`Unknown citation style: ${style}`);
    }

    return styleHandler.inTextFormat(entry, context);
  }

  /**
   * Generate bibliography from BibTeX entries
   */
  async generateBibliography(projectId, style = 'ieee', options = {}) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      // Read BibTeX file
      const bibtexContent = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(bibtexContent);
      
      // Filter entries if specified
      let filteredEntries = entries;
      if (options.citedOnly) {
        const paperContent = await this.getPaperContent(projectId);
        const citedKeys = this.extractCitedKeys(paperContent);
        filteredEntries = entries.filter(entry => citedKeys.includes(entry.key));
      }
      
      // Sort entries
      filteredEntries = this.sortEntries(filteredEntries, style);
      
      // Format bibliography
      const bibliography = filteredEntries.map(entry => ({
        key: entry.key,
        citation: this.formatCitation(entry, style),
        entry
      }));
      
      // Generate LaTeX bibliography
      const latexBibliography = this.generateLaTeXBibliography(bibliography, style);
      
      return {
        success: true,
        bibliography,
        latexBibliography,
        totalEntries: bibliography.length,
        style
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate bibliography entries
   */
  async validateBibliography(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const bibtexContent = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(bibtexContent);
      
      const validation = {
        totalEntries: entries.length,
        validEntries: 0,
        invalidEntries: 0,
        warnings: [],
        errors: [],
        suggestions: []
      };
      
      for (const entry of entries) {
        const entryValidation = this.validateEntry(entry);
        
        if (entryValidation.valid) {
          validation.validEntries++;
        } else {
          validation.invalidEntries++;
          validation.errors.push(...entryValidation.errors);
        }
        
        validation.warnings.push(...entryValidation.warnings);
        validation.suggestions.push(...entryValidation.suggestions);
      }
      
      // Check for duplicate entries
      const duplicateKeys = this.findDuplicateKeys(entries);
      if (duplicateKeys.length > 0) {
        validation.warnings.push({
          type: 'duplicate',
          message: `Duplicate entry keys found: ${duplicateKeys.join(', ')}`,
          entries: duplicateKeys
        });
      }
      
      // Check for unused entries
      const paperContent = await this.getPaperContent(projectId);
      const citedKeys = this.extractCitedKeys(paperContent);
      const unusedEntries = entries.filter(entry => !citedKeys.includes(entry.key));
      
      if (unusedEntries.length > 0) {
        validation.suggestions.push({
          type: 'unused',
          message: `${unusedEntries.length} unused bibliography entries found`,
          entries: unusedEntries.map(e => e.key)
        });
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
   * Find and fix common bibliography issues
   */
  async fixBibliographyIssues(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const bibtexContent = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(bibtexContent);
      
      const fixes = [];
      const fixedEntries = [];
      
      for (const entry of entries) {
        const fixedEntry = { ...entry };
        const entryFixes = [];
        
        // Fix common issues
        if (fixedEntry.fields.author) {
          const originalAuthor = fixedEntry.fields.author;
          fixedEntry.fields.author = this.fixAuthorFormat(fixedEntry.fields.author);
          if (originalAuthor !== fixedEntry.fields.author) {
            entryFixes.push('Fixed author format');
          }
        }
        
        if (fixedEntry.fields.title) {
          const originalTitle = fixedEntry.fields.title;
          fixedEntry.fields.title = this.fixTitleFormat(fixedEntry.fields.title);
          if (originalTitle !== fixedEntry.fields.title) {
            entryFixes.push('Fixed title format');
          }
        }
        
        if (fixedEntry.fields.year) {
          const originalYear = fixedEntry.fields.year;
          fixedEntry.fields.year = this.fixYearFormat(fixedEntry.fields.year);
          if (originalYear !== fixedEntry.fields.year) {
            entryFixes.push('Fixed year format');
          }
        }
        
        // Add missing fields
        const missingFields = this.suggestMissingFields(fixedEntry);
        for (const field of missingFields) {
          if (field.suggestion) {
            fixedEntry.fields[field.name] = field.suggestion;
            entryFixes.push(`Added missing field: ${field.name}`);
          }
        }
        
        if (entryFixes.length > 0) {
          fixes.push({
            key: fixedEntry.key,
            fixes: entryFixes
          });
        }
        
        fixedEntries.push(fixedEntry);
      }
      
      // Generate new BibTeX content
      const newBibtexContent = this.generateBibTeX(fixedEntries);
      
      // Backup original file
      const backupPath = bibtexPath + '.backup';
      await fs.copyFile(bibtexPath, backupPath);
      
      // Write fixed content
      await fs.writeFile(bibtexPath, newBibtexContent, 'utf-8');
      
      return {
        success: true,
        fixes,
        totalFixes: fixes.length,
        backupPath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate citation report
   */
  async generateCitationReport(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const bibtexPath = path.join(projectPath, 'references.bib');
      
      const bibtexContent = await fs.readFile(bibtexPath, 'utf-8');
      const entries = this.parseBibTeX(bibtexContent);
      
      const paperContent = await this.getPaperContent(projectId);
      const citedKeys = this.extractCitedKeys(paperContent);
      
      const report = {
        totalEntries: entries.length,
        citedEntries: citedKeys.length,
        uncitedEntries: entries.length - citedKeys.length,
        citationDensity: this.calculateCitationDensity(paperContent),
        entryTypes: this.analyzeEntryTypes(entries),
        publicationYears: this.analyzePublicationYears(entries),
        authors: this.analyzeAuthors(entries),
        journals: this.analyzeJournals(entries),
        citationPatterns: this.analyzeCitationPatterns(paperContent, citedKeys)
      };
      
      return {
        success: true,
        report
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * IEEE citation formatting
   */
  formatIEEECitation(entry) {
    const fields = entry.fields;
    let citation = '';
    
    // Author(s)
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        citation += authors[0].lastName + ', ' + authors[0].firstName;
      } else if (authors.length <= 6) {
        citation += authors.map(a => a.lastName + ', ' + a.firstName.charAt(0) + '.').join(', ');
      } else {
        citation += authors.slice(0, 6).map(a => a.lastName + ', ' + a.firstName.charAt(0) + '.').join(', ') + ' et al.';
      }
    }
    
    // Title
    if (fields.title) {
      citation += ', "' + fields.title + '"';
    }
    
    // Journal/Book
    if (fields.journal) {
      citation += ', ' + fields.journal;
    } else if (fields.booktitle) {
      citation += ', in ' + fields.booktitle;
    }
    
    // Volume and pages
    if (fields.volume) {
      citation += ', vol. ' + fields.volume;
    }
    if (fields.number) {
      citation += ', no. ' + fields.number;
    }
    if (fields.pages) {
      citation += ', pp. ' + fields.pages;
    }
    
    // Year
    if (fields.year) {
      citation += ', ' + fields.year;
    }
    
    // DOI
    if (fields.doi) {
      citation += ', doi: ' + fields.doi;
    }
    
    return citation + '.';
  }

  /**
   * IEEE in-text citation formatting
   */
  formatIEEETextCitation(entry, context = {}) {
    const fields = entry.fields;
    
    if (fields.author && fields.year) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        return `[${authors[0].lastName}, ${fields.year}]`;
      } else if (authors.length === 2) {
        return `[${authors[0].lastName} and ${authors[1].lastName}, ${fields.year}]`;
      } else {
        return `[${authors[0].lastName} et al., ${fields.year}]`;
      }
    }
    
    return `[${entry.key}]`;
  }

  /**
   * APA citation formatting
   */
  formatAPACitation(entry) {
    const fields = entry.fields;
    let citation = '';
    
    // Author(s)
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        citation += authors[0].lastName + ', ' + authors[0].firstName.charAt(0) + '.';
      } else if (authors.length <= 7) {
        citation += authors.map(a => a.lastName + ', ' + a.firstName.charAt(0) + '.').join(', ');
      } else {
        citation += authors.slice(0, 6).map(a => a.lastName + ', ' + a.firstName.charAt(0) + '.').join(', ') + ', ... ' + authors[authors.length - 1].lastName + ', ' + authors[authors.length - 1].firstName.charAt(0) + '.';
      }
    }
    
    // Year
    if (fields.year) {
      citation += ' (' + fields.year + ').';
    }
    
    // Title
    if (fields.title) {
      citation += ' ' + fields.title + '.';
    }
    
    // Journal/Publisher
    if (fields.journal) {
      citation += ' ' + fields.journal;
      if (fields.volume) {
        citation += ', ' + fields.volume;
        if (fields.number) {
          citation += '(' + fields.number + ')';
        }
        if (fields.pages) {
          citation += ', ' + fields.pages;
        }
      }
    } else if (fields.publisher) {
      citation += ' ' + fields.publisher;
    }
    
    // DOI
    if (fields.doi) {
      citation += '. https://doi.org/' + fields.doi;
    }
    
    return citation;
  }

  /**
   * APA in-text citation formatting
   */
  formatAPATextCitation(entry, context = {}) {
    const fields = entry.fields;
    
    if (fields.author && fields.year) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        return `(${authors[0].lastName}, ${fields.year})`;
      } else if (authors.length === 2) {
        return `(${authors[0].lastName} & ${authors[1].lastName}, ${fields.year})`;
      } else {
        return `(${authors[0].lastName} et al., ${fields.year})`;
      }
    }
    
    return `(${entry.key})`;
  }

  /**
   * MLA citation formatting
   */
  formatMLACitation(entry) {
    const fields = entry.fields;
    let citation = '';
    
    // Author(s)
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        citation += authors[0].lastName + ', ' + authors[0].firstName;
      } else if (authors.length === 2) {
        citation += authors[0].lastName + ', ' + authors[0].firstName + ', and ' + authors[1].firstName + ' ' + authors[1].lastName;
      } else {
        citation += authors[0].lastName + ', ' + authors[0].firstName + ' et al.';
      }
    }
    
    // Title
    if (fields.title) {
      citation += '. "' + fields.title + '."';
    }
    
    // Journal/Container
    if (fields.journal) {
      citation += ' ' + fields.journal;
    }
    
    // Volume and issue
    if (fields.volume) {
      citation += ', vol. ' + fields.volume;
    }
    if (fields.number) {
      citation += ', no. ' + fields.number;
    }
    
    // Year
    if (fields.year) {
      citation += ', ' + fields.year;
    }
    
    // Pages
    if (fields.pages) {
      citation += ', pp. ' + fields.pages;
    }
    
    return citation + '.';
  }

  /**
   * MLA in-text citation formatting
   */
  formatMLATextCitation(entry, context = {}) {
    const fields = entry.fields;
    
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        return `(${authors[0].lastName})`;
      } else {
        return `(${authors[0].lastName} et al.)`;
      }
    }
    
    return `(${entry.key})`;
  }

  /**
   * Chicago citation formatting
   */
  formatChicagoCitation(entry) {
    const fields = entry.fields;
    let citation = '';
    
    // Author(s)
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        citation += authors[0].firstName + ' ' + authors[0].lastName;
      } else if (authors.length === 2) {
        citation += authors[0].firstName + ' ' + authors[0].lastName + ' and ' + authors[1].firstName + ' ' + authors[1].lastName;
      } else {
        citation += authors[0].firstName + ' ' + authors[0].lastName + ' et al.';
      }
    }
    
    // Title
    if (fields.title) {
      citation += '. "' + fields.title + '."';
    }
    
    // Journal
    if (fields.journal) {
      citation += ' ' + fields.journal;
      if (fields.volume) {
        citation += ' ' + fields.volume;
        if (fields.number) {
          citation += ', no. ' + fields.number;
        }
        if (fields.pages) {
          citation += ' (' + fields.pages + ')';
        }
      }
    }
    
    // Year
    if (fields.year) {
      citation += ' (' + fields.year + ')';
    }
    
    return citation + '.';
  }

  /**
   * Chicago in-text citation formatting
   */
  formatChicagoTextCitation(entry, context = {}) {
    const fields = entry.fields;
    
    if (fields.author && fields.year) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        return `(${authors[0].lastName} ${fields.year})`;
      } else {
        return `(${authors[0].lastName} et al. ${fields.year})`;
      }
    }
    
    return `(${entry.key})`;
  }

  /**
   * ACM citation formatting
   */
  formatACMCitation(entry) {
    const fields = entry.fields;
    let citation = '';
    
    // Author(s)
    if (fields.author) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        citation += authors[0].firstName + ' ' + authors[0].lastName;
      } else if (authors.length <= 3) {
        citation += authors.map(a => a.firstName + ' ' + a.lastName).join(', ');
      } else {
        citation += authors.slice(0, 3).map(a => a.firstName + ' ' + a.lastName).join(', ') + ' et al.';
      }
    }
    
    // Year
    if (fields.year) {
      citation += '. ' + fields.year + '.';
    }
    
    // Title
    if (fields.title) {
      citation += ' ' + fields.title + '.';
    }
    
    // Journal/Conference
    if (fields.journal) {
      citation += ' ' + fields.journal;
    } else if (fields.booktitle) {
      citation += ' In ' + fields.booktitle;
    }
    
    // Volume and pages
    if (fields.volume) {
      citation += ' ' + fields.volume;
    }
    if (fields.pages) {
      citation += ' (' + fields.pages + ')';
    }
    
    return citation + '.';
  }

  /**
   * ACM in-text citation formatting
   */
  formatACMTextCitation(entry, context = {}) {
    const fields = entry.fields;
    
    if (fields.author && fields.year) {
      const authors = this.parseAuthors(fields.author);
      if (authors.length === 1) {
        return `[${authors[0].lastName} ${fields.year}]`;
      } else {
        return `[${authors[0].lastName} et al. ${fields.year}]`;
      }
    }
    
    return `[${entry.key}]`;
  }

  /**
   * Parse authors from BibTeX format
   */
  parseAuthors(authorString) {
    const authors = [];
    const authorList = authorString.split(' and ');
    
    for (const author of authorList) {
      const parts = author.trim().split(' ');
      if (parts.length >= 2) {
        authors.push({
          firstName: parts[0],
          lastName: parts[parts.length - 1]
        });
      } else {
        authors.push({
          firstName: parts[0],
          lastName: parts[0]
        });
      }
    }
    
    return authors;
  }

  /**
   * Parse BibTeX content
   */
  parseBibTeX(content) {
    const entries = [];
    const lines = content.split('\n');
    let currentEntry = null;
    let currentField = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
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
          fields: {}
        };
        continue;
      }
      
      // End of entry
      if (line === '}') {
        if (currentEntry) {
          entries.push(currentEntry);
          currentEntry = null;
        }
        continue;
      }
      
      // Field parsing
      if (currentEntry) {
        const fieldMatch = line.match(/^(\w+)\s*=\s*(.*)$/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          let fieldValue = fieldMatch[2];
          
          // Remove trailing comma
          if (fieldValue.endsWith(',')) {
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
   * Generate BibTeX content
   */
  generateBibTeX(entries) {
    let content = '';
    
    for (const entry of entries) {
      content += `@${entry.type}{${entry.key},\n`;
      
      for (const [field, value] of Object.entries(entry.fields)) {
        content += `  ${field}={${value}},\n`;
      }
      
      // Remove trailing comma
      content = content.replace(/,\n$/, '\n');
      content += '}\n\n';
    }
    
    return content;
  }

  /**
   * Validate individual entry
   */
  validateEntry(entry) {
    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      suggestions: []
    };
    
    // Check required fields
    const requiredFields = this.getRequiredFields(entry.type);
    for (const field of requiredFields) {
      if (!entry.fields[field]) {
        validation.valid = false;
        validation.errors.push(`Missing required field '${field}'`);
      }
    }
    
    // Check field formats
    if (entry.fields.year && !/^\d{4}$/.test(entry.fields.year)) {
      validation.warnings.push('Invalid year format');
    }
    
    if (entry.fields.author && !entry.fields.author.includes(' and ')) {
      validation.suggestions.push('Consider using " and " for multiple authors');
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
   * Sort entries according to style
   */
  sortEntries(entries, style) {
    switch (style) {
      case 'ieee':
      case 'acm':
        return entries.sort((a, b) => {
          const aAuthors = this.parseAuthors(a.fields.author || '');
          const bAuthors = this.parseAuthors(b.fields.author || '');
          const aLastName = aAuthors.length > 0 ? aAuthors[0].lastName : '';
          const bLastName = bAuthors.length > 0 ? bAuthors[0].lastName : '';
          return aLastName.localeCompare(bLastName);
        });
      case 'apa':
      case 'chicago':
        return entries.sort((a, b) => {
          const aAuthors = this.parseAuthors(a.fields.author || '');
          const bAuthors = this.parseAuthors(b.fields.author || '');
          const aLastName = aAuthors.length > 0 ? aAuthors[0].lastName : '';
          const bLastName = bAuthors.length > 0 ? bAuthors[0].lastName : '';
          const authorCompare = aLastName.localeCompare(bLastName);
          if (authorCompare !== 0) return authorCompare;
          
          const aYear = parseInt(a.fields.year || '0');
          const bYear = parseInt(b.fields.year || '0');
          return bYear - aYear; // Descending order
        });
      default:
        return entries;
    }
  }

  /**
   * Generate LaTeX bibliography
   */
  generateLaTeXBibliography(bibliography, style) {
    let latex = '';
    
    for (const item of bibliography) {
      latex += `\\bibitem{${item.key}}\n`;
      latex += item.citation + '\n\n';
    }
    
    return latex;
  }

  /**
   * Get paper content
   */
  async getPaperContent(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const mainTexPath = path.join(projectPath, 'main.tex');
      
      return await fs.readFile(mainTexPath, 'utf-8');
    } catch (error) {
      return '';
    }
  }

  /**
   * Extract cited keys from paper content
   */
  extractCitedKeys(content) {
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
   * Find duplicate keys
   */
  findDuplicateKeys(entries) {
    const keyCount = {};
    const duplicates = [];
    
    for (const entry of entries) {
      keyCount[entry.key] = (keyCount[entry.key] || 0) + 1;
    }
    
    for (const [key, count] of Object.entries(keyCount)) {
      if (count > 1) {
        duplicates.push(key);
      }
    }
    
    return duplicates;
  }

  /**
   * Fix author format
   */
  fixAuthorFormat(authorString) {
    return authorString
      .replace(/\s*,\s*/g, ' and ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Fix title format
   */
  fixTitleFormat(title) {
    return title
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Fix year format
   */
  fixYearFormat(year) {
    const match = year.match(/(\d{4})/);
    return match ? match[1] : year;
  }

  /**
   * Suggest missing fields
   */
  suggestMissingFields(entry) {
    const suggestions = [];
    const requiredFields = this.getRequiredFields(entry.type);
    
    for (const field of requiredFields) {
      if (!entry.fields[field]) {
        suggestions.push({
          name: field,
          suggestion: this.getFieldSuggestion(field, entry)
        });
      }
    }
    
    return suggestions;
  }

  /**
   * Get field suggestion
   */
  getFieldSuggestion(fieldName, entry) {
    // Basic suggestions - in a real implementation, this could use AI or databases
    const suggestions = {
      'author': 'Unknown Author',
      'title': 'Untitled',
      'year': new Date().getFullYear().toString(),
      'journal': 'Unknown Journal',
      'publisher': 'Unknown Publisher'
    };
    
    return suggestions[fieldName] || '';
  }

  /**
   * Calculate citation density
   */
  calculateCitationDensity(content) {
    const words = content.split(/\s+/).length;
    const citations = (content.match(/\\cite\{[^}]+\}/g) || []).length;
    
    return words > 0 ? (citations / words) * 1000 : 0; // Citations per 1000 words
  }

  /**
   * Analyze entry types
   */
  analyzeEntryTypes(entries) {
    const types = {};
    
    for (const entry of entries) {
      types[entry.type] = (types[entry.type] || 0) + 1;
    }
    
    return types;
  }

  /**
   * Analyze publication years
   */
  analyzePublicationYears(entries) {
    const years = {};
    
    for (const entry of entries) {
      const year = entry.fields.year;
      if (year) {
        years[year] = (years[year] || 0) + 1;
      }
    }
    
    return years;
  }

  /**
   * Analyze authors
   */
  analyzeAuthors(entries) {
    const authors = {};
    
    for (const entry of entries) {
      if (entry.fields.author) {
        const authorList = this.parseAuthors(entry.fields.author);
        for (const author of authorList) {
          const fullName = `${author.firstName} ${author.lastName}`;
          authors[fullName] = (authors[fullName] || 0) + 1;
        }
      }
    }
    
    return authors;
  }

  /**
   * Analyze journals
   */
  analyzeJournals(entries) {
    const journals = {};
    
    for (const entry of entries) {
      const journal = entry.fields.journal || entry.fields.booktitle;
      if (journal) {
        journals[journal] = (journals[journal] || 0) + 1;
      }
    }
    
    return journals;
  }

  /**
   * Analyze citation patterns
   */
  analyzeCitationPatterns(content, citedKeys) {
    const patterns = {
      totalCitations: citedKeys.length,
      uniqueCitations: new Set(citedKeys).size,
      mostCited: this.getMostCited(citedKeys),
      citationDistribution: this.getCitationDistribution(content)
    };
    
    return patterns;
  }

  /**
   * Get most cited entries
   */
  getMostCited(citedKeys) {
    const count = {};
    
    for (const key of citedKeys) {
      count[key] = (count[key] || 0) + 1;
    }
    
    return Object.entries(count)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([key, count]) => ({ key, count }));
  }

  /**
   * Get citation distribution
   */
  getCitationDistribution(content) {
    const lines = content.split('\n');
    const distribution = {};
    
    for (let i = 0; i < lines.length; i++) {
      const citations = (lines[i].match(/\\cite\{[^}]+\}/g) || []).length;
      if (citations > 0) {
        distribution[i + 1] = citations;
      }
    }
    
    return distribution;
  }
}
