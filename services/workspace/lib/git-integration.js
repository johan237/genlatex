/**
 * Git Integration for Version Control
 * Provides Git functionality for paper version control and collaboration
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

const execAsync = promisify(exec);

export class GitIntegration {
  constructor() {
    this.repositories = new Map();
  }

  /**
   * Initialize Git repository for project
   */
  async initRepository(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      // Check if already a git repository
      const gitDir = path.join(projectPath, '.git');
      const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
      
      if (gitExists) {
        return {
          success: true,
          message: 'Git repository already initialized',
          isNew: false
        };
      }

      // Initialize git repository
      await execAsync('git init', { cwd: projectPath });
      
      // Create initial commit
      await execAsync('git add .', { cwd: projectPath });
      await execAsync('git commit -m "Initial commit"', { cwd: projectPath });

      // Store repository info
      this.repositories.set(projectId, {
        path: projectPath,
        initialized: true,
        initializedAt: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Git repository initialized successfully',
        isNew: true
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get repository status
   */
  async getStatus(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      // Check if git repository exists
      const gitDir = path.join(projectPath, '.git');
      const gitExists = await fs.access(gitDir).then(() => true).catch(() => false);
      
      if (!gitExists) {
        return {
          success: false,
          error: 'Not a git repository'
        };
      }

      // Get git status
      const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
      const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: projectPath });
      const { stdout: commitOutput } = await execAsync('git log --oneline -1', { cwd: projectPath });

      const status = {
        branch: branchOutput.trim(),
        lastCommit: commitOutput.trim(),
        changes: this.parseStatusOutput(statusOutput),
        hasChanges: statusOutput.trim().length > 0
      };

      return {
        success: true,
        status
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Stage files for commit
   */
  async stageFiles(projectId, files = []) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      if (files.length === 0) {
        // Stage all changes
        await execAsync('git add .', { cwd: projectPath });
      } else {
        // Stage specific files
        for (const file of files) {
          await execAsync(`git add "${file}"`, { cwd: projectPath });
        }
      }

      return {
        success: true,
        message: 'Files staged successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create commit
   */
  async createCommit(projectId, message, author = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      // Set author if provided
      if (author) {
        await execAsync(`git config user.name "${author.name}"`, { cwd: projectPath });
        await execAsync(`git config user.email "${author.email}"`, { cwd: projectPath });
      }

      // Create commit
      await execAsync(`git commit -m "${message}"`, { cwd: projectPath });

      // Get commit hash
      const { stdout: commitHash } = await execAsync('git rev-parse HEAD', { cwd: projectPath });

      return {
        success: true,
        commitHash: commitHash.trim(),
        message: 'Commit created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get commit history
   */
  async getCommitHistory(projectId, limit = 20) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: logOutput } = await execAsync(
        `git log --oneline --pretty=format:"%h|%s|%an|%ad" --date=iso -${limit}`,
        { cwd: projectPath }
      );

      const commits = logOutput.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [hash, message, author, date] = line.split('|');
          return {
            hash,
            message,
            author,
            date: new Date(date).toISOString()
          };
        });

      return {
        success: true,
        commits,
        totalCommits: commits.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get commit details
   */
  async getCommitDetails(projectId, commitHash) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: commitInfo } = await execAsync(
        `git show --pretty=format:"%H|%s|%an|%ae|%ad|%b" --date=iso ${commitHash}`,
        { cwd: projectPath }
      );

      const { stdout: diffOutput } = await execAsync(
        `git show --stat ${commitHash}`,
        { cwd: projectPath }
      );

      const lines = commitInfo.split('\n');
      const [hash, subject, authorName, authorEmail, date, ...bodyLines] = lines[0].split('|');
      
      const commit = {
        hash,
        subject,
        author: {
          name: authorName,
          email: authorEmail
        },
        date: new Date(date).toISOString(),
        body: bodyLines.join('|'),
        diff: diffOutput,
        filesChanged: this.parseDiffStats(diffOutput)
      };

      return {
        success: true,
        commit
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create branch
   */
  async createBranch(projectId, branchName) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      await execAsync(`git checkout -b ${branchName}`, { cwd: projectPath });

      return {
        success: true,
        message: `Branch '${branchName}' created successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Switch branch
   */
  async switchBranch(projectId, branchName) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      await execAsync(`git checkout ${branchName}`, { cwd: projectPath });

      return {
        success: true,
        message: `Switched to branch '${branchName}'`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get branches
   */
  async getBranches(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: branchesOutput } = await execAsync('git branch -a', { cwd: projectPath });
      const { stdout: currentBranch } = await execAsync('git branch --show-current', { cwd: projectPath });

      const branches = branchesOutput.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const name = line.replace(/^\*\s*/, '').trim();
          const isCurrent = line.startsWith('*');
          const isRemote = line.includes('remotes/');
          
          return {
            name,
            isCurrent,
            isRemote,
            displayName: isRemote ? name.replace('remotes/origin/', '') : name
          };
        });

      return {
        success: true,
        branches,
        currentBranch: currentBranch.trim()
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Merge branch
   */
  async mergeBranch(projectId, branchName, message = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const mergeMessage = message || `Merge branch '${branchName}'`;
      await execAsync(`git merge ${branchName} -m "${mergeMessage}"`, { cwd: projectPath });

      return {
        success: true,
        message: `Branch '${branchName}' merged successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        hasConflicts: error.message.includes('conflict')
      };
    }
  }

  /**
   * Add remote repository
   */
  async addRemote(projectId, name, url) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      await execAsync(`git remote add ${name} ${url}`, { cwd: projectPath });

      return {
        success: true,
        message: `Remote '${name}' added successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get remotes
   */
  async getRemotes(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: remotesOutput } = await execAsync('git remote -v', { cwd: projectPath });

      const remotes = remotesOutput.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [name, url, type] = line.split('\t');
          return {
            name: name.trim(),
            url: url.trim(),
            type: type === '(fetch)' ? 'fetch' : 'push'
          };
        });

      // Group by name
      const remoteMap = new Map();
      for (const remote of remotes) {
        if (!remoteMap.has(remote.name)) {
          remoteMap.set(remote.name, {
            name: remote.name,
            fetchUrl: null,
            pushUrl: null
          });
        }
        
        const existing = remoteMap.get(remote.name);
        if (remote.type === 'fetch') {
          existing.fetchUrl = remote.url;
        } else {
          existing.pushUrl = remote.url;
        }
      }

      return {
        success: true,
        remotes: Array.from(remoteMap.values())
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Push to remote
   */
  async pushToRemote(projectId, remote = 'origin', branch = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const pushCommand = branch ? `git push ${remote} ${branch}` : `git push ${remote}`;
      await execAsync(pushCommand, { cwd: projectPath });

      return {
        success: true,
        message: 'Pushed to remote successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Pull from remote
   */
  async pullFromRemote(projectId, remote = 'origin', branch = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const pullCommand = branch ? `git pull ${remote} ${branch}` : `git pull ${remote}`;
      await execAsync(pullCommand, { cwd: projectPath });

      return {
        success: true,
        message: 'Pulled from remote successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Create tag
   */
  async createTag(projectId, tagName, message = null) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const tagCommand = message ? 
        `git tag -a ${tagName} -m "${message}"` : 
        `git tag ${tagName}`;
      
      await execAsync(tagCommand, { cwd: projectPath });

      return {
        success: true,
        message: `Tag '${tagName}' created successfully`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get tags
   */
  async getTags(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: tagsOutput } = await execAsync('git tag -l', { cwd: projectPath });

      const tags = tagsOutput.split('\n')
        .filter(line => line.trim())
        .map(tag => tag.trim());

      return {
        success: true,
        tags
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Revert commit
   */
  async revertCommit(projectId, commitHash) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      await execAsync(`git revert ${commitHash} --no-edit`, { cwd: projectPath });

      return {
        success: true,
        message: 'Commit reverted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reset to commit
   */
  async resetToCommit(projectId, commitHash, mode = 'soft') {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      await execAsync(`git reset --${mode} ${commitHash}`, { cwd: projectPath });

      return {
        success: true,
        message: `Reset to commit ${commitHash} (${mode} mode)`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get file history
   */
  async getFileHistory(projectId, filePath) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: logOutput } = await execAsync(
        `git log --oneline --pretty=format:"%h|%s|%an|%ad" --date=iso -- "${filePath}"`,
        { cwd: projectPath }
      );

      const commits = logOutput.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const [hash, message, author, date] = line.split('|');
          return {
            hash,
            message,
            author,
            date: new Date(date).toISOString()
          };
        });

      return {
        success: true,
        commits,
        filePath
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Compare commits
   */
  async compareCommits(projectId, commit1, commit2) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const { stdout: diffOutput } = await execAsync(
        `git diff ${commit1} ${commit2}`,
        { cwd: projectPath }
      );

      const { stdout: statOutput } = await execAsync(
        `git diff --stat ${commit1} ${commit2}`,
        { cwd: projectPath }
      );

      return {
        success: true,
        diff: diffOutput,
        stats: this.parseDiffStats(statOutput),
        commit1,
        commit2
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse git status output
   */
  parseStatusOutput(output) {
    const changes = [];
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      
      changes.push({
        file,
        status: {
          staged: status[0] !== ' ',
          unstaged: status[1] !== ' ',
          stagedStatus: status[0],
          unstagedStatus: status[1]
        }
      });
    }
    
    return changes;
  }

  /**
   * Parse diff statistics
   */
  parseDiffStats(output) {
    const stats = {
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      files: []
    };
    
    const lines = output.split('\n').filter(line => line.trim());
    
    for (const line of lines) {
      if (line.includes('|')) {
        const [fileInfo, changes] = line.split('|');
        const file = fileInfo.trim();
        const changeInfo = changes.trim();
        
        const match = changeInfo.match(/(\d+)\s*(\+*)(-*)/);
        if (match) {
          const [, total, pluses, minuses] = match;
          const insertions = pluses.length;
          const deletions = minuses.length;
          
          stats.files.push({
            file,
            insertions,
            deletions,
            total: parseInt(total)
          });
          
          stats.insertions += insertions;
          stats.deletions += deletions;
        }
        
        stats.filesChanged++;
      }
    }
    
    return stats;
  }

  /**
   * Get repository statistics
   */
  async getRepositoryStats(projectId) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      
      const [
        { stdout: commitCount },
        { stdout: branchCount },
        { stdout: tagCount },
        { stdout: fileCount }
      ] = await Promise.all([
        execAsync('git rev-list --count HEAD', { cwd: projectPath }),
        execAsync('git branch -r | wc -l', { cwd: projectPath }),
        execAsync('git tag | wc -l', { cwd: projectPath }),
        execAsync('git ls-files | wc -l', { cwd: projectPath })
      ]);

      return {
        success: true,
        stats: {
          totalCommits: parseInt(commitCount.trim()),
          totalBranches: parseInt(branchCount.trim()),
          totalTags: parseInt(tagCount.trim()),
          totalFiles: parseInt(fileCount.trim())
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
