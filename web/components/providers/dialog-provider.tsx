"use client";

import {
  createContext,
  KeyboardEvent,
  ReactNode,
  useContext,
  useMemo,
  useRef,
  useState
} from "react";

type ConfirmOptions = {
  title?: string;
  message: string;
};

type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
};

type DialogState =
  | {
      type: "confirm";
      title: string;
      message: string;
    }
  | {
      type: "prompt";
      title: string;
      message: string;
      defaultValue: string;
    }
  | null;

type DialogContextValue = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const resolverRef = useRef<((value: unknown) => void) | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState("");

  function closeWith(value: boolean | string | null) {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setDialog(null);
    setPromptValue("");
  }

  const value = useMemo<DialogContextValue>(
    () => ({
      confirm(options) {
        return new Promise<boolean>((resolve) => {
          resolverRef.current = resolve as unknown as (value: unknown) => void;
          setDialog({
            type: "confirm",
            title: options.title || "Are you sure?",
            message: options.message
          });
        });
      },
      prompt(options) {
        return new Promise<string | null>((resolve) => {
          resolverRef.current = resolve as unknown as (value: unknown) => void;
          setPromptValue(options.defaultValue || "");
          setDialog({
            type: "prompt",
            title: options.title,
            message: options.message || "",
            defaultValue: options.defaultValue || ""
          });
        });
      }
    }),
    []
  );

  function onPromptKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      closeWith(promptValue);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeWith(null);
    }
  }

  return (
    <DialogContext.Provider value={value}>
      {children}

      {dialog?.type === "confirm" ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10">
              <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-white">{dialog.title}</h3>
            <p className="mb-6 text-sm text-gray-400">{dialog.message}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => closeWith(false)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => closeWith(true)}
                className="flex-1 rounded-xl bg-red-500/80 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_15px_rgba(239,68,68,0.2)] transition hover:bg-red-500"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {dialog?.type === "prompt" ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0a0a0a] p-6 shadow-2xl">
            <h3 className="mb-2 text-lg font-semibold text-white">{dialog.title}</h3>
            <p className="mb-4 text-sm text-gray-400">{dialog.message}</p>
            <input
              type="text"
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={onPromptKeyDown}
              autoFocus
              className="mb-6 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => closeWith(null)}
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => closeWith(promptValue)}
                className="flex-1 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)] transition hover:bg-gray-200"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used inside DialogProvider");
  }
  return context;
}
