// SPDX-License-Identifier: MIT

'use client';

import React from 'react';
import { ExclamationTriangleIcon, ReloadIcon } from '@radix-ui/react-icons';

// Error Boundary Class Component (required for error boundaries)
class ErrorBoundaryClass extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render shows the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    this.setState({ errorInfo });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Here you could send to error tracking service (Sentry, etc.)
    // Example: Sentry.captureException(error, { extra: errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          reset: this.handleReset,
        });
      }

      // Default fallback UI
      return (
        <DefaultErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          reset={this.handleReset}
          level={this.props.level || 'page'}
        />
      );
    }

    return this.props.children;
  }
}

// Default Error Fallback Component
function DefaultErrorFallback({ error, errorInfo, reset, level = 'page' }) {
  const isPage = level === 'page';
  const isSection = level === 'section';
  const isComponent = level === 'component';

  // Full page error
  if (isPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-xl shadow-lg p-8 text-center border border-gray-200 dark:border-gray-800">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <ExclamationTriangleIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Something went wrong
          </h1>
          
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            An unexpected error occurred. Our team has been notified.
          </p>

          {process.env.NODE_ENV === 'development' && error && (
            <details className="mb-6 text-left">
              <summary className="cursor-pointer text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                Error details (development only)
              </summary>
              <div className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg overflow-auto max-h-48">
                <p className="text-sm font-mono text-red-600 dark:text-red-400 break-all">
                  {error.toString()}
                </p>
                {errorInfo?.componentStack && (
                  <pre className="mt-2 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            </details>
          )}

          <div className="flex gap-3 justify-center">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              <ReloadIcon className="w-4 h-4" />
              Try Again
            </button>
            <button
              onClick={() => window.location.href = '/dashboard'}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Section-level error
  if (isSection) {
    return (
      <div className="w-full p-6 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg">
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-red-800 dark:text-red-200">
              This section encountered an error
            </h3>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              We couldn't load this content. Please try again.
            </p>
            {process.env.NODE_ENV === 'development' && error && (
              <p className="mt-2 text-xs font-mono text-red-600 dark:text-red-400 break-all">
                {error.toString()}
              </p>
            )}
            <button
              onClick={reset}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200"
            >
              <ReloadIcon className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Component-level error (minimal)
  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm">
      <ExclamationTriangleIcon className="w-4 h-4 text-red-600 dark:text-red-400" />
      <span className="text-red-700 dark:text-red-300">Error loading component</span>
      <button
        onClick={reset}
        className="ml-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
      >
        <ReloadIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Higher-order component for wrapping components with error boundary
export function withErrorBoundary(Component, options = {}) {
  const WrappedComponent = (props) => (
    <ErrorBoundaryClass {...options}>
      <Component {...props} />
    </ErrorBoundaryClass>
  );
  
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name || 'Component'})`;
  
  return WrappedComponent;
}

// Convenience components for different error boundary levels
export function PageErrorBoundary({ children, onError, onReset, fallback }) {
  return (
    <ErrorBoundaryClass 
      level="page" 
      onError={onError} 
      onReset={onReset}
      fallback={fallback}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

export function SectionErrorBoundary({ children, onError, onReset, fallback }) {
  return (
    <ErrorBoundaryClass 
      level="section" 
      onError={onError} 
      onReset={onReset}
      fallback={fallback}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

export function ComponentErrorBoundary({ children, onError, onReset, fallback }) {
  return (
    <ErrorBoundaryClass 
      level="component" 
      onError={onError} 
      onReset={onReset}
      fallback={fallback}
    >
      {children}
    </ErrorBoundaryClass>
  );
}

export default ErrorBoundaryClass;
