"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import { apiFetch } from "@/lib/api";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/contacts", label: "Contacts" }
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();

  async function onLogout() {
    try {
      await apiFetch("/api/v1/auth/logout", { method: "POST", bodyJson: {} });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      pushToast("Logout Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  return (
    <div className="dashboard-shell selection:bg-purple-500/30">
      <div className="hero-glow" />

      <nav className="glass-nav sticky top-0 z-50 transition-all duration-300">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <BrandLogo size="sm" />
              <span className="text-sm font-semibold tracking-wide text-gray-200">
                CCA Campaign Manager
              </span>
            </div>
            <div className="hidden items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-sm md:flex">
              {navigation.map((item) => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={clsx(
                      "rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                      active
                        ? "border border-purple-400/35 bg-purple-500/15 text-purple-100"
                        : "text-gray-400 hover:text-white"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onLogout}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-all hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
            >
              Sign Out
            </button>
          </div>
        </div>
        <div className="mx-auto px-4 pb-3 md:hidden">
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/5 p-1 backdrop-blur-md">
            {navigation.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={clsx(
                    "rounded-xl px-2 py-2 text-center text-xs font-semibold",
                    active
                      ? "bg-purple-500/15 text-purple-100"
                      : "text-gray-300"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="relative z-10 mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        {children}
      </main>
    </div>
  );
}
