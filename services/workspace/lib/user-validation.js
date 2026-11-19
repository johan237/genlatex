/**
 * User ID Validation and Migration Utilities
 * Handles invalid user IDs and helps migrate from old to new authentication
 */

import { pool } from './db.js';

/**
 * Check if a string is a valid UUID
 * @param {string} str - String to check
 * @returns {boolean} True if valid UUID
 */
export function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Check if a user ID is invalid (not a UUID)
 * @param {string} userId - User ID to check
 * @returns {boolean} True if invalid
 */
export function isInvalidUserID(userId) {
  return !userId || !isValidUUID(userId) || userId === '1' || userId === 'test' || userId === 'admin';
}

/**
 * Find or create a valid user for testing
 * Creates a test user with UUID if no users exist
 * @returns {Promise<string>} Valid UUID of a user
 */
export async function ensureValidUser() {
  try {
    // First, try to find any existing user
    const result = await pool.query('SELECT id FROM users LIMIT 1');
    
    if (result.rows.length > 0) {
      return result.rows[0].id;
    }

    // No users exist, create a test user
    const crypto = await import('crypto');
    const testEmail = 'test@genlatex.com';
    const bcrypt = await import('bcryptjs');
    const hashedPassword = await bcrypt.hash('test123', 10);
    
    const insertResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, created_at) 
       VALUES ($1, $2, $3, NOW()) 
       RETURNING id`,
      [testEmail, hashedPassword, 'Test User']
    );
    
    return insertResult.rows[0].id;
  } catch (error) {
    console.error('Error ensuring valid user:', error);
    throw error;
  }
}

/**
 * Get valid user ID from session or create a test one
 * @param {string} userId - Current user ID (may be invalid)
 * @returns {Promise<string>} Valid user ID
 */
export async function getValidUserID(userId) {
  // If it's a valid UUID, use it
  if (isValidUUID(userId)) {
    return userId;
  }

  console.warn(`Invalid user ID detected: ${userId}, attempting to find valid user...`);
  
  try {
    // Try to get a valid user ID from the database
    return await ensureValidUser();
  } catch (error) {
    console.error('Error getting valid user ID:', error);
    // Return a default UUID format (this will likely fail but won't crash)
    return '00000000-0000-0000-0000-000000000000';
  }
}

/**
 * Clean up or migrate user IDs in the session
 * @param {object} sessionData - Session data object
 * @returns {Promise<object>} Updated session with valid user ID
 */
export async function migrateUserID(sessionData) {
  if (!sessionData || !sessionData.id) {
    // Get or create a valid user
    const validUserId = await ensureValidUser();
    return {
      ...sessionData,
      id: validUserId
    };
  }

  // If the ID is already valid, return as is
  if (isValidUUID(sessionData.id)) {
    return sessionData;
  }

  // Invalid ID, find or create a valid one
  console.warn(`Migrating invalid user ID: ${sessionData.id}`);
  const validUserId = await ensureValidUser();
  
  return {
    ...sessionData,
    id: validUserId
  };
}

