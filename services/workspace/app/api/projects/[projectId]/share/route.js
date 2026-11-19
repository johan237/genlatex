/**
 * Project Sharing API
 * Handles sharing projects with other users
 */

import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { sendShareInvitationEmail } from '@/lib/email.js';
import crypto from 'crypto';

export async function POST(request, { params }) {
  try {
    const { projectId } = await params;
    const { emails, permission } = await request.json();

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'At least one email address is required'
      }, { status: 400 });
    }

    // Get current user session
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({
        success: false,
        error: 'Unauthorized'
      }, { status: 401 });
    }
    const userId = session.id;

    // Check if user has Pro subscription
    const { pool } = await import('@/lib/db.js');
    const userResult = await pool.query(
      'SELECT is_pro FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'User not found'
      }, { status: 404 });
    }

    if (!userResult.rows[0].is_pro) {
      return NextResponse.json({
        success: false,
        error: 'Sharing is only available for Pro users. Please upgrade to share projects.',
        upgradeRequired: true
      }, { status: 403 });
    }

    // Validate email addresses
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = emails.filter(email => !emailRegex.test(email));

    if (invalidEmails.length > 0) {
      return NextResponse.json({
        success: false,
        error: `Invalid email addresses: ${invalidEmails.join(', ')}`
      }, { status: 400 });
    }

    // Get project name from file storage (since projects are stored in files, not DB)
    let projectName = 'Project';
    try {
      const { getUserProjects } = await import('@/lib/projects-storage.js');
      const userProjects = await getUserProjects(userId);
      const project = userProjects.find(p => p.id === projectId);
      if (project) {
        projectName = project.name;
      }
    } catch (error) {
      console.error('Error fetching project name:', error);
    }

    // Generate secure share links for each email
    const shareLinks = [];

    for (const email of emails) {
      // Generate unique token
      const token = crypto.randomBytes(32).toString('hex');

      // Look up if user exists by email to get their user_id
      const existingUserResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [email.toLowerCase()]
      );
      const sharedWithUserId = existingUserResult.rows.length > 0
        ? existingUserResult.rows[0].id
        : null;

      // Insert into project_shares table with user_id reference if user exists
      // Update existing share if project already shared with this email, otherwise insert new
      await pool.query(
        `INSERT INTO project_shares (project_id, shared_by, shared_with_email, shared_with_user_id, token, permission, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (project_id, shared_with_email)
         DO UPDATE SET token = EXCLUDED.token, permission = EXCLUDED.permission,
                       shared_with_user_id = EXCLUDED.shared_with_user_id, created_at = NOW()`,
        [projectId, userId, email, sharedWithUserId, token, permission || 'view']
      );

      // Create share link
      const shareLink = `${process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/share/${token}`;
      shareLinks.push({ email, link: shareLink, userFound: !!sharedWithUserId });

      console.log(`📧 Generated share link for ${email}: ${shareLink}${sharedWithUserId ? ` (user_id: ${sharedWithUserId})` : ' (user not registered yet)'}`);
    }
    
    // Send invitation emails with share links
    console.log(`📧 Sending share invitations for project "${projectName}" to ${emails.length} user(s)`);

    const emailResults = [];
    for (const { email, link, userFound } of shareLinks) {
      try {
        await sendShareInvitationEmail({
          to: email,
          shareLink: link,
          projectName: projectName,
          sharedBy: session.user?.name || session.user?.email || 'A user',
          permission: permission || 'view',
          userExists: userFound
        });
        emailResults.push({ email, sent: true });
        console.log(`✅ Share invitation sent to ${email}`);
      } catch (error) {
        console.error(`❌ Failed to send share invitation to ${email}:`, error.message);
        emailResults.push({ email, sent: false, error: error.message });
        // Don't fail the entire request if email sending fails
      }
    }

    const emailsSent = emailResults.filter(r => r.sent).length;
    const emailsFailed = emailResults.filter(r => !r.sent).length;

    return NextResponse.json({
      success: true,
      message: `Project shared successfully with ${emails.length} user(s)`,
      emailsSent: emailsSent,
      emailsFailed: emailsFailed,
      emails: emails,
      shareLinks: shareLinks,
      emailResults: emailResults,
      projectId: projectId
    });

  } catch (error) {
    console.error('Project sharing error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to share project'
    }, { status: 500 });
  }
}

