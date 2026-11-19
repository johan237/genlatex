// SPDX-License-Identifier: MIT

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb'
    }
  },
  // Remove console.log/warn/debug in production builds (keeps console.error for debugging)
  // This keeps browser console clean for users while preserving error logging
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' 
      ? { exclude: ['error'] }  // Keep console.error for critical issues
      : false,
  },
  // Next.js 16 uses Turbopack by default; empty config silences webpack/turbopack mismatch warning.
  // If you need webpack (e.g. Monaco issues), run: npm run dev -- --webpack
  turbopack: {},
  webpack: (config, { isServer }) => {
    // Fix for Monaco Editor in Next.js - prevent web worker issues
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
