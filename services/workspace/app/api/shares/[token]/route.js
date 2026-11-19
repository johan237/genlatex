/**
 * Get Share Information API
 * Returns information about a share token
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db.js';

export async function GET(request, { params }) {
  try {
    const { token } = await params;

    // Get share information from database
    const shareResult = await pool.query(
      `SELECT ps.*, u.name as shared_by_name, u.email as shared_by_email
       FROM project_shares ps
       JOIN users u ON ps.shared_by = u.id
       WHERE ps.token = $1`,
      [token]
    );

    if (shareResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Invalid or expired share link'
      }, { status: 404 });
    }

    const share = shareResult.rows[0];

    // Get project name from file storage
    let projectName = 'Project';
    try {
      const { getUserProjects } = await import('@/lib/projects-storage.js');
      const userProjects = await getUserProjects(share.shared_by);
      const project = userProjects.find(p => p.id === share.project_id);
      if (project) {
        projectName = project.name;
      }
    } catch (error) {
      console.error('Error fetching project name:', error);
    }

    // Check if share has expired
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({
        success: false,
        error: 'This share link has expired'
      }, { status: 410 });
    }

    return NextResponse.json({
      success: true,
      shareInfo: {
        projectId: share.project_id,
        projectName: projectName,
        permission: share.permission,
        sharedByName: share.shared_by_name,
        sharedByEmail: share.shared_by_email,
        sharedWithEmail: share.shared_with_email,
        createdAt: share.created_at
      }
    });

  } catch (error) {
    console.error('Error fetching share info:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch share information'
    }, { status: 500 });
  }
}

