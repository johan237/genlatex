/**
 * GitHub Integration Module
 * Handles repository linking, cloning, and metadata extraction
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { Octokit } from '@octokit/rest';
import { getProjectPath } from './files.js';

const execAsync = promisify(exec);

export class GitHubIntegration {
  constructor(accessToken = null) {
    this.octokit = accessToken ? new Octokit({ auth: accessToken }) : new Octokit();
    this.reposPath = path.join(process.cwd(), 'data', 'repos');
  }

  /**
   * Link a GitHub repository to a project
   */
  async linkRepository(projectId, repoUrl, branch = 'main') {
    try {
      // Parse repository URL
      const repoInfo = this.parseRepoUrl(repoUrl);
      if (!repoInfo) {
        throw new Error('Invalid GitHub repository URL');
      }

      // Create project-specific directory
      const projectRepoPath = path.join(this.reposPath, projectId);
      await fs.mkdir(projectRepoPath, { recursive: true });

      // Clone repository
      await this.cloneRepository(repoInfo, projectRepoPath, branch);

      // Extract metadata
      const metadata = await this.extractRepositoryMetadata(projectRepoPath, repoInfo);

      // Store linking information
      const linkInfo = {
        linked_repo: repoUrl,
        branch,
        linked_at: new Date().toISOString(),
        metadata
      };

      await this.saveLinkInfo(projectId, linkInfo);

      return linkInfo;
    } catch (error) {
      console.error('Error linking repository:', error);
      
      // Provide better error messages for common issues
      if (error.message.includes('Repository not found')) {
        throw new Error('Repository not found. Please check the URL or use a valid access token for private repositories.');
      } else if (error.message.includes('Authentication failed')) {
        throw new Error('Authentication failed. Please check your access token.');
      } else if (error.message.includes('Permission denied')) {
        throw new Error('Permission denied. Please check your access token or repository permissions.');
      } else if (error.message.includes('Invalid GitHub repository URL')) {
        throw new Error('Invalid GitHub repository URL. Please use a valid GitHub URL.');
      } else {
        throw error; // Re-throw original error if not a common case
      }
    }
  }

  /**
   * Parse GitHub repository URL
   */
  parseRepoUrl(url) {
    const patterns = [
      /^https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\.git)?$/,
      /^git@github\.com:([^\/]+)\/([^\/]+)(?:\.git)?$/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace('.git', ''),
          fullName: `${match[1]}/${match[2].replace('.git', '')}`
        };
      }
    }
    return null;
  }

  /**
   * Clone repository to local storage
   */
  async cloneRepository(repoInfo, targetPath, branch) {
    const repoUrl = `https://github.com/${repoInfo.fullName}.git`;
    
    try {
      // Check if already cloned
      const gitDir = path.join(targetPath, '.git');
      const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
      
      if (gitExists) {
        // Update existing clone
        await execAsync(`git fetch origin && git checkout ${branch} && git pull origin ${branch}`, {
          cwd: targetPath
        });
      } else {
        // Clone new repository
        await execAsync(`git clone --branch ${branch} --depth 1 ${repoUrl} .`, {
          cwd: targetPath
        });
      }
    } catch (error) {
      // Provide better error messages based on common git errors
      if (error.message.includes('Repository not found')) {
        throw new Error('Repository not found. Please check the URL or use a valid access token for private repositories.');
      } else if (error.message.includes('Authentication failed')) {
        throw new Error('Authentication failed. Please check your access token.');
      } else if (error.message.includes('Permission denied')) {
        throw new Error('Permission denied. Please check your access token or repository permissions.');
      } else if (error.message.includes('fatal: repository')) {
        throw new Error('Repository not found. Please check the URL or use a valid access token for private repositories.');
      } else {
        throw new Error(`Failed to clone repository. Please check the URL or use a valid access token for private repositories.`);
      }
    }
  }

  /**
   * Extract comprehensive metadata from repository
   */
  async extractRepositoryMetadata(repoPath, repoInfo) {
    try {
      const metadata = {
        languages: [],
        key_files: [],
        figures: [],
        readme_summary: '',
        dependencies: [],
        structure: {},
        commit_info: null
      };

      // Get repository info from GitHub API
      try {
        const { data: repo } = await this.octokit.repos.get({
          owner: repoInfo.owner,
          repo: repoInfo.repo
        });
        
        metadata.languages = Object.keys(repo.languages || {});
        metadata.commit_info = {
          last_commit: repo.updated_at,
          default_branch: repo.default_branch,
          description: repo.description
        };
      } catch (apiError) {
        console.warn('Could not fetch GitHub API data:', apiError.message);
      }

      // Scan local files
      await this.scanRepositoryFiles(repoPath, metadata);

      return metadata;
    } catch (error) {
      console.error('Error extracting metadata:', error);
      return {};
    }
  }

  /**
   * Scan repository files for analysis
   */
  async scanRepositoryFiles(repoPath, metadata) {
    try {
      const files = await this.getAllFiles(repoPath);
      
      for (const file of files) {
        const relativePath = path.relative(repoPath, file);
        const ext = path.extname(file).toLowerCase();
        
        // Skip hidden files and build artifacts
        if (relativePath.startsWith('.') || 
            relativePath.includes('node_modules') ||
            relativePath.includes('__pycache__') ||
            relativePath.includes('.git')) {
          continue;
        }

        // Categorize files
        if (this.isKeyFile(relativePath, ext)) {
          metadata.key_files.push(relativePath);
        }

        if (this.isFigureFile(ext)) {
          metadata.figures.push(relativePath);
        }

        if (this.isDependencyFile(relativePath)) {
          const deps = await this.parseDependencies(file);
          metadata.dependencies.push(...deps);
        }

        // Extract README summary
        if (relativePath.toLowerCase().includes('readme')) {
          metadata.readme_summary = await this.extractReadmeSummary(file);
        }
      }

      // Build directory structure
      metadata.structure = await this.buildDirectoryStructure(repoPath);
    } catch (error) {
      console.error('Error scanning files:', error);
    }
  }

  /**
   * Get all files in directory recursively
   */
  async getAllFiles(dir) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          files.push(...await this.getAllFiles(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.warn(`Could not read directory ${dir}:`, error.message);
    }
    
    return files;
  }

  /**
   * Check if file is a key file for analysis
   */
  isKeyFile(relativePath, ext) {
    const keyPatterns = [
      /main\.(py|js|ts|java|cpp|c)$/i,
      /index\.(js|ts|html|php)$/i,
      /app\.(py|js|ts)$/i,
      /\.ipynb$/,
      /\.(py|js|ts|java|cpp|c|r|m)$/,
      /\.(md|txt)$/
    ];

    return keyPatterns.some(pattern => pattern.test(relativePath));
  }

  /**
   * Check if file is a figure/image
   */
  isFigureFile(ext) {
    const figureExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.eps', '.tiff'];
    return figureExts.includes(ext);
  }

  /**
   * Check if file contains dependency information
   */
  isDependencyFile(relativePath) {
    const depFiles = [
      'package.json', 'requirements.txt', 'Pipfile', 'environment.yml',
      'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json',
      'Gemfile', 'go.mod', 'pubspec.yaml'
    ];
    
    return depFiles.some(dep => relativePath.endsWith(dep));
  }

  /**
   * Parse dependencies from file
   */
  async parseDependencies(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath);
      
      switch (ext) {
        case '.json':
          if (filePath.endsWith('package.json')) {
            const pkg = JSON.parse(content);
            return Object.keys(pkg.dependencies || {}).concat(
              Object.keys(pkg.devDependencies || {})
            );
          }
          break;
        case '.txt':
          if (filePath.endsWith('requirements.txt')) {
            return content.split('\n')
              .filter(line => line.trim() && !line.startsWith('#'))
              .map(line => line.split('==')[0].split('>=')[0].trim());
          }
          break;
      }
    } catch (error) {
      console.warn(`Could not parse dependencies from ${filePath}:`, error.message);
    }
    
    return [];
  }

  /**
   * Extract summary from README
   */
  async extractReadmeSummary(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').slice(0, 10); // First 10 lines
      return lines.join(' ').substring(0, 200) + '...';
    } catch (error) {
      return '';
    }
  }

  /**
   * Build directory structure representation
   */
  async buildDirectoryStructure(repoPath) {
    const structure = {};
    
    try {
      const buildStructure = async (dir, currentLevel = structure) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') {
            continue;
          }
          
          if (entry.isDirectory()) {
            currentLevel[entry.name] = {};
            await buildStructure(path.join(dir, entry.name), currentLevel[entry.name]);
          } else {
            currentLevel[entry.name] = 'file';
          }
        }
      };
      
      await buildStructure(repoPath);
    } catch (error) {
      console.warn('Could not build directory structure:', error.message);
    }
    
    return structure;
  }

  /**
   * Save linking information
   */
  async saveLinkInfo(projectId, linkInfo) {
    const linkInfoPath = path.join(path.resolve(process.cwd(), getProjectPath(undefined, projectId)), 'github-link.json');
    await fs.mkdir(path.dirname(linkInfoPath), { recursive: true });
    await fs.writeFile(linkInfoPath, JSON.stringify(linkInfo, null, 2));
  }

  /**
   * Get linked repository information
   */
  async getLinkInfo(projectId) {
    try {
      const linkInfoPath = path.join(path.resolve(process.cwd(), getProjectPath(undefined, projectId)), 'github-link.json');
      const content = await fs.readFile(linkInfoPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Update linked repository
   */
  async updateRepository(projectId) {
    const linkInfo = await this.getLinkInfo(projectId);
    if (!linkInfo) {
      throw new Error('No linked repository found');
    }

    const repoInfo = this.parseRepoUrl(linkInfo.linked_repo);
    const projectRepoPath = path.join(this.reposPath, projectId);
    
    // Pull latest changes
    await execAsync(`git pull origin ${linkInfo.branch}`, {
      cwd: projectRepoPath
    });

    // Update metadata
    const updatedMetadata = await this.extractRepositoryMetadata(projectRepoPath, repoInfo);
    linkInfo.metadata = updatedMetadata;
    linkInfo.updated_at = new Date().toISOString();

    await this.saveLinkInfo(projectId, linkInfo);
    return linkInfo;
  }

  /**
   * Unlink repository
   */
  async unlinkRepository(projectId) {
    try {
      // Remove local repository
      const projectRepoPath = path.join(this.reposPath, projectId);
      await fs.rm(projectRepoPath, { recursive: true, force: true });

      // Remove link info
      const linkInfoPath = path.join(path.resolve(process.cwd(), getProjectPath(undefined, projectId)), 'github-link.json');
      await fs.rm(linkInfoPath, { force: true });

      return true;
    } catch (error) {
      console.error('Error unlinking repository:', error);
      return false;
    }
  }

  /**
   * Extract repository content for memory enrichment
   * @param {string} repoPath - Path to cloned repository
   * @returns {object} Extracted repository content
   */
  async extractRepositoryContent(repoPath) {
    const result = {
      readme: null,
      files: [],
      extractedMethods: [],
      extractedFrameworks: []
    };

    try {
      // Read README files
      const readmeFiles = ['README.md', 'README.txt', 'readme.md', 'Readme.md', 'README'];
      for (const readmeFile of readmeFiles) {
        try {
          const readmePath = path.join(repoPath, readmeFile);
          result.readme = await fs.readFile(readmePath, 'utf-8');
          console.log(`✅ Found README: ${readmeFile}`);
          break;
        } catch {
          // Continue if file doesn't exist
        }
      }

      // Find important files
      const importantExtensions = ['.py', '.js', '.ts', '.md', '.txt', '.json', '.yaml', '.yml', '.r', '.m', '.java', '.cpp', '.c'];
      const importantFiles = await this.findImportantFiles(repoPath, importantExtensions, 50);

      console.log(`📁 Found ${importantFiles.length} important files`);

      // Process files
      for (const filePath of importantFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const relativePath = path.relative(repoPath, filePath);
          const ext = path.extname(filePath);

          result.files.push({
            path: relativePath,
            content: content.substring(0, 10000), // Limit content size
            type: this.determineFileType(filePath),
            language: ext.substring(1)
          });
        } catch (error) {
          console.warn(`Failed to read file ${filePath}:`, error.message);
        }
      }

      // Extract methods and frameworks
      result.extractedMethods = this.extractMethods(result.files);
      result.extractedFrameworks = this.extractFrameworks(result.files);

      console.log(`🔍 Extracted ${result.extractedMethods.length} methods and ${result.extractedFrameworks.length} frameworks`);

      return result;
    } catch (error) {
      console.error('Error extracting repository content:', error);
      return result;
    }
  }

  /**
   * Find important files in repository
   * @param {string} dir - Directory to search
   * @param {array} extensions - File extensions to include
   * @param {number} maxFiles - Maximum number of files to return
   * @returns {Promise<array>} Array of file paths
   */
  async findImportantFiles(dir, extensions, maxFiles = 50) {
    const files = [];
    const ignoreDirs = ['node_modules', '.git', '__pycache__', 'venv', 'env', 'dist', 'build', '.next'];

    const walkDir = async (currentPath, depth = 0) => {
      if (files.length >= maxFiles || depth > 5) return;

      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          if (files.length >= maxFiles) break;

          const fullPath = path.join(currentPath, entry.name);

          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              await walkDir(fullPath, depth + 1);
            }
          } else {
            const ext = path.extname(entry.name);
            if (extensions.includes(ext)) {
              files.push(fullPath);
            }
          }
        }
      } catch (error) {
        console.warn(`Could not read directory ${currentPath}:`, error.message);
      }
    };

    await walkDir(dir);
    return files;
  }

  /**
   * Determine file type
   * @param {string} filePath - File path
   * @returns {string} File type (documentation or code)
   */
  determineFileType(filePath) {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath).toLowerCase();

    if (['.md', '.txt', '.rst'].includes(ext) || fileName.includes('readme')) {
      return 'documentation';
    }

    return 'code';
  }

  /**
   * Extract method and function names from code files
   * @param {array} files - Array of file objects
   * @returns {array} Array of method names
   */
  extractMethods(files) {
    const methods = [];

    for (const file of files) {
      if (file.type !== 'code') continue;

      const { content, language } = file;

      // Python: def function_name
      if (language === 'py') {
        const matches = content.matchAll(/def\s+(\w+)\s*\(/g);
        for (const match of matches) {
          methods.push({ name: match[1], language: 'python', file: file.path });
        }

        // Python classes
        const classMatches = content.matchAll(/class\s+(\w+)[\s:(/]/g);
        for (const match of classMatches) {
          methods.push({ name: match[1], language: 'python', type: 'class', file: file.path });
        }
      }

      // JavaScript/TypeScript: function name, const name =, class Name
      if (['js', 'ts', 'jsx', 'tsx'].includes(language)) {
        const fnMatches = content.matchAll(/(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g);
        for (const match of fnMatches) {
          const name = match[1] || match[2];
          methods.push({ name, language: 'javascript', file: file.path });
        }

        const classMatches = content.matchAll(/class\s+(\w+)[\s{]/g);
        for (const match of classMatches) {
          methods.push({ name: match[1], language: 'javascript', type: 'class', file: file.path });
        }
      }

      // Java/C++/C: class and function declarations
      if (['java', 'cpp', 'c'].includes(language)) {
        const classMatches = content.matchAll(/class\s+(\w+)[\s{]/g);
        for (const match of classMatches) {
          methods.push({ name: match[1], language, type: 'class', file: file.path });
        }
      }
    }

    // Deduplicate and limit
    const uniqueMethods = [...new Map(methods.map(m => [m.name, m])).values()];
    return uniqueMethods.slice(0, 100);
  }

  /**
   * Extract framework and library names
   * @param {array} files - Array of file objects
   * @returns {array} Array of framework names
   */
  extractFrameworks(files) {
    const frameworks = new Set();

    for (const file of files) {
      const { content, path: filePath } = file;

      // Check package.json
      if (filePath.includes('package.json')) {
        try {
          const pkg = JSON.parse(content);
          if (pkg.dependencies) {
            Object.keys(pkg.dependencies).forEach(dep => frameworks.add(dep));
          }
          if (pkg.devDependencies) {
            Object.keys(pkg.devDependencies).forEach(dep => frameworks.add(dep));
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Check requirements.txt
      if (filePath.includes('requirements.txt')) {
        const lines = content.split('\n');
        for (const line of lines) {
          const match = line.match(/^([a-zA-Z0-9-_]+)/);
          if (match) {
            frameworks.add(match[1]);
          }
        }
      }

      // Extract Python imports
      if (file.language === 'py') {
        const importMatches = content.matchAll(/(?:import|from)\s+([a-zA-Z0-9_]+)/g);
        for (const match of importMatches) {
          frameworks.add(match[1]);
        }
      }

      // Extract JavaScript imports
      if (['js', 'ts', 'jsx', 'tsx'].includes(file.language)) {
        const importMatches = content.matchAll(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
        for (const match of importMatches) {
          const pkg = match[1].split('/')[0];
          if (!pkg.startsWith('.')) {
            frameworks.add(pkg);
          }
        }
      }
    }

    return Array.from(frameworks).slice(0, 50);
  }
}
