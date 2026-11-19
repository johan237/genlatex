/**
 * Git Control API
 * When MinIO: syncs project to local before git ops, syncs back after (git needs real filesystem).
 */

import { NextResponse } from 'next/server';
import { GitIntegration } from '@/lib/git-integration.js';
import { isMinio, syncProjectToLocal, syncProjectFromLocal } from '@/lib/files.js';

export async function POST(request) {
  try {
    const { action, data } = await request.json();

    if (data?.projectId && isMinio()) {
      await syncProjectToLocal(data.projectId).catch(() => {});
    }

    const gitIntegration = new GitIntegration();
    
    let result;
    
    switch (action) {
      case 'init':
        result = await gitIntegration.initRepository(data.projectId);
        break;
      case 'stage':
        result = await gitIntegration.stageFiles(data.projectId, data.files);
        break;
      case 'commit':
        result = await gitIntegration.createCommit(data.projectId, data.message, data.author);
        break;
      case 'create_branch':
        result = await gitIntegration.createBranch(data.projectId, data.branchName);
        break;
      case 'switch_branch':
        result = await gitIntegration.switchBranch(data.projectId, data.branchName);
        break;
      case 'merge_branch':
        result = await gitIntegration.mergeBranch(data.projectId, data.branchName, data.message);
        break;
      case 'add_remote':
        result = await gitIntegration.addRemote(data.projectId, data.name, data.url);
        break;
      case 'push':
        result = await gitIntegration.pushToRemote(data.projectId, data.remote, data.branch);
        break;
      case 'pull':
        result = await gitIntegration.pullFromRemote(data.projectId, data.remote, data.branch);
        break;
      case 'create_tag':
        result = await gitIntegration.createTag(data.projectId, data.tagName, data.message);
        break;
      case 'revert':
        result = await gitIntegration.revertCommit(data.projectId, data.commitHash);
        break;
      case 'reset':
        result = await gitIntegration.resetToCommit(data.projectId, data.commitHash, data.mode);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }

    if (data?.projectId && isMinio()) {
      await syncProjectFromLocal(data.projectId).catch((err) => console.warn('Sync from local to MinIO after git:', err?.message));
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in git control:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const action = searchParams.get('action');

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }

    if (isMinio()) {
      await syncProjectToLocal(projectId).catch(() => {});
    }

    const gitIntegration = new GitIntegration();
    
    let result;
    
    switch (action) {
      case 'status':
        result = await gitIntegration.getStatus(projectId);
        break;
      case 'history':
        const limit = parseInt(searchParams.get('limit')) || 20;
        result = await gitIntegration.getCommitHistory(projectId, limit);
        break;
      case 'commit_details':
        const commitHash = searchParams.get('commitHash');
        result = await gitIntegration.getCommitDetails(projectId, commitHash);
        break;
      case 'branches':
        result = await gitIntegration.getBranches(projectId);
        break;
      case 'remotes':
        result = await gitIntegration.getRemotes(projectId);
        break;
      case 'tags':
        result = await gitIntegration.getTags(projectId);
        break;
      case 'file_history':
        const filePath = searchParams.get('filePath');
        result = await gitIntegration.getFileHistory(projectId, filePath);
        break;
      case 'compare':
        const commit1 = searchParams.get('commit1');
        const commit2 = searchParams.get('commit2');
        result = await gitIntegration.compareCommits(projectId, commit1, commit2);
        break;
      case 'stats':
        result = await gitIntegration.getRepositoryStats(projectId);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting git data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
