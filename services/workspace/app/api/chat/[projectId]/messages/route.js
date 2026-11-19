/**
 * Chat Messages API Route
 * Handles loading and saving chat messages for a project
 */

import { NextResponse } from 'next/server';
import { requireProjectAccess } from '@/lib/project-auth.js';
import {
  getChatMessages,
  saveChatMessage,
  deleteChatMessages,
  pool
} from '@/lib/db.js';

/**
 * Ensure user exists in database (create placeholder if needed)
 */
async function ensureUserExists(userId) {
  try {
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [userId, `user-${userId.substring(0, 8)}@placeholder.local`, 'placeholder']
      );
    }
  } catch (error) {
    console.error(`[ChatMessages] Failed to ensure user exists:`, error.message);
  }
}

export async function GET(request, { params }) {
  try {
    const { projectId } = await params;

    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const messages = await getChatMessages(projectId, limit);

    const formattedMessages = messages.map(msg => {
      let metadata = msg.metadata;
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          console.warn(`Failed to parse metadata for message ${msg.id}:`, e);
          metadata = null;
        }
      }
      return {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        messageType: msg.message_type,
        metadata: metadata,
        timestamp: msg.created_at,
        sequenceNumber: msg.sequence_number
      };
    });

    return NextResponse.json({
      success: true,
      messages: formattedMessages
    });

  } catch (error) {
    console.error('Error loading chat messages:', error);

    // PostgreSQL error code 42P01 = undefined_table
    if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
      return NextResponse.json({
        success: false,
        error: 'Chat messages table does not exist. Please run database migrations first.',
        details: 'Run: psql $DATABASE_URL < lib/db-migrations/create-chat-messages.sql'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to load chat messages'
    }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;

    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const body = await request.json();
    const { role, content, messageType = 'user_message', metadata = {} } = body;

    if (!role || !content) {
      return NextResponse.json({
        success: false,
        error: 'role and content are required'
      }, { status: 400 });
    }

    if (!['user', 'assistant'].includes(role)) {
      return NextResponse.json({
        success: false,
        error: 'role must be "user" or "assistant"'
      }, { status: 400 });
    }

    await ensureUserExists(access.userId);

    const savedMessage = await saveChatMessage(
      projectId,
      access.userId,
      role,
      content,
      messageType,
      metadata
    );

    // Parse metadata from saved message
    let parsedMetadata = savedMessage.metadata;
    if (typeof parsedMetadata === 'string') {
      try {
        parsedMetadata = JSON.parse(parsedMetadata);
      } catch (e) {
        console.warn(`Failed to parse metadata for saved message ${savedMessage.id}:`, e);
        parsedMetadata = null;
      }
    }

    const formattedMessage = {
      id: savedMessage.id,
      role: savedMessage.role,
      content: savedMessage.content,
      messageType: savedMessage.message_type,
      metadata: parsedMetadata,
      timestamp: savedMessage.created_at,
      sequenceNumber: savedMessage.sequence_number
    };

    return NextResponse.json({
      success: true,
      message: formattedMessage
    });

  } catch (error) {
    console.error('Error saving chat message:', error);

    // PostgreSQL error code 42P01 = undefined_table
    if (error.code === '42P01' || (error.message && error.message.includes('does not exist'))) {
      return NextResponse.json({
        success: false,
        error: 'Chat messages table does not exist. Please run database migrations first.',
        details: 'Run: psql $DATABASE_URL < lib/db-migrations/create-chat-messages.sql'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to save chat message'
    }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { projectId } = await params;

    const access = await requireProjectAccess(projectId);
    if (access instanceof NextResponse) return access;

    const deleted = await deleteChatMessages(projectId);

    return NextResponse.json({
      success: true,
      deleted
    });
  } catch (error) {
    console.error('Error clearing chat messages:', error);

    if (error.message && error.message.includes('does not exist')) {
      return NextResponse.json({
        success: false,
        error: 'Chat messages table does not exist. Please run database migrations first.',
        details: 'Run: psql $DATABASE_URL < lib/db-migrations/create-chat-messages.sql'
      }, { status: 500 });
    }

    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to clear chat messages'
    }, { status: 500 });
  }
}
