import { BACKEND_ORIGIN } from "@/lib/runtime";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function UnsubscribePage({ params }: PageProps) {
  const { token } = await params;
  const response = await fetch(`${BACKEND_ORIGIN}/api/v1/unsubscribe/${encodeURIComponent(token)}`, {
    cache: "no-store"
  });
  const payload = (await response.json()) as { message?: string; detail?: string };
  const success = response.ok;

  return (
    <div className="app-shell flex min-h-screen items-center justify-center p-6">
      <div className="glass-card w-full max-w-md p-8 text-center">
        <div className="mb-3 text-sm uppercase tracking-[0.3em] text-slate-500">CCA Campaign Manager</div>
        <h1 className="mb-4 text-3xl font-semibold text-white">Subscription Update</h1>
        <p className={success ? "text-emerald-300" : "text-rose-300"}>
          {success ? payload.message || "Subscription updated." : payload.detail || "Unable to update subscription."}
        </p>
      </div>
    </div>
  );
}
