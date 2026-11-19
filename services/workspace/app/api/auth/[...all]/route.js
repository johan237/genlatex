/**
 * Better Auth – catch-all handler for /api/auth/*
 */

import { auth } from '@/lib/auth.js';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler(auth);
