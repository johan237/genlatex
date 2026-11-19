/**
 * Plagiarism Detection System
 * Detects potential plagiarism and similarity in documents
 */

import fs from 'fs/promises';
import path from 'path';
import { readFile } from './files.js';

export class PlagiarismDetector {
  constructor() {
    this.similarityThreshold = 0.8;
    this.minMatchLength = 10;
    this.database = new Map();
    this.loadDatabase();
  }

  /**
   * Load plagiarism database. Creates data/ and file if missing.
   */
  async loadDatabase() {
    const dataDir = path.join(process.cwd(), 'data');
    const dbPath = path.join(dataDir, 'plagiarism-db.json');
    try {
      const content = await fs.readFile(dbPath, 'utf-8');
      const data = JSON.parse(content);
      for (const [key, value] of Object.entries(data)) {
        this.database.set(key, value);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(dbPath, '{}', 'utf-8');
        } catch {
          // Ignore; database will stay empty
        }
      }
      // Other errors: database stays empty, no console spam
    }
  }

  /**
   * Save plagiarism database
   */
  async saveDatabase() {
    try {
      const dbPath = path.join(process.cwd(), 'data', 'plagiarism-db.json');
      const data = Object.fromEntries(this.database);
      await fs.writeFile(dbPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('Could not save plagiarism database:', error.message);
    }
  }

  /**
   * Check document for plagiarism
   */
  async checkPlagiarism(projectId, options = {}) {
    try {
      // Use storage readFile so it works with both FS and MinIO
      const content = await readFile(projectId, 'main.tex', { encoding: 'utf8' });
      if (!content) {
        throw new Error('main.tex not found or empty');
      }
      const cleanContent = this.cleanText(content);
      
      // Extract text segments
      const segments = this.extractTextSegments(cleanContent);
      
      // Check against database
      const matches = [];
      for (const segment of segments) {
        const segmentMatches = await this.checkSegment(segment, options);
        matches.push(...segmentMatches);
      }
      
      // Calculate overall similarity
      const similarity = this.calculateOverallSimilarity(matches, segments.length);
      
      // Generate report
      const report = {
        projectId,
        totalSegments: segments.length,
        matchedSegments: matches.length,
        overallSimilarity: similarity,
        matches: matches.sort((a, b) => b.similarity - a.similarity),
        riskLevel: this.assessRiskLevel(similarity),
        recommendations: this.generateRecommendations(matches, similarity)
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
   * Check segment against database
   */
  async checkSegment(segment, options = {}) {
    const matches = [];
    const segmentHash = this.hashText(segment.text);
    
    // Check against local database
    for (const [key, entry] of this.database) {
      const similarity = this.calculateSimilarity(segment.text, entry.text);
      
      if (similarity >= (options.threshold || this.similarityThreshold)) {
        matches.push({
          segment: segment,
          source: {
            type: 'local',
            key: key,
            title: entry.title,
            author: entry.author,
            url: entry.url
          },
          similarity: similarity,
          matchType: this.determineMatchType(similarity),
          position: segment.position
        });
      }
    }
    
    // Check against external sources if enabled
    if (options.checkExternal) {
      const externalMatches = await this.checkExternalSources(segment.text, options);
      matches.push(...externalMatches);
    }
    
    return matches;
  }

  /**
   * Check against external sources
   */
  async checkExternalSources(text, options = {}) {
    const matches = [];
    
    try {
      // Check against Google Scholar (simulated)
      const scholarMatches = await this.checkGoogleScholar(text, options);
      matches.push(...scholarMatches);
      
      // Check against arXiv (simulated)
      const arxivMatches = await this.checkArXiv(text, options);
      matches.push(...arxivMatches);
      
      // Check against web sources (simulated)
      const webMatches = await this.checkWebSources(text, options);
      matches.push(...webMatches);
      
    } catch (error) {
      console.warn('External source check failed:', error.message);
    }
    
    return matches;
  }

  /**
   * Check against Google Scholar (simulated)
   */
  async checkGoogleScholar(text, options = {}) {
    // This is a simulated implementation
    // In a real system, you would use Google Scholar API or web scraping
    const matches = [];
    
    // Simulate some matches for demonstration
    if (Math.random() > 0.7) {
      matches.push({
        segment: { text: text.substring(0, 100) },
        source: {
          type: 'google_scholar',
          title: 'Sample Academic Paper',
          author: 'John Doe',
          url: 'https://scholar.google.com/sample',
          year: '2023'
        },
        similarity: 0.85,
        matchType: 'high',
        position: 0
      });
    }
    
    return matches;
  }

  /**
   * Check against arXiv (simulated)
   */
  async checkArXiv(text, options = {}) {
    const matches = [];
    
    // Simulate some matches for demonstration
    if (Math.random() > 0.8) {
      matches.push({
        segment: { text: text.substring(0, 100) },
        source: {
          type: 'arxiv',
          title: 'Sample arXiv Paper',
          author: 'Jane Smith',
          url: 'https://arxiv.org/abs/1234.5678',
          year: '2023'
        },
        similarity: 0.75,
        matchType: 'medium',
        position: 0
      });
    }
    
    return matches;
  }

  /**
   * Check against web sources (simulated)
   */
  async checkWebSources(text, options = {}) {
    const matches = [];
    
    // Simulate some matches for demonstration
    if (Math.random() > 0.9) {
      matches.push({
        segment: { text: text.substring(0, 100) },
        source: {
          type: 'web',
          title: 'Sample Web Article',
          author: 'Unknown',
          url: 'https://example.com/article',
          year: '2023'
        },
        similarity: 0.65,
        matchType: 'low',
        position: 0
      });
    }
    
    return matches;
  }

  /**
   * Clean text for analysis
   */
  cleanText(text) {
    return text
      .toLowerCase()
      .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '') // Remove LaTeX commands
      .replace(/\\[a-zA-Z]+/g, '') // Remove LaTeX commands
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract text segments
   */
  extractTextSegments(text, segmentLength = 50) {
    const segments = [];
    const words = text.split(' ');
    
    for (let i = 0; i < words.length - segmentLength + 1; i++) {
      const segmentWords = words.slice(i, i + segmentLength);
      const segmentText = segmentWords.join(' ');
      
      if (segmentText.length >= this.minMatchLength) {
        segments.push({
          text: segmentText,
          position: i,
          length: segmentText.length
        });
      }
    }
    
    return segments;
  }

  /**
   * Calculate similarity between two texts
   */
  calculateSimilarity(text1, text2) {
    // Use Jaccard similarity
    const set1 = new Set(text1.split(' '));
    const set2 = new Set(text2.split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Calculate overall similarity
   */
  calculateOverallSimilarity(matches, totalSegments) {
    if (totalSegments === 0) return 0;
    
    const totalSimilarity = matches.reduce((sum, match) => sum + match.similarity, 0);
    return totalSimilarity / totalSegments;
  }

  /**
   * Determine match type based on similarity
   */
  determineMatchType(similarity) {
    if (similarity >= 0.9) return 'very_high';
    if (similarity >= 0.8) return 'high';
    if (similarity >= 0.6) return 'medium';
    if (similarity >= 0.4) return 'low';
    return 'very_low';
  }

  /**
   * Assess risk level
   */
  assessRiskLevel(similarity) {
    if (similarity >= 0.8) return 'high';
    if (similarity >= 0.6) return 'medium';
    if (similarity >= 0.4) return 'low';
    return 'very_low';
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(matches, similarity) {
    const recommendations = [];
    
    if (similarity >= 0.8) {
      recommendations.push({
        type: 'critical',
        message: 'High similarity detected. Consider rewriting large portions of the document.',
        action: 'rewrite'
      });
    }
    
    if (matches.length > 10) {
      recommendations.push({
        type: 'warning',
        message: 'Multiple matches found. Review all citations and ensure proper attribution.',
        action: 'review_citations'
      });
    }
    
    const highMatches = matches.filter(m => m.similarity >= 0.8);
    if (highMatches.length > 0) {
      recommendations.push({
        type: 'warning',
        message: `${highMatches.length} high-similarity matches found. Add proper citations.`,
        action: 'add_citations'
      });
    }
    
    if (similarity < 0.4) {
      recommendations.push({
        type: 'info',
        message: 'Low similarity detected. Document appears to be original work.',
        action: 'none'
      });
    }
    
    return recommendations;
  }

  /**
   * Add document to database
   */
  async addToDatabase(projectId, metadata = {}) {
    try {
      const content = await readFile(projectId, 'main.tex', { encoding: 'utf8' });
      if (!content) {
        throw new Error('main.tex not found or empty');
      }
      const cleanContent = this.cleanText(content);
      
      const entry = {
        id: projectId,
        title: metadata.title || 'Untitled Document',
        author: metadata.author || 'Unknown',
        content: cleanContent,
        text: cleanContent,
        url: metadata.url || '',
        year: metadata.year || new Date().getFullYear().toString(),
        addedAt: new Date().toISOString()
      };
      
      this.database.set(projectId, entry);
      await this.saveDatabase();
      
      return {
        success: true,
        message: 'Document added to plagiarism database'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove document from database
   */
  async removeFromDatabase(projectId) {
    try {
      this.database.delete(projectId);
      await this.saveDatabase();
      
      return {
        success: true,
        message: 'Document removed from plagiarism database'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get database statistics
   */
  getDatabaseStats() {
    const stats = {
      totalDocuments: this.database.size,
      totalWords: 0,
      averageLength: 0,
      oldestDocument: null,
      newestDocument: null
    };
    
    let totalWords = 0;
    let oldestDate = null;
    let newestDate = null;
    
    for (const entry of this.database.values()) {
      totalWords += entry.text.split(' ').length;
      
      const date = new Date(entry.addedAt);
      if (!oldestDate || date < oldestDate) {
        oldestDate = date;
        stats.oldestDocument = entry.title;
      }
      if (!newestDate || date > newestDate) {
        newestDate = date;
        stats.newestDocument = entry.title;
      }
    }
    
    stats.totalWords = totalWords;
    stats.averageLength = this.database.size > 0 ? totalWords / this.database.size : 0;
    
    return {
      success: true,
      stats
    };
  }

  /**
   * Hash text for quick comparison
   */
  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Check for self-plagiarism
   */
  async checkSelfPlagiarism(projectId, options = {}) {
    try {
      const content = await readFile(projectId, 'main.tex', { encoding: 'utf8' });
      if (!content) {
        throw new Error('main.tex not found or empty');
      }
      const cleanContent = this.cleanText(content);
      const segments = this.extractTextSegments(cleanContent);
      
      const selfMatches = [];
      
      // Check against other documents in database (excluding current)
      for (const [key, entry] of this.database) {
        if (key !== projectId) {
          for (const segment of segments) {
            const similarity = this.calculateSimilarity(segment.text, entry.text);
            
            if (similarity >= (options.threshold || 0.7)) {
              selfMatches.push({
                segment: segment,
                source: {
                  type: 'self',
                  key: key,
                  title: entry.title,
                  author: entry.author
                },
                similarity: similarity,
                matchType: this.determineMatchType(similarity),
                position: segment.position
              });
            }
          }
        }
      }
      
      const overallSimilarity = this.calculateOverallSimilarity(selfMatches, segments.length);
      
      return {
        success: true,
        report: {
          projectId,
          totalSegments: segments.length,
          matchedSegments: selfMatches.length,
          overallSimilarity: overallSimilarity,
          matches: selfMatches.sort((a, b) => b.similarity - a.similarity),
          riskLevel: this.assessRiskLevel(overallSimilarity),
          recommendations: this.generateRecommendations(selfMatches, overallSimilarity)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate plagiarism report
   */
  async generateReport(projectId, options = {}) {
    try {
      const plagiarismCheck = await this.checkPlagiarism(projectId, options);
      const selfPlagiarismCheck = await this.checkSelfPlagiarism(projectId, options);
      
      if (!plagiarismCheck.success) {
        return plagiarismCheck;
      }
      
      const report = {
        projectId,
        generatedAt: new Date().toISOString(),
        plagiarism: plagiarismCheck.report,
        selfPlagiarism: selfPlagiarismCheck.success ? selfPlagiarismCheck.report : null,
        summary: {
          totalMatches: plagiarismCheck.report.matches.length + (selfPlagiarismCheck.success ? selfPlagiarismCheck.report.matches.length : 0),
          highestSimilarity: Math.max(
            plagiarismCheck.report.matches.length > 0 ? Math.max(...plagiarismCheck.report.matches.map(m => m.similarity)) : 0,
            selfPlagiarismCheck.success && selfPlagiarismCheck.report.matches.length > 0 ? Math.max(...selfPlagiarismCheck.report.matches.map(m => m.similarity)) : 0
          ),
          riskLevel: this.assessRiskLevel(
            Math.max(plagiarismCheck.report.overallSimilarity, selfPlagiarismCheck.success ? selfPlagiarismCheck.report.overallSimilarity : 0)
          )
        }
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
   * Export report to different formats
   */
  async exportReport(report, format = 'json') {
    try {
      switch (format) {
        case 'json':
          return {
            success: true,
            content: JSON.stringify(report, null, 2),
            mimeType: 'application/json'
          };
        case 'html':
          return {
            success: true,
            content: this.generateHTMLReport(report),
            mimeType: 'text/html'
          };
        case 'pdf':
          return {
            success: true,
            content: this.generatePDFReport(report),
            mimeType: 'application/pdf'
          };
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(report) {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Plagiarism Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .section { margin: 20px 0; }
        .match { background: #fff3cd; padding: 10px; margin: 10px 0; border-radius: 3px; }
        .high { background: #f8d7da; }
        .medium { background: #fff3cd; }
        .low { background: #d1ecf1; }
        .similarity { font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Plagiarism Report</h1>
        <p>Project: ${report.projectId}</p>
        <p>Generated: ${new Date(report.generatedAt).toLocaleString()}</p>
        <p>Risk Level: <span class="similarity">${report.summary.riskLevel}</span></p>
    </div>
    
    <div class="section">
        <h2>Summary</h2>
        <p>Total Matches: ${report.summary.totalMatches}</p>
        <p>Highest Similarity: ${(report.summary.highestSimilarity * 100).toFixed(1)}%</p>
    </div>
    
    <div class="section">
        <h2>Plagiarism Matches</h2>
        ${report.plagiarism.matches.map(match => `
            <div class="match ${match.matchType}">
                <h3>${match.source.title}</h3>
                <p>Author: ${match.source.author}</p>
                <p>Similarity: <span class="similarity">${(match.similarity * 100).toFixed(1)}%</span></p>
                <p>Source: ${match.source.url}</p>
            </div>
        `).join('')}
    </div>
    
    ${report.selfPlagiarism ? `
    <div class="section">
        <h2>Self-Plagiarism Matches</h2>
        ${report.selfPlagiarism.matches.map(match => `
            <div class="match ${match.matchType}">
                <h3>${match.source.title}</h3>
                <p>Author: ${match.source.author}</p>
                <p>Similarity: <span class="similarity">${(match.similarity * 100).toFixed(1)}%</span></p>
            </div>
        `).join('')}
    </div>
    ` : ''}
</body>
</html>`;
  }

  /**
   * Generate PDF report (placeholder)
   */
  generatePDFReport(report) {
    // This would generate a PDF report
    // For now, return HTML that can be converted to PDF
    return this.generateHTMLReport(report);
  }
}
