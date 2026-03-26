import Link from "next/link";

import { BrandLogo } from "@/components/ui/brand-logo";

export default function NotFound() {
  return (
    <div className="app-shell flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute right-[-10%] top-[-10%] h-[40%] w-[40%] rounded-full bg-purple-600/20 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] left-[-10%] h-[40%] w-[40%] rounded-full bg-blue-600/10 blur-[120px] mix-blend-screen" />
      </div>

      <div className="glass-card relative z-10 w-full max-w-xl p-8 text-center">
        <div className="mb-6 flex justify-center">
          <BrandLogo size="lg" />
        </div>
        <p className="text-xs uppercase tracking-[0.22em] text-slate-500">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Page not found</h1>
        <p className="mt-3 text-sm text-slate-400">
          The page you requested does not exist or may have moved.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/" className="ghost-button px-4 py-2 text-sm">
            Go Home
          </Link>
          <Link href="/dashboard" className="premium-button px-4 py-2 text-sm">
            Open Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
