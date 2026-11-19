/**
 * Real-time Collaboration System
 * Enables multiple users to work on the same document simultaneously
 */

import fs from 'fs/promises';
import path from 'path';

export class CollaborationManager {
  constructor() {
    this.activeSessions = new Map();
    this.userPresence = new Map();
    this.changeHistory = new Map();
    this.cursors = new Map();
  }

  /**
   * Join a collaboration session
   */
  async joinSession(projectId, userId, userName) {
    try {
      const sessionId = `session_${projectId}`;
      
      if (!this.activeSessions.has(sessionId)) {
        this.activeSessions.set(sessionId, {
          projectId,
          participants: new Map(),
          changes: [],
          lastModified: new Date().toISOString()
        });
      }

      const session = this.activeSessions.get(sessionId);
      session.participants.set(userId, {
        id: userId,
        name: userName,
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        cursor: null,
        selection: null
      });

      // Initialize user presence
      this.userPresence.set(`${sessionId}_${userId}`, {
        sessionId,
        userId,
        userName,
        isActive: true,
        lastActivity: new Date().toISOString()
      });

      return {
        success: true,
        sessionId,
        participants: Array.from(session.participants.values()),
        message: 'Joined collaboration session'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Leave a collaboration session
   */
  async leaveSession(projectId, userId) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (session) {
        session.participants.delete(userId);
        
        // Remove user presence
        this.userPresence.delete(`${sessionId}_${userId}`);

        // Clean up empty sessions
        if (session.participants.size === 0) {
          this.activeSessions.delete(sessionId);
        }
      }

      return {
        success: true,
        message: 'Left collaboration session'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Broadcast changes to all participants
   */
  async broadcastChange(projectId, userId, change) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      // Add change to history
      const changeRecord = {
        id: this.generateChangeId(),
        userId,
        timestamp: new Date().toISOString(),
        change,
        version: session.changes.length + 1
      };

      session.changes.push(changeRecord);
      session.lastModified = new Date().toISOString();

      // Store change history
      if (!this.changeHistory.has(sessionId)) {
        this.changeHistory.set(sessionId, []);
      }
      this.changeHistory.get(sessionId).push(changeRecord);

      // Update user activity
      this.updateUserActivity(sessionId, userId);

      return {
        success: true,
        changeId: changeRecord.id,
        version: changeRecord.version,
        participants: Array.from(session.participants.keys()).filter(id => id !== userId)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update cursor position
   */
  async updateCursor(projectId, userId, cursor) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (session && session.participants.has(userId)) {
        const participant = session.participants.get(userId);
        participant.cursor = cursor;
        participant.lastSeen = new Date().toISOString();

        // Store cursor for other participants
        this.cursors.set(`${sessionId}_${userId}`, {
          sessionId,
          userId,
          cursor,
          timestamp: new Date().toISOString()
        });

        return {
          success: true,
          message: 'Cursor updated'
        };
      }

      return {
        success: false,
        error: 'User not in session'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update text selection
   */
  async updateSelection(projectId, userId, selection) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (session && session.participants.has(userId)) {
        const participant = session.participants.get(userId);
        participant.selection = selection;
        participant.lastSeen = new Date().toISOString();

        return {
          success: true,
          message: 'Selection updated'
        };
      }

      return {
        success: false,
        error: 'User not in session'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get session participants
   */
  async getParticipants(projectId) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      const participants = Array.from(session.participants.values()).map(participant => ({
        ...participant,
        isActive: this.isUserActive(sessionId, participant.id)
      }));

      return {
        success: true,
        participants,
        totalParticipants: participants.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get change history
   */
  async getChangeHistory(projectId, limit = 50) {
    try {
      const sessionId = `session_${projectId}`;
      const history = this.changeHistory.get(sessionId) || [];

      return {
        success: true,
        changes: history.slice(-limit),
        totalChanges: history.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Apply operational transformation for conflict resolution
   */
  async transformOperation(operation, concurrentOperations) {
    try {
      let transformedOperation = { ...operation };

      for (const concurrentOp of concurrentOperations) {
        if (this.operationsConflict(transformedOperation, concurrentOp)) {
          transformedOperation = this.resolveConflict(transformedOperation, concurrentOp);
        }
      }

      return {
        success: true,
        transformedOperation
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if operations conflict
   */
  operationsConflict(op1, op2) {
    // Simple conflict detection based on position overlap
    if (op1.type === 'insert' && op2.type === 'insert') {
      return Math.abs(op1.position - op2.position) < op1.content.length;
    }
    
    if (op1.type === 'delete' && op2.type === 'delete') {
      return op1.position === op2.position && op1.length === op2.length;
    }

    return false;
  }

  /**
   * Resolve operation conflicts
   */
  resolveConflict(op1, op2) {
    // Simple conflict resolution - adjust positions
    if (op1.type === 'insert' && op2.type === 'insert') {
      if (op1.position <= op2.position) {
        return {
          ...op1,
          position: op1.position
        };
      } else {
        return {
          ...op1,
          position: op1.position + op2.content.length
        };
      }
    }

    return op1;
  }

  /**
   * Create a comment on the document
   */
  async createComment(projectId, userId, comment) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      const commentRecord = {
        id: this.generateCommentId(),
        userId,
        timestamp: new Date().toISOString(),
        comment,
        resolved: false,
        replies: []
      };

      // Store comment (in a real implementation, this would be in a database)
      if (!session.comments) {
        session.comments = [];
      }
      session.comments.push(commentRecord);

      return {
        success: true,
        comment: commentRecord,
        message: 'Comment created'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Reply to a comment
   */
  async replyToComment(projectId, commentId, userId, reply) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session || !session.comments) {
        return {
          success: false,
          error: 'Session or comments not found'
        };
      }

      const comment = session.comments.find(c => c.id === commentId);
      if (!comment) {
        return {
          success: false,
          error: 'Comment not found'
        };
      }

      const replyRecord = {
        id: this.generateReplyId(),
        userId,
        timestamp: new Date().toISOString(),
        reply
      };

      comment.replies.push(replyRecord);

      return {
        success: true,
        reply: replyRecord,
        message: 'Reply added'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get comments for a document
   */
  async getComments(projectId) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      return {
        success: true,
        comments: session.comments || [],
        totalComments: (session.comments || []).length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Resolve a comment
   */
  async resolveComment(projectId, commentId, userId) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session || !session.comments) {
        return {
          success: false,
          error: 'Session or comments not found'
        };
      }

      const comment = session.comments.find(c => c.id === commentId);
      if (!comment) {
        return {
          success: false,
          error: 'Comment not found'
        };
      }

      comment.resolved = true;
      comment.resolvedBy = userId;
      comment.resolvedAt = new Date().toISOString();

      return {
        success: true,
        message: 'Comment resolved'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Share document with external users
   */
  async shareDocument(projectId, userId, shareOptions) {
    try {
      const shareToken = this.generateShareToken();
      const shareRecord = {
        id: shareToken,
        projectId,
        createdBy: userId,
        createdAt: new Date().toISOString(),
        expiresAt: shareOptions.expiresAt || null,
        permissions: shareOptions.permissions || ['read'],
        allowedUsers: shareOptions.allowedUsers || [],
        isPublic: shareOptions.isPublic || false
      };

      // Store share record (in a real implementation, this would be in a database)
      if (!this.shareRecords) {
        this.shareRecords = new Map();
      }
      this.shareRecords.set(shareToken, shareRecord);

      return {
        success: true,
        shareToken,
        shareUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/shared/${shareToken}`,
        message: 'Document shared successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get document sharing information
   */
  async getSharingInfo(projectId, userId) {
    try {
      const shares = [];
      
      if (this.shareRecords) {
        for (const [token, record] of this.shareRecords) {
          if (record.projectId === projectId) {
            shares.push({
              token,
              createdAt: record.createdAt,
              expiresAt: record.expiresAt,
              permissions: record.permissions,
              isPublic: record.isPublic
            });
          }
        }
      }

      return {
        success: true,
        shares,
        totalShares: shares.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Revoke document sharing
   */
  async revokeSharing(projectId, shareToken, userId) {
    try {
      if (this.shareRecords && this.shareRecords.has(shareToken)) {
        const record = this.shareRecords.get(shareToken);
        
        if (record.projectId === projectId && record.createdBy === userId) {
          this.shareRecords.delete(shareToken);
          
          return {
            success: true,
            message: 'Sharing revoked successfully'
          };
        }
      }

      return {
        success: false,
        error: 'Share token not found or unauthorized'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Update user activity
   */
  updateUserActivity(sessionId, userId) {
    const presenceKey = `${sessionId}_${userId}`;
    if (this.userPresence.has(presenceKey)) {
      const presence = this.userPresence.get(presenceKey);
      presence.lastActivity = new Date().toISOString();
      presence.isActive = true;
    }
  }

  /**
   * Check if user is active
   */
  isUserActive(sessionId, userId) {
    const presenceKey = `${sessionId}_${userId}`;
    if (this.userPresence.has(presenceKey)) {
      const presence = this.userPresence.get(presenceKey);
      const lastActivity = new Date(presence.lastActivity);
      const now = new Date();
      const diffMinutes = (now - lastActivity) / (1000 * 60);
      
      return diffMinutes < 5; // Consider active if last activity was within 5 minutes
    }
    
    return false;
  }

  /**
   * Generate unique change ID
   */
  generateChangeId() {
    return `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique comment ID
   */
  generateCommentId() {
    return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique reply ID
   */
  generateReplyId() {
    return `reply_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate share token
   */
  generateShareToken() {
    return `share_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * Clean up inactive sessions
   */
  async cleanupInactiveSessions() {
    try {
      const now = new Date();
      const inactiveThreshold = 30 * 60 * 1000; // 30 minutes

      for (const [sessionId, session] of this.activeSessions) {
        const lastModified = new Date(session.lastModified);
        if (now - lastModified > inactiveThreshold) {
          this.activeSessions.delete(sessionId);
          
          // Clean up related data
          for (const [key, presence] of this.userPresence) {
            if (key.startsWith(sessionId)) {
              this.userPresence.delete(key);
            }
          }
        }
      }

      return {
        success: true,
        message: 'Inactive sessions cleaned up'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get collaboration statistics
   */
  async getCollaborationStats(projectId) {
    try {
      const sessionId = `session_${projectId}`;
      const session = this.activeSessions.get(sessionId);

      if (!session) {
        return {
          success: false,
          error: 'Session not found'
        };
      }

      const stats = {
        totalParticipants: session.participants.size,
        activeParticipants: Array.from(session.participants.values())
          .filter(p => this.isUserActive(sessionId, p.id)).length,
        totalChanges: session.changes.length,
        totalComments: (session.comments || []).length,
        resolvedComments: (session.comments || []).filter(c => c.resolved).length,
        sessionDuration: this.calculateSessionDuration(session),
        lastActivity: session.lastModified
      };

      return {
        success: true,
        stats
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calculate session duration
   */
  calculateSessionDuration(session) {
    if (session.participants.size === 0) return 0;
    
    const joinTimes = Array.from(session.participants.values())
      .map(p => new Date(p.joinedAt));
    const earliestJoin = new Date(Math.min(...joinTimes));
    const now = new Date();
    
    return Math.floor((now - earliestJoin) / (1000 * 60)); // Duration in minutes
  }
}
