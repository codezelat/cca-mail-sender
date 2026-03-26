import Link from "next/link";

import { BrandLogo } from "@/components/ui/brand-logo";

const stats = [
  { label: "Contacts", value: "20k+" },
  { label: "Templates", value: "Versioned" },
  { label: "Delivery", value: "Rate-aware" }
];

export default function LandingPage() {
  return (
    <div className="app-shell overflow-x-hidden">
      <nav className="glass-nav fixed inset-x-0 top-0 z-50">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <BrandLogo size="sm" />
            <span className="text-sm font-semibold tracking-wide text-slate-200">
              CCA Campaign Manager
            </span>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm text-slate-400 transition-colors hover:text-white">
              Features
            </a>
            <a
              href="https://github.com/codezelat/cca-mail-sender"
              target="_blank"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              GitHub
            </a>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="px-2 text-sm text-slate-400 transition-colors hover:text-white">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black shadow-glow transition-colors hover:bg-slate-200"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </nav>

      <main className="page-container flex flex-col items-center pb-20 pt-32">
        <div className="hero-glow animate-soft-pulse" />
        <section className="relative z-10 max-w-4xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-purple-300 backdrop-blur-sm">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-purple-500" />
            </span>
            v2.0 Now Available with Multi-user Support
          </div>
          <h1 className="mb-8 text-5xl font-bold tracking-tight md:text-7xl">
            <span className="bg-gradient-to-b from-white via-white to-white/40 bg-clip-text text-transparent">
              Ship campaigns
            </span>
            <br />
            <span className="text-slate-500">without the limits.</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-400 md:text-xl">
            The open-source email manager for Brevo. Handle rate limits, manage multiple
            users, and visualize your growth with a premium, persistent dashboard.
          </p>
          <div className="mb-24 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="flex h-12 min-w-[160px] items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-black shadow-glow transition-all hover:bg-slate-200"
            >
              Start Deploying
            </Link>
            <a
              href="https://github.com/codezelat/cca-mail-sender"
              target="_blank"
              className="flex h-12 min-w-[160px] items-center justify-center rounded-full border border-slate-800 bg-slate-900 px-8 text-sm font-medium text-slate-300 transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white"
            >
              View Documentation
            </a>
          </div>
        </section>

        <section className="relative z-10 w-full max-w-5xl">
          <div className="rounded-xl border border-white/10 bg-[#0c0c0c] p-6 shadow-panel">
            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="hidden border-r border-white/5 pr-6 md:flex md:flex-col md:gap-4">
                <BrandLogo size="sm" />
                <div className="h-2 w-20 rounded-full bg-white/20" />
                <div className="h-2 w-32 rounded-full bg-white/10" />
                <div className="h-2 w-24 rounded-full bg-white/10" />
                <div className="h-2 w-28 rounded-full bg-white/10" />
                <div className="mt-auto h-2 w-20 rounded-full bg-red-500/20" />
              </div>
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded-full bg-white/20" />
                    <div className="h-2 w-48 rounded-full bg-white/10" />
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 w-8 rounded-full bg-white/10" />
                    <div className="h-8 w-8 rounded-full bg-blue-500/20" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  {stats.map((stat) => (
                    <div key={stat.label} className="rounded-lg border border-white/5 bg-slate-800/20 p-4">
                      <div className="mb-2 h-2 w-16 rounded-full bg-white/10" />
                      <div className="text-xl font-semibold text-white">{stat.value}</div>
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {stat.label}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex h-52 items-end gap-2 overflow-hidden rounded-lg border border-white/5 bg-slate-800/20 p-4">
                  {["40%", "68%", "52%", "80%", "58%", "92%", "74%", "88%"].map((height) => (
                    <div key={height} className="w-full rounded-t-sm bg-blue-500/15" style={{ height }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="relative z-10 mt-20 grid w-full gap-6 md:grid-cols-3">
          {[
            {
              title: "Exact template control",
              copy: "Versioned templates, live previews, test sends, and import-time field validation."
            },
            {
              title: "Operational safety",
              copy: "Secure cookie sessions, rate-aware dispatch, and deterministic sends from locked template versions."
            },
            {
              title: "Production delivery",
              copy: "FastAPI + Postgres + Redis architecture with dedicated workers and route-based web UI."
            }
          ].map((feature) => (
            <article key={feature.title} className="bento-card p-6">
              <div className="mb-3 text-xs uppercase tracking-[0.2em] text-purple-300">Feature</div>
              <h2 className="mb-2 text-xl font-semibold text-white">{feature.title}</h2>
              <p className="text-sm leading-7 text-slate-400">{feature.copy}</p>
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
