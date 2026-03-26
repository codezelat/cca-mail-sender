"use client";

import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import { apiFetch } from "@/lib/api";
import type { SessionUser } from "@/lib/types";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/templates", label: "Templates" },
  { href: "/dashboard/contacts", label: "Contacts" }
];

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { pushToast } = useToast();
  const sessionQuery = useQuery({
    queryKey: ["session-user"],
    queryFn: () => apiFetch<{ user: SessionUser }>("/api/v1/auth/me")
  });

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
    <div className="app-shell min-h-screen pb-12">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top,_rgba(124,58,237,0.18),_transparent_45%)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-[320px] w-[320px] rounded-full bg-blue-500/10 blur-[140px]" />

      <header className="page-container relative z-10 pt-8">
        <div className="bento-card px-5 py-4">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <BrandLogo />
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">CCA Campaign Manager</div>
                <h1 className="text-2xl font-semibold text-white">Operations Console</h1>
              </div>
            </div>
            <div className="flex flex-col gap-4 lg:items-end">
              <div className="flex flex-wrap gap-2">
                {navigation.map((item) => {
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={clsx(
                        "rounded-full border px-4 py-2 text-sm transition",
                        active
                          ? "border-purple-400/35 bg-purple-500/15 font-semibold text-purple-100"
                          : "border-transparent text-slate-300 hover:border-white/20 hover:text-white"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300">
                  {sessionQuery.data?.user.email || "Loading..."}
                </div>
                <button onClick={onLogout} className="ghost-button rounded-full px-4 py-2 text-sm">
                  Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="page-container relative z-10 mt-8">{children}</main>
    </div>
  );
}
