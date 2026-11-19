/**
 * Migration Script: Sync projects from JSON file to PostgreSQL database
 *
 * Run with: node lib/db-migrations/sync-projects-to-db.js
 *
 * This script:
 * 1. Reads all projects from data/projects.json
 * 2. Ensures each owner (user) exists in the users table
 * 3. Inserts each project into the projects table with proper user_id (owner) reference
 * 4. Handles project_shares for collaborators
 *
 * Database Schema:
 * - projects.user_id = owner of the project
 * - project_shares = collaborators (people invited to view/edit)
 */

import fs from 'fs/promises';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

// Database connection
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const PROJECTS_FILE = path.join(__dirname, '..', '..', 'data', 'projects.json');

async function loadProjectsFromJson() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No projects.json file found');
      return {};
    }
    throw error;
  }
}

/**
 * Ensure a user exists in the database
 * Creates a placeholder user if they don't exist
 * @param {string} userId - UUID of the user
 * @param {string} role - Role description for logging (e.g., "owner", "collaborator")
 * @returns {boolean} - Whether the user exists or was created
 */
async function ensureUserExists(userId, role = 'user') {
  if (!userId || typeof userId !== 'string') {
    console.error(`  Invalid userId provided for ${role}: ${userId}`);
    return false;
  }

  // Check if user exists
  const checkResult = await pool.query(
    'SELECT id, email FROM users WHERE id = $1',
    [userId]
  );

  if (checkResult.rows.length > 0) {
    return true;
  }

  // Create placeholder user if doesn't exist
  const placeholderEmail = `user-${userId.substring(0, 8)}@placeholder.local`;
  console.log(`  Creating placeholder ${role}: ${userId} (${placeholderEmail})`);

  await pool.query(
    `INSERT INTO users (id, email, password_hash, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [userId, placeholderEmail, 'placeholder']
  );

  return true;
}

/**
 * Sync a single project to the database
 * @param {Object} project - Project object from JSON
 * @param {string} ownerId - UUID of the project owner
 * @returns {Object} - Result with synced status and any errors
 */
async function syncProjectToDb(project, ownerId) {
  const result = {
    projectId: project.id,
    projectName: project.name,
    synced: false,
    action: null,
    error: null
  };

  try {
    // Validate project has required fields
    if (!project.id) {
      result.error = 'Project missing id';
      return result;
    }

    // Ensure owner exists in database first
    const ownerExists = await ensureUserExists(ownerId, 'owner');
    if (!ownerExists) {
      result.error = `Could not create/find owner: ${ownerId}`;
      return result;
    }

    // Check if project already exists
    const checkResult = await pool.query(
      'SELECT id, user_id, name FROM projects WHERE id = $1',
      [project.id]
    );

    if (checkResult.rows.length > 0) {
      const existingProject = checkResult.rows[0];

      // Project exists - check if we need to update
      if (existingProject.user_id !== ownerId || existingProject.name !== project.name) {
        // Update existing project
        await pool.query(
          `UPDATE projects SET user_id = $1, name = $2 WHERE id = $3`,
          [ownerId, project.name || 'Untitled', project.id]
        );
        result.synced = true;
        result.action = 'updated';
        console.log(`  Updated project: ${project.id} (${project.name}) - owner: ${ownerId}`);
      } else {
        result.action = 'skipped';
        console.log(`  Project ${project.id} (${project.name}) already exists and is up-to-date`);
      }
    } else {
      // Insert new project
      await pool.query(
        `INSERT INTO projects (id, user_id, name, created_at)
         VALUES ($1, $2, $3, $4)`,
        [
          project.id,
          ownerId,
          project.name || 'Untitled',
          project.created_at || new Date().toISOString()
        ]
      );
      result.synced = true;
      result.action = 'created';
      console.log(`  Created project: ${project.id} (${project.name}) - owner: ${ownerId}`);
    }

    return result;
  } catch (error) {
    result.error = error.message;
    console.error(`  Error syncing project ${project.id}:`, error.message);
    return result;
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('='.repeat(70));
  console.log('Project Sync Migration: JSON -> PostgreSQL');
  console.log('='.repeat(70));

  const stats = {
    totalProjects: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    usersCreated: 0
  };

  try {
    // Test database connection
    const testResult = await pool.query('SELECT NOW()');
    console.log(`Database connected at: ${testResult.rows[0].now}`);

    // Load projects from JSON
    console.log(`\nLoading projects from: ${PROJECTS_FILE}`);
    const projectsByUser = await loadProjectsFromJson();

    const userIds = Object.keys(projectsByUser);
    console.log(`Found ${userIds.length} user(s) with projects\n`);

    if (userIds.length === 0) {
      console.log('No projects to migrate.');
      return;
    }

    // Process each user's projects
    for (const ownerId of userIds) {
      const userProjects = projectsByUser[ownerId] || [];
      console.log(`\nOwner ${ownerId}: ${userProjects.length} project(s)`);
      console.log('-'.repeat(50));

      for (const project of userProjects) {
        stats.totalProjects++;

        // Use the ownerId from the JSON structure (the key in projectsByUser)
        // This is the project owner
        const result = await syncProjectToDb(project, ownerId);

        if (result.error) {
          stats.errors++;
        } else if (result.action === 'created') {
          stats.created++;
        } else if (result.action === 'updated') {
          stats.updated++;
        } else {
          stats.skipped++;
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('Migration Complete');
    console.log('='.repeat(70));
    console.log(`Total projects in JSON:     ${stats.totalProjects}`);
    console.log(`  - Created:                ${stats.created}`);
    console.log(`  - Updated:                ${stats.updated}`);
    console.log(`  - Skipped (no changes):   ${stats.skipped}`);
    console.log(`  - Errors:                 ${stats.errors}`);

    // Verify by counting in DB
    const projectCount = await pool.query('SELECT COUNT(*) as count FROM projects');
    const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
    const shareCount = await pool.query('SELECT COUNT(*) as count FROM project_shares');

    console.log('\nDatabase totals:');
    console.log(`  - Users:          ${userCount.rows[0].count}`);
    console.log(`  - Projects:       ${projectCount.rows[0].count}`);
    console.log(`  - Project Shares: ${shareCount.rows[0].count}`);

    // Show sample data
    console.log('\nSample projects in database:');
    const sampleProjects = await pool.query(`
      SELECT p.id, p.name, p.user_id as owner_id, u.email as owner_email
      FROM projects p
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
      LIMIT 5
    `);

    for (const p of sampleProjects.rows) {
      console.log(`  - ${p.name} (${p.id.substring(0, 8)}...)`);
      console.log(`    Owner: ${p.owner_email || p.owner_id}`);
    }

  } catch (error) {
    console.error('\nMigration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
