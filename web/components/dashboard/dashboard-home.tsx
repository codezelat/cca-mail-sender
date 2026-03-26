"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { API_BASE_URL, apiFetch, buildUploadForm } from "@/lib/api";
import type {
  BatchSummary,
  ImportAnalysis,
  RecipientActivityItem,
  SettingsRecord,
  TemplateSummary
} from "@/lib/types";

type StatsResponse = {
  total_contacts: number;
  templates: number;
  batches: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  emails_sent_today: number;
  emails_sent_this_hour: number;
  daily_limit: number;
  hourly_limit: number;
  default_template_id?: number | null;
};

export function DashboardHome() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [settingsDraft, setSettingsDraft] = useState<SettingsRecord | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [importSession, setImportSession] = useState<ImportAnalysis | null>(null);
  const [stagedBatch, setStagedBatch] = useState<BatchSummary | null>(null);
  const [activityFilter, setActivityFilter] = useState("");

  const statsQuery = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiFetch<StatsResponse>("/api/v1/stats")
  });
  const settingsQuery = useQuery({
    queryKey: ["dashboard-settings"],
    queryFn: () => apiFetch<SettingsRecord>("/api/v1/settings")
  });
  const templatesQuery = useQuery({
    queryKey: ["dashboard-templates"],
    queryFn: () => apiFetch<{ templates: TemplateSummary[]; default_template_id?: number | null }>("/api/v1/templates")
  });
  const batchesQuery = useQuery({
    queryKey: ["dashboard-batches"],
    queryFn: () => apiFetch<{ batches: BatchSummary[] }>("/api/v1/batches")
  });
  const activityQuery = useQuery({
    queryKey: ["dashboard-activity", activityFilter],
    queryFn: () =>
      apiFetch<{ rows: RecipientActivityItem[] }>(
        `/api/v1/activity?status=${encodeURIComponent(activityFilter)}`
      )
  });

  const publishedTemplates = useMemo(
    () => (templatesQuery.data?.templates || []).filter((item) => item.published_version && !item.is_archived),
    [templatesQuery.data]
  );

  useEffect(() => {
    if (settingsQuery.data && !settingsDraft) {
      setSettingsDraft(settingsQuery.data);
    }
    if (!selectedTemplateId && templatesQuery.data?.default_template_id) {
      setSelectedTemplateId(templatesQuery.data.default_template_id);
    }
  }, [settingsQuery.data, settingsDraft, selectedTemplateId, templatesQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: (payload: SettingsRecord) =>
      apiFetch("/api/v1/settings", { method: "POST", bodyJson: payload }),
    onSuccess: (data) => {
      pushToast("Saved", "Settings updated successfully.");
      const nextSettings = (data as { settings: SettingsRecord }).settings;
      setSettingsDraft(nextSettings);
      queryClient.setQueryData(["dashboard-settings"], nextSettings);
      void queryClient.invalidateQueries({ queryKey: ["dashboard-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-templates"] });
    },
    onError: (error) => {
      pushToast("Save Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const validateMutation = useMutation({
    mutationFn: (sessionId: number) =>
      apiFetch<{ validation: ImportAnalysis }>(`/api/v1/imports/${sessionId}/validate`, {
        method: "POST",
        bodyJson: {}
      }),
    onSuccess: (data) => {
      setImportSession(data.validation);
      pushToast("Validated", "Import validation completed.");
    },
    onError: (error) => {
      pushToast("Validation Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const stageMutation = useMutation({
    mutationFn: (sessionId: number) =>
      apiFetch<{ batch: BatchSummary }>(`/api/v1/imports/${sessionId}/stage`, {
        method: "POST",
        bodyJson: {}
      }),
    onSuccess: (data) => {
      setStagedBatch(data.batch);
      pushToast("Batch Staged", "Recipients are staged and ready to launch.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] });
    },
    onError: (error) => {
      pushToast("Stage Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const launchMutation = useMutation({
    mutationFn: (batchId: number) =>
      apiFetch<{ batch: BatchSummary }>(`/api/v1/batches/${batchId}/launch`, {
        method: "POST",
        bodyJson: {}
      }),
    onSuccess: () => {
      pushToast("Batch Launched", "Recipients have been enqueued.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error) => {
      pushToast("Launch Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  async function analyzeImport() {
    if (!selectedTemplateId || !uploadedFile) {
      pushToast("Missing Input", "Choose a published template and import file first.", "error");
      return;
    }
    try {
      const formData = buildUploadForm({
        template_id: selectedTemplateId,
        file: uploadedFile
      });
      const data = await apiFetch<{ import_session: ImportAnalysis }>("/api/v1/imports/analyze", {
        method: "POST",
        body: formData
      });
      setImportSession(data.import_session);
      pushToast("Analyzed", "Import file analyzed successfully.");
    } catch (error) {
      pushToast("Analyze Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function updateMapping(fieldKey: string, columnName: string) {
    if (!importSession) return;
    try {
      const data = await apiFetch<{ import_session: ImportAnalysis }>(
        `/api/v1/imports/${importSession.id}/mapping`,
        {
          method: "POST",
          bodyJson: {
            mapping: {
              ...importSession.mapping,
              [fieldKey]: columnName
            },
            selected_sheet: importSession.selected_sheet || null
          }
        }
      );
      setImportSession(data.import_session);
    } catch (error) {
      pushToast("Mapping Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  function onSettingsChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    if (!settingsDraft) return;
    const { name } = event.target;
    let nextValue: string | number | boolean | null =
      event.target instanceof HTMLInputElement && event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    if (name === "hourly_limit" || name === "daily_limit") {
      nextValue = Number(event.target.value);
    }
    if (name === "default_template_id") {
      nextValue = event.target.value ? Number(event.target.value) : null;
    }
    const nextDraft = {
      ...settingsDraft,
      [name]: nextValue
    };
    if (name === "use_env_brevo_api_key" && nextValue === true) {
      nextDraft.clear_manual_brevo_api_key = false;
      nextDraft.brevo_api_key = "";
    }
    if (name === "clear_manual_brevo_api_key" && nextValue === true) {
      nextDraft.brevo_api_key = "";
    }
    setSettingsDraft(nextDraft);
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            { label: "Contacts", value: statsQuery.data?.total_contacts ?? 0 },
            { label: "Templates", value: statsQuery.data?.templates ?? 0 },
            { label: "Batches", value: statsQuery.data?.batches ?? 0 },
            { label: "Queued", value: statsQuery.data?.queued ?? 0 },
            { label: "Sent", value: statsQuery.data?.sent ?? 0 },
            { label: "Failed", value: statsQuery.data?.failed ?? 0 }
          ].map((card) => (
            <article key={card.label} className="bento-card p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{card.label}</div>
              <div className="mt-3 text-3xl font-semibold text-white">{card.value}</div>
            </article>
          ))}
        </section>

        <section className="bento-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Launch a Campaign</h2>
              <p className="mt-1 text-sm text-slate-400">
                Validate imports against a published template before staging or launching.
              </p>
            </div>
            <button className="ghost-button px-4 py-2 text-sm" onClick={analyzeImport}>
              Analyze File
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <label className="block text-xs uppercase tracking-[0.18em] text-slate-500">
                Published Template
              </label>
              <select
                className="premium-input py-3"
                value={selectedTemplateId ?? ""}
                onChange={(event) =>
                  setSelectedTemplateId(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Choose a published template</option>
                {publishedTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} · v{template.published_version?.version_number}
                  </option>
                ))}
              </select>
              <input
                type="file"
                className="premium-input py-3"
                accept=".csv,.xlsx,.xls"
                onChange={(event) => setUploadedFile(event.target.files?.[0] || null)}
              />
              {uploadedFile ? <p className="text-xs text-purple-300">{uploadedFile.name}</p> : null}
            </div>

            <div className="space-y-3">
              <label className="block text-xs uppercase tracking-[0.18em] text-slate-500">
                Mapping
              </label>
              <div className="space-y-2">
                {(importSession?.mappable_fields || []).map((field) => (
                  <div key={field.key} className="grid grid-cols-[1fr_1fr] gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
                      {field.label}
                      {field.required ? <span className="ml-2 text-[10px] uppercase text-amber-300">required</span> : null}
                    </div>
                    <select
                      className="premium-input py-3"
                      value={importSession?.mapping?.[field.key] || ""}
                      onChange={(event) => void updateMapping(field.key, event.target.value)}
                    >
                      <option value="">Select column</option>
                      {(importSession?.detected_columns || []).map((column) => (
                        <option key={column} value={column}>
                          {column}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {importSession ? (
            <div className="mt-6 space-y-4">
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                <span>Total rows: {importSession.summary_counts?.total_rows || 0}</span>
                <span>Valid: {importSession.summary_counts?.valid_rows || 0}</span>
                <span>Invalid: {importSession.summary_counts?.invalid_rows || 0}</span>
                <span>Created: {importSession.summary_counts?.created || 0}</span>
                <span>Updated: {importSession.summary_counts?.updated || 0}</span>
              </div>

              {importSession.warnings?.length ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {importSession.warnings.join(" ")}
                </div>
              ) : null}

              {importSession.row_errors_preview?.length ? (
                <div className="rounded-xl border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">
                  {importSession.row_errors_preview.slice(0, 4).map((error) => (
                    <div key={`${error.row_number}-${error.error}`}>
                      Row {error.row_number}: {error.error}
                      {error.details ? ` (${error.details})` : ""}
                    </div>
                  ))}
                  {importSession.error_report_available ? (
                    <a
                      href={`${API_BASE_URL}/api/v1/imports/${importSession.id}/error-report`}
                      target="_blank"
                      className="mt-3 inline-flex text-xs text-white underline"
                    >
                      Download full error report
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  className="ghost-button px-4 py-2 text-sm"
                  onClick={() => validateMutation.mutate(importSession.id)}
                  disabled={validateMutation.isPending}
                >
                  {validateMutation.isPending ? "Validating..." : "Validate"}
                </button>
                <button
                  className="ghost-button px-4 py-2 text-sm"
                  onClick={() => stageMutation.mutate(importSession.id)}
                  disabled={stageMutation.isPending}
                >
                  {stageMutation.isPending ? "Staging..." : "Stage"}
                </button>
                {stagedBatch ? (
                  <button
                    className="premium-button px-4 py-2 text-sm"
                    onClick={() => launchMutation.mutate(stagedBatch.id)}
                    disabled={launchMutation.isPending}
                  >
                    {launchMutation.isPending ? "Launching..." : "Launch"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="bento-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Recent Batches</h2>
            <button className="ghost-button px-4 py-2 text-sm" onClick={() => void batchesQuery.refetch()}>
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.18em] text-slate-500">
                <tr>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Counts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-slate-300">
                {(batchesQuery.data?.batches || []).map((batch) => (
                  <tr key={batch.id}>
                    <td className="px-4 py-4">
                      <div className="font-medium text-white">{batch.name}</div>
                      <div className="text-xs text-slate-500">{batch.source_filename || "Manual batch"}</div>
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge value={batch.status} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-white">{batch.template_name}</div>
                      <div className="text-xs text-slate-500">{batch.subject}</div>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-400">
                      {batch.created} created · {batch.updated} updated · {batch.sent} sent · {batch.failed} failed
                    </td>
                  </tr>
                ))}
                {!batchesQuery.data?.batches?.length ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                      No batches yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="space-y-6">
        <section className="bento-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Settings</h2>
              <p className="mt-1 text-sm text-slate-400">Sender identity, limits, and default template.</p>
            </div>
          </div>
          {settingsDraft ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                settingsMutation.mutate(settingsDraft);
              }}
            >
              {(settingsDraft.env_has_brevo_api_key || settingsDraft.env_has_sender_identity) ? (
                <div className="rounded-2xl border border-sky-400/15 bg-sky-400/10 px-4 py-3 text-sm text-sky-100">
                  Server environment defaults are available. You can keep credentials in `.env` and use
                  them here without pasting secrets into the dashboard.
                </div>
              ) : null}
              <div className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-white">Brevo Delivery</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Use the server-side `.env` key or keep a manual key stored for this account.
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {settingsDraft.use_env_brevo_api_key
                      ? "Using .env"
                      : settingsDraft.has_manual_brevo_api_key
                        ? "Manual key saved"
                        : settingsDraft.effective_brevo_api_key_configured
                          ? "Configured"
                          : "Missing"}
                  </span>
                </div>
                {settingsDraft.env_has_brevo_api_key ? (
                  <label className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-3 text-sm text-slate-200">
                    <input
                      name="use_env_brevo_api_key"
                      type="checkbox"
                      checked={settingsDraft.use_env_brevo_api_key}
                      onChange={onSettingsChange}
                    />
                    <span>Use `BREVO_SMTP_API_KEY` from the server `.env`</span>
                  </label>
                ) : null}
                <input
                  name="brevo_api_key"
                  type="password"
                  placeholder={
                    settingsDraft.use_env_brevo_api_key
                      ? "Using BREVO_SMTP_API_KEY from .env"
                      : settingsDraft.has_manual_brevo_api_key
                        ? "Leave blank to keep the saved Brevo key"
                        : "Brevo API Key"
                  }
                  className="premium-input"
                  value={settingsDraft.brevo_api_key || ""}
                  onChange={onSettingsChange}
                  disabled={settingsDraft.use_env_brevo_api_key}
                />
                {!settingsDraft.use_env_brevo_api_key && settingsDraft.has_manual_brevo_api_key ? (
                  <label className="flex items-center gap-3 text-xs text-slate-400">
                    <input
                      name="clear_manual_brevo_api_key"
                      type="checkbox"
                      checked={Boolean(settingsDraft.clear_manual_brevo_api_key)}
                      onChange={onSettingsChange}
                    />
                    <span>Remove the saved manual Brevo key on the next save</span>
                  </label>
                ) : null}
              </div>
              <div className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-white">Sender Identity</div>
                    <p className="mt-1 text-xs text-slate-400">
                      Choose between server-level `.env` sender defaults and per-account sender details.
                    </p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    {settingsDraft.use_env_sender_identity ? "Using .env" : "Manual override"}
                  </span>
                </div>
                {settingsDraft.env_has_sender_identity ? (
                  <label className="flex items-center gap-3 rounded-xl border border-white/5 bg-black/20 px-3 py-3 text-sm text-slate-200">
                    <input
                      name="use_env_sender_identity"
                      type="checkbox"
                      checked={settingsDraft.use_env_sender_identity}
                      onChange={onSettingsChange}
                    />
                    <span>
                      Use `.env` sender identity
                      {settingsDraft.effective_sender_email ? ` (${settingsDraft.effective_sender_email})` : ""}
                    </span>
                  </label>
                ) : null}
                {settingsDraft.use_env_sender_identity ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    <input
                      className="premium-input"
                      value={settingsDraft.effective_sender_email || ""}
                      disabled
                      readOnly
                    />
                    <input
                      className="premium-input"
                      value={settingsDraft.effective_sender_name || ""}
                      disabled
                      readOnly
                    />
                  </div>
                ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  name="sender_email"
                  type="email"
                  placeholder="Sender Email"
                  className="premium-input"
                  value={settingsDraft.sender_email || ""}
                  onChange={onSettingsChange}
                  disabled={settingsDraft.use_env_sender_identity}
                />
                <input
                  name="sender_name"
                  type="text"
                  placeholder="Sender Name"
                  className="premium-input"
                  value={settingsDraft.sender_name || ""}
                  onChange={onSettingsChange}
                  disabled={settingsDraft.use_env_sender_identity}
                />
                <input
                  name="hourly_limit"
                  type="number"
                  placeholder="Hourly Limit"
                  className="premium-input"
                  value={settingsDraft.hourly_limit}
                  onChange={onSettingsChange}
                />
                <input
                  name="daily_limit"
                  type="number"
                  placeholder="Daily Limit"
                  className="premium-input"
                  value={settingsDraft.daily_limit}
                  onChange={onSettingsChange}
                />
              </div>
              </div>
              <select
                name="default_template_id"
                className="premium-input py-3"
                value={settingsDraft.default_template_id || ""}
                onChange={onSettingsChange}
              >
                <option value="">Choose default template</option>
                {(templatesQuery.data?.templates || []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xs text-slate-400">
                <span>
                  {statsQuery.data?.emails_sent_this_hour || 0}/{statsQuery.data?.hourly_limit || 0} hr ·{" "}
                  {statsQuery.data?.emails_sent_today || 0}/{statsQuery.data?.daily_limit || 0} day
                </span>
                <button className="premium-button px-4 py-2 text-sm" disabled={settingsMutation.isPending}>
                  {settingsMutation.isPending ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          ) : (
            <div className="text-sm text-slate-500">Loading settings...</div>
          )}
        </section>

        <section className="bento-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Live Activity</h2>
            <select
              className="premium-input w-40 py-2 text-xs"
              value={activityFilter}
              onChange={(event) => setActivityFilter(event.target.value)}
            >
              <option value="">All statuses</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="unsubscribed">Unsubscribed</option>
            </select>
          </div>
          <div className="space-y-3">
            {(activityQuery.data?.rows || []).map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-white">{item.email}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {item.batch_name || "Campaign batch"} · {item.template_subject || "Campaign Update"}
                    </div>
                    {item.error_message ? (
                      <div className="mt-2 text-xs text-rose-300">{item.error_message}</div>
                    ) : null}
                  </div>
                  <StatusBadge value={item.status} />
                </div>
              </article>
            ))}
            {!activityQuery.data?.rows?.length ? (
              <div className="text-sm text-slate-500">No recent activity.</div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
