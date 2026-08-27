'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const typeConfig: Record<ToastType, { icon: React.ReactNode; className: string }> = {
  success: {
    icon: <CheckCircle className="h-5 w-5 text-emerald-500" />,
    className: 'border-emerald-200 bg-emerald-50',
  },
  error: {
    icon: <AlertCircle className="h-5 w-5 text-red-500" />,
    className: 'border-red-200 bg-red-50',
  },
  info: {
    icon: <Info className="h-5 w-5 text-blue-500" />,
    className: 'border-blue-200 bg-blue-50',
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((opts: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const contextValue: ToastContextValue = {
    toast: addToast,
    success: (title, description) => addToast({ type: 'success', title, description }),
    error: (title, description) => addToast({ type: 'error', title, description }),
    info: (title, description) => addToast({ type: 'info', title, description }),
  };

  return (
    <ToastContext.Provider value={contextValue}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => {
          const config = typeConfig[t.type];
          return (
            <ToastPrimitive.Root
              key={t.id}
              open={true}
              onOpenChange={(open) => !open && removeToast(t.id)}
              duration={4000}
              className={cn(
                'flex items-start gap-3 p-4 rounded-xl border shadow-lg',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full',
                'data-[state=open]:slide-in-from-top-full data-[state=open]:sm:slide-in-from-bottom-full',
                config.className,
              )}
            >
              <div className="shrink-0 mt-0.5">{config.icon}</div>
              <div className="flex-1 min-w-0">
                <ToastPrimitive.Title className="text-sm font-semibold text-gray-900">
                  {t.title}
                </ToastPrimitive.Title>
                {t.description && (
                  <ToastPrimitive.Description className="text-sm text-gray-600 mt-0.5">
                    {t.description}
                  </ToastPrimitive.Description>
                )}
              </div>
              <ToastPrimitive.Close asChild>
                <button className="p-0.5 rounded text-gray-400 hover:text-gray-600">
                  <X className="h-4 w-4" />
                </button>
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export default ToastProvider;
