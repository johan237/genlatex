/**
 * Accept Share API
 * Links a share token to a user account
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { pool } from '@/lib/db.js';

export async function POST(request, { params }) {
  try {
    const { token } = await params;

    // Get current user session
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }
    const userId = session.id;

    // Get share information
    const shareResult = await pool.query(
      `SELECT * FROM project_shares WHERE token = $1`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid or expired share link'
      }, { status: 404 });
    }

    const share = shareResult.rows[0];

    // Update share to link with user account
    await pool.query(
      `UPDATE project_shares 
       SET shared_with_user_id = $1, accessed_at = NOW()
       WHERE token = $2`,
      [userId, token]
    );

    return NextResponse.json({
      success: true,
      projectId: share.project_id,
      message: 'Share accepted successfully'
    });

  } catch (error) {
    console.error('Error accepting share:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to accept share'
    }, { status: 500 });
  }
}

