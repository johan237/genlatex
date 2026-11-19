/**
 * Research Analytics and Productivity Dashboard
 * Tracks research productivity, writing patterns, and project metrics
 */

import fs from 'fs/promises';
import path from 'path';

export class AnalyticsDashboard {
  constructor() {
    this.metrics = new Map();
    this.loadMetrics();
  }

  /**
   * Load existing metrics. Creates data/ and analytics.json if missing.
   */
  async loadMetrics() {
    const dataDir = path.join(process.cwd(), 'data');
    const metricsPath = path.join(dataDir, 'analytics.json');
    try {
      const content = await fs.readFile(metricsPath, 'utf-8');
      const data = JSON.parse(content);
      for (const [key, value] of Object.entries(data)) {
        this.metrics.set(key, value);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        try {
          await fs.mkdir(dataDir, { recursive: true });
          await fs.writeFile(metricsPath, '{}', 'utf-8');
        } catch (initErr) {
          // Ignore; metrics will stay empty
        }
      }
      // Other errors (e.g. invalid JSON): metrics stay empty, no console spam
    }
  }

  /**
   * Save metrics
   */
  async saveMetrics() {
    try {
      const metricsPath = path.join(process.cwd(), 'data', 'analytics.json');
      const data = Object.fromEntries(this.metrics);
      await fs.writeFile(metricsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn('Could not save analytics data:', error.message);
    }
  }

  /**
   * Track writing activity
   */
  async trackWritingActivity(projectId, activity) {
    try {
      const key = `writing_${projectId}`;
      const existing = this.metrics.get(key) || {
        projectId,
        totalWords: 0,
        totalCharacters: 0,
        totalLines: 0,
        sessions: [],
        dailyStats: {},
        weeklyStats: {},
        monthlyStats: {}
      };

      // Update totals
      existing.totalWords += activity.wordsAdded || 0;
      existing.totalCharacters += activity.charactersAdded || 0;
      existing.totalLines += activity.linesAdded || 0;

      // Add session
      existing.sessions.push({
        timestamp: new Date().toISOString(),
        duration: activity.duration || 0,
        wordsAdded: activity.wordsAdded || 0,
        charactersAdded: activity.charactersAdded || 0,
        linesAdded: activity.linesAdded || 0,
        actions: activity.actions || []
      });

      // Update daily stats
      const today = new Date().toISOString().split('T')[0];
      if (!existing.dailyStats[today]) {
        existing.dailyStats[today] = {
          words: 0,
          characters: 0,
          lines: 0,
          sessions: 0,
          duration: 0
        };
      }
      existing.dailyStats[today].words += activity.wordsAdded || 0;
      existing.dailyStats[today].characters += activity.charactersAdded || 0;
      existing.dailyStats[today].lines += activity.linesAdded || 0;
      existing.dailyStats[today].sessions += 1;
      existing.dailyStats[today].duration += activity.duration || 0;

      // Update weekly stats
      const weekStart = this.getWeekStart(new Date());
      const weekKey = weekStart.toISOString().split('T')[0];
      if (!existing.weeklyStats[weekKey]) {
        existing.weeklyStats[weekKey] = {
          words: 0,
          characters: 0,
          lines: 0,
          sessions: 0,
          duration: 0
        };
      }
      existing.weeklyStats[weekKey].words += activity.wordsAdded || 0;
      existing.weeklyStats[weekKey].characters += activity.charactersAdded || 0;
      existing.weeklyStats[weekKey].lines += activity.linesAdded || 0;
      existing.weeklyStats[weekKey].sessions += 1;
      existing.weeklyStats[weekKey].duration += activity.duration || 0;

      // Update monthly stats
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const monthKey = monthStart.toISOString().split('T')[0];
      if (!existing.monthlyStats[monthKey]) {
        existing.monthlyStats[monthKey] = {
          words: 0,
          characters: 0,
          lines: 0,
          sessions: 0,
          duration: 0
        };
      }
      existing.monthlyStats[monthKey].words += activity.wordsAdded || 0;
      existing.monthlyStats[monthKey].characters += activity.charactersAdded || 0;
      existing.monthlyStats[monthKey].lines += activity.linesAdded || 0;
      existing.monthlyStats[monthKey].sessions += 1;
      existing.monthlyStats[monthKey].duration += activity.duration || 0;

      this.metrics.set(key, existing);
      await this.saveMetrics();

      return {
        success: true,
        message: 'Writing activity tracked'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Track compilation activity
   */
  async trackCompilationActivity(projectId, activity) {
    try {
      const key = `compilation_${projectId}`;
      const existing = this.metrics.get(key) || {
        projectId,
        totalCompilations: 0,
        successfulCompilations: 0,
        failedCompilations: 0,
        averageCompilationTime: 0,
        compilationHistory: [],
        errorPatterns: {}
      };

      // Update totals
      existing.totalCompilations += 1;
      if (activity.success) {
        existing.successfulCompilations += 1;
      } else {
        existing.failedCompilations += 1;
      }

      // Update average compilation time
      const totalTime = existing.averageCompilationTime * (existing.totalCompilations - 1) + (activity.duration || 0);
      existing.averageCompilationTime = totalTime / existing.totalCompilations;

      // Add to history
      existing.compilationHistory.push({
        timestamp: new Date().toISOString(),
        success: activity.success,
        duration: activity.duration || 0,
        errors: activity.errors || [],
        warnings: activity.warnings || []
      });

      // Track error patterns
      if (activity.errors && activity.errors.length > 0) {
        for (const error of activity.errors) {
          const errorType = this.categorizeError(error);
          existing.errorPatterns[errorType] = (existing.errorPatterns[errorType] || 0) + 1;
        }
      }

      // Keep only last 100 compilations
      if (existing.compilationHistory.length > 100) {
        existing.compilationHistory = existing.compilationHistory.slice(-100);
      }

      this.metrics.set(key, existing);
      await this.saveMetrics();

      return {
        success: true,
        message: 'Compilation activity tracked'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Track research activity
   */
  async trackResearchActivity(projectId, activity) {
    try {
      const key = `research_${projectId}`;
      const existing = this.metrics.get(key) || {
        projectId,
        totalReferences: 0,
        totalCitations: 0,
        researchSessions: [],
        sourceTypes: {},
        citationPatterns: {}
      };

      // Update totals
      existing.totalReferences += activity.referencesAdded || 0;
      existing.totalCitations += activity.citationsAdded || 0;

      // Add research session
      existing.researchSessions.push({
        timestamp: new Date().toISOString(),
        duration: activity.duration || 0,
        referencesAdded: activity.referencesAdded || 0,
        citationsAdded: activity.citationsAdded || 0,
        sources: activity.sources || []
      });

      // Track source types
      if (activity.sources) {
        for (const source of activity.sources) {
          const sourceType = source.type || 'unknown';
          existing.sourceTypes[sourceType] = (existing.sourceTypes[sourceType] || 0) + 1;
        }
      }

      this.metrics.set(key, existing);
      await this.saveMetrics();

      return {
        success: true,
        message: 'Research activity tracked'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get project analytics
   */
  async getProjectAnalytics(projectId) {
    try {
      const writingKey = `writing_${projectId}`;
      const compilationKey = `compilation_${projectId}`;
      const researchKey = `research_${projectId}`;

      const writingData = this.metrics.get(writingKey);
      const compilationData = this.metrics.get(compilationKey);
      const researchData = this.metrics.get(researchKey);

      const analytics = {
        projectId,
        writing: writingData || this.getDefaultWritingStats(),
        compilation: compilationData || this.getDefaultCompilationStats(),
        research: researchData || this.getDefaultResearchStats(),
        productivity: this.calculateProductivityMetrics(writingData, compilationData, researchData),
        trends: this.calculateTrends(writingData, compilationData, researchData)
      };

      return {
        success: true,
        analytics
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get global analytics
   */
  async getGlobalAnalytics() {
    try {
      const allProjects = Array.from(this.metrics.keys())
        .filter(key => key.startsWith('writing_'))
        .map(key => key.replace('writing_', ''));

      const globalStats = {
        totalProjects: allProjects.length,
        totalWords: 0,
        totalCharacters: 0,
        totalCompilations: 0,
        totalReferences: 0,
        activeProjects: 0,
        productivityTrends: {},
        topProjects: []
      };

      const projectStats = [];

      for (const projectId of allProjects) {
        const projectAnalytics = await this.getProjectAnalytics(projectId);
        if (projectAnalytics.success) {
          const stats = projectAnalytics.analytics;
          
          globalStats.totalWords += stats.writing.totalWords;
          globalStats.totalCharacters += stats.writing.totalCharacters;
          globalStats.totalCompilations += stats.compilation.totalCompilations;
          globalStats.totalReferences += stats.research.totalReferences;

          // Check if project is active (activity in last 7 days)
          const lastActivity = this.getLastActivityDate(stats.writing);
          const daysSinceActivity = (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
          if (daysSinceActivity <= 7) {
            globalStats.activeProjects += 1;
          }

          projectStats.push({
            projectId,
            words: stats.writing.totalWords,
            characters: stats.writing.totalCharacters,
            compilations: stats.compilation.totalCompilations,
            references: stats.research.totalReferences,
            lastActivity: lastActivity
          });
        }
      }

      // Sort projects by activity
      projectStats.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
      globalStats.topProjects = projectStats.slice(0, 10);

      return {
        success: true,
        globalStats
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get productivity insights
   */
  async getProductivityInsights(projectId) {
    try {
      const analytics = await this.getProjectAnalytics(projectId);
      if (!analytics.success) {
        return analytics;
      }

      const insights = {
        projectId,
        writingStreak: this.calculateWritingStreak(analytics.analytics.writing),
        bestWritingTime: this.findBestWritingTime(analytics.analytics.writing),
        compilationSuccessRate: this.calculateCompilationSuccessRate(analytics.analytics.compilation),
        researchEfficiency: this.calculateResearchEfficiency(analytics.analytics.research),
        recommendations: this.generateRecommendations(analytics.analytics)
      };

      return {
        success: true,
        insights
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate productivity report
   */
  async generateProductivityReport(projectId, period = 'month') {
    try {
      const analytics = await this.getProjectAnalytics(projectId);
      if (!analytics.success) {
        return analytics;
      }

      const report = {
        projectId,
        period,
        generatedAt: new Date().toISOString(),
        summary: this.generateSummary(analytics.analytics, period),
        detailedStats: this.getDetailedStats(analytics.analytics, period),
        comparisons: this.generateComparisons(analytics.analytics, period),
        goals: this.generateGoals(analytics.analytics, period)
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
   * Helper methods
   */
  getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day;
    return new Date(d.setDate(diff));
  }

  categorizeError(error) {
    if (error.includes('undefined control sequence')) return 'undefined_control_sequence';
    if (error.includes('missing')) return 'missing_element';
    if (error.includes('extra')) return 'extra_element';
    if (error.includes('overfull')) return 'overfull_box';
    if (error.includes('underfull')) return 'underfull_box';
    return 'other';
  }

  getDefaultWritingStats() {
    return {
      totalWords: 0,
      totalCharacters: 0,
      totalLines: 0,
      sessions: [],
      dailyStats: {},
      weeklyStats: {},
      monthlyStats: {}
    };
  }

  getDefaultCompilationStats() {
    return {
      totalCompilations: 0,
      successfulCompilations: 0,
      failedCompilations: 0,
      averageCompilationTime: 0,
      compilationHistory: [],
      errorPatterns: {}
    };
  }

  getDefaultResearchStats() {
    return {
      totalReferences: 0,
      totalCitations: 0,
      researchSessions: [],
      sourceTypes: {},
      citationPatterns: {}
    };
  }

  calculateProductivityMetrics(writingData, compilationData, researchData) {
    const writing = writingData || this.getDefaultWritingStats();
    const compilation = compilationData || this.getDefaultCompilationStats();
    const research = researchData || this.getDefaultResearchStats();

    return {
      wordsPerHour: this.calculateWordsPerHour(writing),
      compilationSuccessRate: compilation.totalCompilations > 0 ? 
        (compilation.successfulCompilations / compilation.totalCompilations) * 100 : 0,
      researchEfficiency: research.totalReferences > 0 ? 
        research.totalCitations / research.totalReferences : 0,
      overallScore: this.calculateOverallScore(writing, compilation, research)
    };
  }

  calculateWordsPerHour(writingData) {
    if (writingData.sessions.length === 0) return 0;
    
    const totalWords = writingData.sessions.reduce((sum, session) => sum + session.wordsAdded, 0);
    const totalHours = writingData.sessions.reduce((sum, session) => sum + session.duration, 0) / 3600;
    
    return totalHours > 0 ? totalWords / totalHours : 0;
  }

  calculateOverallScore(writing, compilation, research) {
    const writingScore = Math.min(writing.totalWords / 1000, 1) * 40; // Max 40 points
    const compilationScore = compilation.totalCompilations > 0 ? 
      (compilation.successfulCompilations / compilation.totalCompilations) * 30 : 0; // Max 30 points
    const researchScore = Math.min(research.totalReferences / 50, 1) * 30; // Max 30 points
    
    return Math.round(writingScore + compilationScore + researchScore);
  }

  calculateTrends(writingData, compilationData, researchData) {
    const writing = writingData || this.getDefaultWritingStats();
    const compilation = compilationData || this.getDefaultCompilationStats();
    const research = researchData || this.getDefaultResearchStats();

    return {
      writingTrend: this.calculateWritingTrend(writing),
      compilationTrend: this.calculateCompilationTrend(compilation),
      researchTrend: this.calculateResearchTrend(research)
    };
  }

  calculateWritingTrend(writingData) {
    const dailyStats = Object.entries(writingData.dailyStats)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .slice(-7); // Last 7 days
    
    if (dailyStats.length < 2) return 'stable';
    
    const recent = dailyStats.slice(-3).reduce((sum, [, stats]) => sum + stats.words, 0);
    const previous = dailyStats.slice(-6, -3).reduce((sum, [, stats]) => sum + stats.words, 0);
    
    if (recent > previous * 1.2) return 'increasing';
    if (recent < previous * 0.8) return 'decreasing';
    return 'stable';
  }

  calculateCompilationTrend(compilationData) {
    const recent = compilationData.compilationHistory.slice(-10);
    if (recent.length < 5) return 'stable';
    
    const recentSuccess = recent.filter(c => c.success).length / recent.length;
    const overallSuccess = compilationData.successfulCompilations / compilationData.totalCompilations;
    
    if (recentSuccess > overallSuccess * 1.1) return 'improving';
    if (recentSuccess < overallSuccess * 0.9) return 'declining';
    return 'stable';
  }

  calculateResearchTrend(researchData) {
    const recent = researchData.researchSessions.slice(-7);
    if (recent.length < 3) return 'stable';
    
    const recentActivity = recent.reduce((sum, session) => sum + session.referencesAdded, 0);
    const previousActivity = researchData.researchSessions.slice(-14, -7)
      .reduce((sum, session) => sum + session.referencesAdded, 0);
    
    if (recentActivity > previousActivity * 1.2) return 'increasing';
    if (recentActivity < previousActivity * 0.8) return 'decreasing';
    return 'stable';
  }

  getLastActivityDate(writingData) {
    if (writingData.sessions.length === 0) return new Date().toISOString();
    return writingData.sessions[writingData.sessions.length - 1].timestamp;
  }

  calculateWritingStreak(writingData) {
    const dailyStats = Object.entries(writingData.dailyStats)
      .sort(([a], [b]) => new Date(b) - new Date(a));
    
    let streak = 0;
    const today = new Date().toISOString().split('T')[0];
    
    for (const [date, stats] of dailyStats) {
      if (stats.words > 0) {
        streak += 1;
      } else {
        break;
      }
    }
    
    return streak;
  }

  findBestWritingTime(writingData) {
    const hourlyStats = {};
    
    for (const session of writingData.sessions) {
      const hour = new Date(session.timestamp).getHours();
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { words: 0, sessions: 0 };
      }
      hourlyStats[hour].words += session.wordsAdded;
      hourlyStats[hour].sessions += 1;
    }
    
    let bestHour = 0;
    let bestProductivity = 0;
    
    for (const [hour, stats] of Object.entries(hourlyStats)) {
      const productivity = stats.words / stats.sessions;
      if (productivity > bestProductivity) {
        bestProductivity = productivity;
        bestHour = parseInt(hour);
      }
    }
    
    return {
      hour: bestHour,
      productivity: bestProductivity,
      formatted: `${bestHour}:00 - ${bestHour + 1}:00`
    };
  }

  calculateCompilationSuccessRate(compilationData) {
    if (compilationData.totalCompilations === 0) return 0;
    return (compilationData.successfulCompilations / compilationData.totalCompilations) * 100;
  }

  calculateResearchEfficiency(researchData) {
    if (researchData.totalReferences === 0) return 0;
    return researchData.totalCitations / researchData.totalReferences;
  }

  generateRecommendations(analytics) {
    const recommendations = [];
    
    // Writing recommendations
    if (analytics.writing.totalWords < 1000) {
      recommendations.push({
        type: 'writing',
        message: 'Consider setting a daily writing goal to increase productivity',
        priority: 'high'
      });
    }
    
    // Compilation recommendations
    if (analytics.compilation.totalCompilations > 0) {
      const successRate = analytics.compilation.successfulCompilations / analytics.compilation.totalCompilations;
      if (successRate < 0.8) {
        recommendations.push({
          type: 'compilation',
          message: 'Your compilation success rate is low. Consider using the LaTeX linter to catch errors early',
          priority: 'medium'
        });
      }
    }
    
    // Research recommendations
    if (analytics.research.totalReferences < 10) {
      recommendations.push({
        type: 'research',
        message: 'Add more references to strengthen your work',
        priority: 'medium'
      });
    }
    
    return recommendations;
  }

  generateSummary(analytics, period) {
    return {
      totalWords: analytics.writing.totalWords,
      totalCompilations: analytics.compilation.totalCompilations,
      totalReferences: analytics.research.totalReferences,
      productivityScore: analytics.productivity.overallScore,
      trends: analytics.trends
    };
  }

  getDetailedStats(analytics, period) {
    const stats = {
      writing: analytics.writing,
      compilation: analytics.compilation,
      research: analytics.research,
      productivity: analytics.productivity
    };
    
    // Filter by period if needed
    if (period !== 'all') {
      // Implementation would filter stats by period
    }
    
    return stats;
  }

  generateComparisons(analytics, period) {
    return {
      vsPreviousPeriod: 'Not implemented',
      vsAverage: 'Not implemented',
      vsBest: 'Not implemented'
    };
  }

  generateGoals(analytics, period) {
    return {
      writingGoal: Math.max(1000, analytics.writing.totalWords * 1.2),
      compilationGoal: Math.max(10, analytics.compilation.totalCompilations * 1.1),
      researchGoal: Math.max(20, analytics.research.totalReferences * 1.3)
    };
  }
}
