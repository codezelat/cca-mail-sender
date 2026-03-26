"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { BrandLogo } from "@/components/ui/brand-logo";
import { apiFetch } from "@/lib/api";

type AuthMode = "login" | "signup";

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const copy =
    mode === "login"
      ? {
          heading: "Welcome back",
          subheading: "Sign in to your dashboard",
          action: "Sign In",
          endpoint: "/api/v1/auth/login",
          altHref: "/signup",
          altLabel: "Sign up",
          altText: "Don't have an account?"
        }
      : {
          heading: "Create account",
          subheading: "Start your campaign journey today",
          action: "Create Account",
          endpoint: "/api/v1/auth/signup",
          altHref: "/login",
          altLabel: "Sign in",
          altText: "Already have an account?"
        };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch(copy.endpoint, {
        method: "POST",
        bodyJson: { email, password }
      });
      pushToast("Success", mode === "login" ? "Logged in successfully." : "Account created successfully.");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      pushToast(
        mode === "login" ? "Login Failed" : "Signup Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute right-[-10%] top-[-10%] h-[40%] w-[40%] animate-pulse rounded-full bg-purple-600/20 blur-[120px] mix-blend-screen" />
        <div className="absolute bottom-[-10%] left-[-10%] h-[40%] w-[40%] animate-pulse rounded-full bg-blue-600/10 blur-[120px] mix-blend-screen [animation-delay:2s]" />
      </div>

      <div className="glass-card group relative z-10 w-full max-w-md overflow-hidden p-8">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 transition-opacity duration-700 group-hover:opacity-100" />

        <div className="relative mb-8 text-center">
          <div className="mx-auto mb-4 flex justify-center">
            <BrandLogo size="lg" />
          </div>
          <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
            {copy.heading}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{copy.subheading}</p>
        </div>

        <form className="relative space-y-5" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <label className="ml-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Email
            </label>
            <input
              type="email"
              className="premium-input"
              placeholder="name@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="ml-1 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Password
            </label>
            <input
              type="password"
              className="premium-input"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={submitting} className="premium-button mt-2 flex h-12 w-full gap-2 shadow-[0_0_25px_rgba(255,255,255,0.18)]">
            <span>{submitting ? "Working..." : copy.action}</span>
            <svg className="h-4 w-4 text-slate-500 transition-colors group-hover:text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0-7 7m7-7H3" />
            </svg>
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">
            {copy.altText}{" "}
            <Link href={copy.altHref} className="font-medium text-white decoration-purple-500/50 underline-offset-4 transition-colors hover:text-purple-400 hover:underline">
              {copy.altLabel}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
