// SPDX-License-Identifier: MIT

// In-memory store for rate limiting
// Note: In production with multiple instances, use Redis instead
const rateLimitStore = new Map();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  
  lastCleanup = now;
  const windowStart = now - 60 * 1000; // 1 minute window
  
  for (const [key, data] of rateLimitStore.entries()) {
    // Filter out old timestamps
    data.timestamps = data.timestamps.filter(t => t > windowStart);
    if (data.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check if a request should be rate limited
 * @param {string} identifier - Unique identifier (IP, user ID, etc.)
 * @param {Object} options - Rate limit options
 * @param {number} options.maxRequests - Maximum requests per window (default: 10)
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 minute)
 * @returns {Object} { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(identifier, options = {}) {
  const { maxRequests = 10, windowMs = 60 * 1000 } = options;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  // Periodic cleanup
  cleanup();
  
  // Get or create entry
  let data = rateLimitStore.get(identifier);
  if (!data) {
    data = { timestamps: [] };
    rateLimitStore.set(identifier, data);
  }
  
  // Filter timestamps within window
  data.timestamps = data.timestamps.filter(t => t > windowStart);
  
  // Check if over limit
  if (data.timestamps.length >= maxRequests) {
    const oldestTimestamp = data.timestamps[0];
    const resetAt = oldestTimestamp + windowMs;
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000),
    };
  }
  
  // Add current request
  data.timestamps.push(now);
  
  return {
    allowed: true,
    remaining: maxRequests - data.timestamps.length,
    resetAt: now + windowMs,
  };
}

/**
 * Rate limit middleware for Next.js API routes
 * @param {Request} request - Incoming request
 * @param {Object} options - Rate limit options
 * @returns {Response|null} - Returns Response if rate limited, null if allowed
 */
export function rateLimitMiddleware(request, options = {}) {
  // Get identifier (IP address or forwarded IP)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  
  // Create a unique key combining IP and route
  const route = new URL(request.url).pathname;
  const identifier = `${ip}:${route}`;
  
  const result = checkRateLimit(identifier, options);
  
  if (!result.allowed) {
    return new Response(
      JSON.stringify({
        error: 'Too many requests',
        message: `Rate limit exceeded. Please try again in ${result.retryAfter} seconds.`,
        retryAfter: result.retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(result.retryAfter),
          'X-RateLimit-Limit': String(options.maxRequests || 10),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
        },
      }
    );
  }
  
  return null; // Request allowed
}

/**
 * Stricter rate limit for sensitive endpoints (registration, login, etc.)
 */
export function strictRateLimit(request) {
  return rateLimitMiddleware(request, {
    maxRequests: 5, // 5 requests
    windowMs: 60 * 1000, // per minute
  });
}

/**
 * Standard rate limit for regular API endpoints
 */
export function standardRateLimit(request) {
  return rateLimitMiddleware(request, {
    maxRequests: 60, // 60 requests
    windowMs: 60 * 1000, // per minute
  });
}

export default checkRateLimit;
