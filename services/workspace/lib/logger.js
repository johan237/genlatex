/**
 * Production-safe Logger Utility
 * 
 * Use this instead of console.log for more control over logging in different environments.
 * In production, only error and warn (when enabled) will log to console.
 * 
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   
 *   logger.log('User action', { userId: '123' });    // Only in development
 *   logger.debug('Debug info', data);                // Only in development
 *   logger.warn('Warning message');                   // Only in development (or set ENABLE_PROD_WARNINGS=true)
 *   logger.error('Error occurred', error);           // Always logged
 *   
 * For server-side only logging:
 *   import { serverLogger } from '@/lib/logger';
 *   serverLogger.info('[API] Request received');     // Only logs on server, not client
 */

const isDev = process.env.NODE_ENV === 'development';
const isServer = typeof window === 'undefined';

/**
 * Client-safe logger - logs are stripped in production builds via next.config.mjs
 * This utility provides a consistent API and additional context.
 */
export const logger = {
  /**
   * General log - only in development
   */
  log: (...args) => {
    if (isDev) {
      console.log('[LOG]', ...args);
    }
  },

  /**
   * Debug log - only in development
   */
  debug: (...args) => {
    if (isDev) {
      console.debug('[DEBUG]', ...args);
    }
  },

  /**
   * Info log - only in development
   */
  info: (...args) => {
    if (isDev) {
      console.info('[INFO]', ...args);
    }
  },

  /**
   * Warning - only in development by default
   */
  warn: (...args) => {
    if (isDev) {
      console.warn('[WARN]', ...args);
    }
  },

  /**
   * Error - always logged (kept in production)
   */
  error: (...args) => {
    console.error('[ERROR]', ...args);
  },

  /**
   * Trace - only in development, includes stack trace
   */
  trace: (...args) => {
    if (isDev) {
      console.trace('[TRACE]', ...args);
    }
  },
};

/**
 * Server-only logger - never logs on client side
 * Use this for server-side logging that should never appear in browser console
 */
export const serverLogger = {
  log: (...args) => {
    if (isServer && isDev) {
      console.log('[SERVER]', ...args);
    }
  },

  debug: (...args) => {
    if (isServer && isDev) {
      console.debug('[SERVER DEBUG]', ...args);
    }
  },

  info: (...args) => {
    if (isServer && isDev) {
      console.info('[SERVER INFO]', ...args);
    }
  },

  warn: (...args) => {
    if (isServer && isDev) {
      console.warn('[SERVER WARN]', ...args);
    }
  },

  error: (...args) => {
    if (isServer) {
      console.error('[SERVER ERROR]', ...args);
    }
  },
};

/**
 * Create a namespaced logger for a specific module
 * @param {string} namespace - Module name (e.g., 'FileTree', 'PDFViewer')
 * @returns {object} Logger with namespace prefix
 */
export function createLogger(namespace) {
  return {
    log: (...args) => logger.log(`[${namespace}]`, ...args),
    debug: (...args) => logger.debug(`[${namespace}]`, ...args),
    info: (...args) => logger.info(`[${namespace}]`, ...args),
    warn: (...args) => logger.warn(`[${namespace}]`, ...args),
    error: (...args) => logger.error(`[${namespace}]`, ...args),
    trace: (...args) => logger.trace(`[${namespace}]`, ...args),
  };
}

export default logger;
