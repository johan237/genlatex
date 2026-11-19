// SPDX-License-Identifier: MIT

'use client';

import { motion } from 'framer-motion';

// Spinner animation variants
const spinTransition = {
  repeat: Infinity,
  ease: "linear",
  duration: 1,
};

// Basic Spinner
export function Spinner({ size = 'md', className = '' }) {
  const sizes = {
    xs: 'w-3 h-3',
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
    xl: 'w-12 h-12',
  };

  return (
    <motion.div
      className={`${sizes[size]} ${className}`}
      animate={{ rotate: 360 }}
      transition={spinTransition}
    >
      <svg
        className="w-full h-full text-current"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
    </motion.div>
  );
}

// Full page loading
export function PageLoading({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-4"
      >
        <div className="relative">
          <Spinner size="xl" className="text-blue-600 dark:text-blue-400" />
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm font-medium">
          {message}
        </p>
      </motion.div>
    </div>
  );
}

// Inline loading (for buttons, etc.)
export function InlineLoading({ size = 'sm', className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Spinner size={size} />
    </span>
  );
}

// Card/Section loading skeleton
export function CardSkeleton({ className = '' }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="bg-gray-200 dark:bg-gray-800 rounded-lg p-4 space-y-3">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4" />
        <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-1/2" />
        <div className="h-3 bg-gray-300 dark:bg-gray-700 rounded w-5/6" />
      </div>
    </div>
  );
}

// Project card skeleton
export function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-gray-200 dark:bg-gray-800 rounded-lg" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-2/3" />
          <div className="h-3 bg-gray-200 dark:bg-gray-800 rounded w-1/3" />
        </div>
      </div>
    </div>
  );
}

// List skeleton
export function ListSkeleton({ count = 3, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <ProjectCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Button loading state
export function ButtonLoading({ children, loading, disabled, className = '', ...props }) {
  return (
    <button
      disabled={loading || disabled}
      className={`relative ${className}`}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" />
        </span>
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
}

// Overlay loading (for sections)
export function LoadingOverlay({ loading, children, message }) {
  return (
    <div className="relative">
      {children}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10 rounded-lg"
        >
          <Spinner size="lg" className="text-blue-600 dark:text-blue-400" />
          {message && (
            <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">
              {message}
            </p>
          )}
        </motion.div>
      )}
    </div>
  );
}

// Progress loading
export function ProgressLoading({ progress = 0, message }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="w-48 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-blue-600 dark:bg-blue-500 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400">
        {message || `${Math.round(progress)}%`}
      </div>
    </div>
  );
}

// Dots loading animation
export function DotsLoading({ className = '' }) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-2 h-2 bg-current rounded-full"
          animate={{
            scale: [1, 1.2, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

export default Spinner;
