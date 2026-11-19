// SPDX-License-Identifier: MIT

'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CheckCircledIcon, 
  CrossCircledIcon, 
  ExclamationTriangleIcon, 
  InfoCircledIcon,
  Cross2Icon
} from '@radix-ui/react-icons';

// Toast types
const TOAST_TYPES = {
  success: {
    icon: CheckCircledIcon,
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/50',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    textColor: 'text-emerald-800 dark:text-emerald-200',
  },
  error: {
    icon: CrossCircledIcon,
    bgColor: 'bg-red-50 dark:bg-red-950/50',
    borderColor: 'border-red-200 dark:border-red-800',
    iconColor: 'text-red-600 dark:text-red-400',
    textColor: 'text-red-800 dark:text-red-200',
  },
  warning: {
    icon: ExclamationTriangleIcon,
    bgColor: 'bg-amber-50 dark:bg-amber-950/50',
    borderColor: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-800 dark:text-amber-200',
  },
  info: {
    icon: InfoCircledIcon,
    bgColor: 'bg-blue-50 dark:bg-blue-950/50',
    borderColor: 'border-blue-200 dark:border-blue-800',
    iconColor: 'text-blue-600 dark:text-blue-400',
    textColor: 'text-blue-800 dark:text-blue-200',
  },
};

// Context
const ToastContext = createContext(null);

// Custom hook to use toast
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Individual Toast component
function ToastItem({ toast, onDismiss }) {
  const { icon: Icon, bgColor, borderColor, iconColor, textColor } = TOAST_TYPES[toast.type] || TOAST_TYPES.info;

  useEffect(() => {
    if (toast.duration !== Infinity) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration || 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`
        flex items-start gap-3 p-4 rounded-lg border shadow-lg backdrop-blur-sm
        ${bgColor} ${borderColor}
        max-w-md w-full
      `}
      role="alert"
      aria-live="polite"
    >
      <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${iconColor}`} />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className={`font-medium text-sm ${textColor}`}>
            {toast.title}
          </p>
        )}
        <p className={`text-sm ${textColor} ${toast.title ? 'mt-1 opacity-90' : ''}`}>
          {toast.message}
        </p>
        {toast.action && (
          <button
            onClick={() => {
              toast.action.onClick();
              onDismiss(toast.id);
            }}
            className={`mt-2 text-sm font-medium underline hover:no-underline ${iconColor}`}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className={`flex-shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors ${textColor}`}
        aria-label="Dismiss notification"
      >
        <Cross2Icon className="w-4 h-4" />
      </button>
    </motion.div>
  );
}

// Toast Container
function ToastContainer({ toasts, onDismiss }) {
  return (
    <div 
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      <AnimatePresence mode="sync">
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// Toast Provider
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((options) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const toast = {
      id,
      type: options.type || 'info',
      message: options.message,
      title: options.title,
      duration: options.duration ?? 5000,
      action: options.action,
    };
    setToasts((prev) => [...prev, toast]);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods
  const toast = useCallback((message, options = {}) => {
    return addToast({ message, ...options });
  }, [addToast]);

  toast.success = useCallback((message, options = {}) => {
    return addToast({ message, type: 'success', ...options });
  }, [addToast]);

  toast.error = useCallback((message, options = {}) => {
    return addToast({ message, type: 'error', duration: 7000, ...options });
  }, [addToast]);

  toast.warning = useCallback((message, options = {}) => {
    return addToast({ message, type: 'warning', ...options });
  }, [addToast]);

  toast.info = useCallback((message, options = {}) => {
    return addToast({ message, type: 'info', ...options });
  }, [addToast]);

  toast.promise = useCallback(async (promise, messages) => {
    const id = addToast({ 
      message: messages.loading || 'Loading...', 
      type: 'info',
      duration: Infinity 
    });
    
    try {
      const result = await promise;
      dismissToast(id);
      addToast({ 
        message: typeof messages.success === 'function' ? messages.success(result) : messages.success || 'Success!',
        type: 'success'
      });
      return result;
    } catch (error) {
      dismissToast(id);
      addToast({ 
        message: typeof messages.error === 'function' ? messages.error(error) : messages.error || error.message || 'Something went wrong',
        type: 'error'
      });
      throw error;
    }
  }, [addToast, dismissToast]);

  const contextValue = {
    toast,
    addToast,
    dismissToast,
    dismissAll,
    toasts,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// Confirmation Dialog Component (replaces window.confirm)
export function ConfirmDialog({ 
  open, 
  onOpenChange, 
  title = 'Confirm Action',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  variant = 'danger' // 'danger' | 'warning' | 'default'
}) {
  if (!open) return null;

  const variants = {
    danger: {
      confirmBg: 'bg-red-600 hover:bg-red-700',
      confirmText: 'text-white',
    },
    warning: {
      confirmBg: 'bg-amber-600 hover:bg-amber-700',
      confirmText: 'text-white',
    },
    default: {
      confirmBg: 'bg-blue-600 hover:bg-blue-700',
      confirmText: 'text-white',
    },
  };

  const { confirmBg, confirmText } = variants[variant] || variants.default;

  return (
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      
      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4 border border-gray-200 dark:border-gray-700"
      >
        <h2 
          id="confirm-dialog-title"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {description}
          </p>
        )}
        <div className="mt-6 flex gap-3 justify-end">
          <button
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
            className={`px-4 py-2 text-sm font-medium ${confirmText} ${confirmBg} rounded-lg transition-colors`}
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Hook for confirmation dialogs
export function useConfirm() {
  const [state, setState] = useState({
    open: false,
    title: '',
    description: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    variant: 'danger',
    resolve: null,
  });

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      setState({
        open: true,
        title: options.title || 'Confirm Action',
        description: options.description || 'Are you sure you want to proceed?',
        confirmLabel: options.confirmLabel || 'Confirm',
        cancelLabel: options.cancelLabel || 'Cancel',
        variant: options.variant || 'danger',
        resolve,
      });
    });
  }, []);

  const handleOpenChange = useCallback((open) => {
    if (!open && state.resolve) {
      state.resolve(false);
    }
    setState((prev) => ({ ...prev, open }));
  }, [state.resolve]);

  const handleConfirm = useCallback(() => {
    if (state.resolve) {
      state.resolve(true);
    }
  }, [state.resolve]);

  const ConfirmDialogComponent = (
    <ConfirmDialog
      open={state.open}
      onOpenChange={handleOpenChange}
      title={state.title}
      description={state.description}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      variant={state.variant}
      onConfirm={handleConfirm}
    />
  );

  return { confirm, ConfirmDialog: ConfirmDialogComponent };
}

export default ToastProvider;
