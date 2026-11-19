/**
 * Collaboration Session API
 */

import { NextResponse } from 'next/server';
import { CollaborationManager } from '@/lib/collaboration.js';

const collaborationManager = new CollaborationManager();

export async function POST(request) {
  try {
    const { action, data } = await request.json();
    
    let result;
    
    switch (action) {
      case 'join':
        result = await collaborationManager.joinSession(data.projectId, data.userId, data.userName);
        break;
      case 'leave':
        result = await collaborationManager.leaveSession(data.projectId, data.userId);
        break;
      case 'broadcast_change':
        result = await collaborationManager.broadcastChange(data.projectId, data.userId, data.change);
        break;
      case 'update_cursor':
        result = await collaborationManager.updateCursor(data.projectId, data.userId, data.cursor);
        break;
      case 'update_selection':
        result = await collaborationManager.updateSelection(data.projectId, data.userId, data.selection);
        break;
      case 'create_comment':
        result = await collaborationManager.createComment(data.projectId, data.userId, data.comment);
        break;
      case 'reply_to_comment':
        result = await collaborationManager.replyToComment(data.projectId, data.commentId, data.userId, data.reply);
        break;
      case 'resolve_comment':
        result = await collaborationManager.resolveComment(data.projectId, data.commentId, data.userId);
        break;
      case 'share_document':
        result = await collaborationManager.shareDocument(data.projectId, data.userId, data.shareOptions);
        break;
      case 'revoke_sharing':
        result = await collaborationManager.revokeSharing(data.projectId, data.shareToken, data.userId);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in collaboration session:', error);
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
    
    let result;
    
    switch (action) {
      case 'participants':
        result = await collaborationManager.getParticipants(projectId);
        break;
      case 'change_history':
        result = await collaborationManager.getChangeHistory(projectId);
        break;
      case 'comments':
        result = await collaborationManager.getComments(projectId);
        break;
      case 'sharing_info':
        const userId = searchParams.get('userId');
        result = await collaborationManager.getSharingInfo(projectId, userId);
        break;
      case 'stats':
        result = await collaborationManager.getCollaborationStats(projectId);
        break;
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        );
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error getting collaboration data:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
