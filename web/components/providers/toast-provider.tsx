"use client";

import { createContext, ReactNode, useContext, useMemo, useState } from "react";

type ToastTone = "success" | "error";

type ToastItem = {
  id: number;
  title: string;
  message: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (title: string, message: string, tone?: ToastTone) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      pushToast(title, message, tone = "success") {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        setToasts((current) => [...current, { id, title, message, tone }]);
        window.setTimeout(() => {
          setToasts((current) => current.filter((item) => item.id !== id));
        }, 4000);
      }
    }),
    []
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-6 top-6 z-[100] flex flex-col gap-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto w-80 rounded-xl border p-4 shadow-2xl backdrop-blur-md ${
              toast.tone === "error"
                ? "border-red-500/20 bg-red-500/10"
                : "border-emerald-500/20 bg-emerald-500/10"
            }`}
          >
            <h3 className="text-sm font-medium text-white">{toast.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{toast.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return context;
}
