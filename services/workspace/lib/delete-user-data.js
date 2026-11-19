/**
 * GenLaTeX – Delete all data for a user (account deletion).
 * Removes project files on disk, app DB rows (projects, research_files, etc.),
 * and Better Auth tables (session, account, user) so the same email/OAuth can sign up again.
 */

import { pool, getProjectsByUserId } from './db.js';
import { deleteProjectFiles } from './files.js';

/** Run a delete by userId on a Better Auth table; try "userId" then userid. */
async function deleteBetterAuthByUserId(client, table, userId) {
  try {
    await client.query(`DELETE FROM ${table} WHERE "userId" = $1`, [userId]);
  } catch (e) {
    if (/column "userId" does not exist/i.test(e.message)) {
      await client.query(`DELETE FROM ${table} WHERE userid = $1`, [userId]);
    } else {
      throw e;
    }
  }
}

/**
 * Delete all data associated with a user. Call this before Better Auth deletes the user.
 * Also deletes from Better Auth's session, account, and user tables so the same
 * email (e.g. Google) can create a new account after deletion.
 * @param {string} userId - User UUID
 */
export async function deleteAllUserData(userId) {
  const client = await pool.connect();
  try {
    const projects = await getProjectsByUserId(userId);
    for (const project of projects) {
      try {
        await deleteProjectFiles(userId, project.id);
      } catch (e) {
        console.warn(`[delete-user-data] Failed to delete project dir for ${project.id}:`, e.message);
      }
    }

    await client.query('BEGIN');

    // App tables
    await client.query('DELETE FROM file_usage_log WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM projects WHERE user_id = $1', [userId]);
    await client.query(
      'DELETE FROM project_shares WHERE shared_by = $1 OR shared_with_user_id = $2',
      [userId, userId]
    );
    await client.query('DELETE FROM user_zotero WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM zotero_oauth_pending WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM users WHERE id = $1', [userId]);

    // Better Auth tables (order: session, account, then user) so the same email/OAuth can re-sign-up
    await deleteBetterAuthByUserId(client, 'session', userId);
    await deleteBetterAuthByUserId(client, 'account', userId);
    await client.query('DELETE FROM "user" WHERE id = $1', [userId]);

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
