/**
 * GitHub Repository Linking API
 */

import { NextResponse } from 'next/server';
import { GitHubIntegration } from '@/lib/github-integration.js';

export async function POST(request) {
  try {
    const { projectId, repoUrl, branch = 'main', accessToken } = await request.json();
    
    if (!projectId || !repoUrl) {
      return NextResponse.json(
        { error: 'Project ID and repository URL are required' },
        { status: 400 }
      );
    }
    
    const githubIntegration = new GitHubIntegration(accessToken);
    const result = await githubIntegration.linkRepository(projectId, repoUrl, branch);
    
    return NextResponse.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error linking GitHub repository:', error);
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
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    const githubIntegration = new GitHubIntegration();
    const linkInfo = await githubIntegration.getLinkInfo(projectId);
    
    if (!linkInfo) {
      return NextResponse.json(
        { error: 'No linked repository found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      ...linkInfo
    });
  } catch (error) {
    console.error('Error getting GitHub link info:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    
    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      );
    }
    
    const githubIntegration = new GitHubIntegration();
    const result = await githubIntegration.unlinkRepository(projectId);
    
    return NextResponse.json({
      success: result
    });
  } catch (error) {
    console.error('Error unlinking GitHub repository:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
