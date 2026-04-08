"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { API_BASE_URL, apiFetch, buildUploadForm } from "@/lib/api";
import type {
  BatchSummary,
  ImportAnalysis,
  RecipientActivityItem,
  SettingsRecord,
  TemplateSummary,
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

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DashboardHome() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SettingsRecord | null>(
    null,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [importSession, setImportSession] = useState<ImportAnalysis | null>(
    null,
  );
  const [stagedBatch, setStagedBatch] = useState<BatchSummary | null>(null);
  const [activityFilter, setActivityFilter] = useState("");

  const statsQuery = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiFetch<StatsResponse>("/api/v1/stats"),
  });
  const settingsQuery = useQuery({
    queryKey: ["dashboard-settings"],
    queryFn: () => apiFetch<SettingsRecord>("/api/v1/settings"),
  });
  const templatesQuery = useQuery({
    queryKey: ["dashboard-templates"],
    queryFn: () =>
      apiFetch<{
        templates: TemplateSummary[];
        default_template_id?: number | null;
      }>("/api/v1/templates"),
  });
  const batchesQuery = useQuery({
    queryKey: ["dashboard-batches"],
    queryFn: () => apiFetch<{ batches: BatchSummary[] }>("/api/v1/batches"),
  });
  const activityQuery = useQuery({
    queryKey: ["dashboard-activity", activityFilter],
    queryFn: () =>
      apiFetch<{ rows: RecipientActivityItem[] }>(
        `/api/v1/activity?status=${encodeURIComponent(activityFilter)}`,
      ),
  });

  const publishedTemplates = useMemo(
    () =>
      (templatesQuery.data?.templates || []).filter(
        (item) => item.published_version && !item.is_archived,
      ),
    [templatesQuery.data],
  );
  const selectedPublishedTemplate = useMemo(
    () =>
      publishedTemplates.find((item) => item.id === selectedTemplateId) || null,
    [publishedTemplates, selectedTemplateId],
  );
  const selectedTemplateFields = useMemo(() => {
    const fields = (
      selectedPublishedTemplate?.published_version?.merge_fields_schema || []
    ).filter((field) => field.key !== "unsubscribe_url");
    return {
      required: fields.filter((field) => field.required),
      optional: fields.filter((field) => !field.required),
    };
  }, [selectedPublishedTemplate]);
  const providerLabel =
    settingsDraft?.provider === "kit"
      ? "Kit"
      : settingsDraft?.provider === "brevo"
        ? "Brevo"
        : "Provider";
  const providerEnvKey =
    settingsDraft?.provider === "kit" ? "KIT_API_KEY" : "BREVO_SMTP_API_KEY";

  useEffect(() => {
    if (settingsQuery.data) {
      setSettingsDraft(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  useEffect(() => {
    if (selectedTemplateId) return;
    const templateId =
      settingsQuery.data?.default_template_id ||
      templatesQuery.data?.default_template_id ||
      null;
    if (templateId) {
      setSelectedTemplateId(templateId);
    }
  }, [selectedTemplateId, settingsQuery.data, templatesQuery.data]);

  const settingsMutation = useMutation({
    mutationFn: (payload: SettingsRecord) =>
      apiFetch<{ settings: SettingsRecord }>("/api/v1/settings", {
        method: "POST",
        bodyJson: payload,
      }),
    onSuccess: async (data) => {
      pushToast("Settings Saved", "Sender settings were updated.");
      setSettingsDraft(data.settings);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-settings"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-templates"] }),
      ]);
    },
    onError: (error) => {
      pushToast(
        "Save Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    },
  });

  const validateMutation = useMutation({
    mutationFn: (sessionId: number) =>
      apiFetch<{ validation: ImportAnalysis }>(
        `/api/v1/imports/${sessionId}/validate`,
        {
          method: "POST",
          bodyJson: {},
        },
      ),
    onSuccess: (data) => {
      setImportSession(data.validation);
      pushToast(
        "Validation Complete",
        "The import file was checked against the selected template.",
      );
    },
    onError: (error) => {
      pushToast(
        "Validation Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    },
  });

  const stageMutation = useMutation({
    mutationFn: (sessionId: number) =>
      apiFetch<{ batch: BatchSummary }>(`/api/v1/imports/${sessionId}/stage`, {
        method: "POST",
        bodyJson: {},
      }),
    onSuccess: async (data) => {
      setStagedBatch(data.batch);
      pushToast("Batch Staged", `${data.batch.name} is ready to launch.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
    },
    onError: (error) => {
      pushToast(
        "Staging Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    },
  });

  const launchMutation = useMutation({
    mutationFn: (batchId: number) =>
      apiFetch<{ batch: BatchSummary }>(`/api/v1/batches/${batchId}/launch`, {
        method: "POST",
        bodyJson: {},
      }),
    onSuccess: async (data) => {
      setStagedBatch(data.batch);
      pushToast("Batch Launched", `${data.batch.name} has been queued.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
    },
    onError: (error) => {
      pushToast(
        "Launch Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    },
  });

  const resendMutation = useMutation({
    mutationFn: (recipientId: number) =>
      apiFetch(`/api/v1/recipients/${recipientId}/resend`, {
        method: "POST",
        bodyJson: {},
      }),
    onSuccess: async () => {
      pushToast(
        "Recipient Requeued",
        "The recipient was queued from the original version snapshot.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
    },
    onError: (error) => {
      pushToast(
        "Resend Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    },
  });

  async function analyzeImport(file: File) {
    if (!selectedTemplateId) {
      pushToast(
        "Template Required",
        "Select a published template before uploading.",
        "error",
      );
      return;
    }
    try {
      const formData = buildUploadForm({
        template_id: selectedTemplateId,
        file,
      });
      const data = await apiFetch<{ import_session: ImportAnalysis }>(
        "/api/v1/imports/analyze",
        {
          method: "POST",
          body: formData,
        },
      );
      setImportSession(data.import_session);
      setStagedBatch(null);
      pushToast("Import Analyzed", `${file.name} was analyzed successfully.`);
    } catch (error) {
      pushToast(
        "Import Analyze Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    }
  }

  async function stageAndLaunch(sessionId: number) {
    try {
      const stageData = await apiFetch<{ batch: BatchSummary }>(
        `/api/v1/imports/${sessionId}/stage`,
        {
          method: "POST",
          bodyJson: {},
        },
      );
      setStagedBatch(stageData.batch);
      const launchData = await apiFetch<{ batch: BatchSummary }>(
        `/api/v1/batches/${stageData.batch.id}/launch`,
        {
          method: "POST",
          bodyJson: {},
        },
      );
      setStagedBatch(launchData.batch);
      pushToast("Batch Launched", `${launchData.batch.name} has been queued.`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard-batches"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-activity"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      ]);
    } catch (error) {
      pushToast(
        "Launch Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    }
  }

  async function updateImportMapping(
    nextMapping: Record<string, string>,
    selectedSheet?: string | null,
  ) {
    if (!importSession) return;
    try {
      const data = await apiFetch<{ import_session: ImportAnalysis }>(
        `/api/v1/imports/${importSession.id}/mapping`,
        {
          method: "POST",
          bodyJson: {
            mapping: nextMapping,
            selected_sheet:
              selectedSheet ?? importSession.selected_sheet ?? null,
          },
        },
      );
      setImportSession(data.import_session);
    } catch (error) {
      pushToast(
        "Mapping Failed",
        error instanceof Error ? error.message : "Request failed.",
        "error",
      );
    }
  }

  function onSettingsChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    if (!settingsDraft) return;
    const { name } = event.target;
    let nextValue: string | number | boolean | null =
      event.target instanceof HTMLInputElement &&
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;

    if (name === "hourly_limit" || name === "daily_limit") {
      nextValue = Number(event.target.value || 0);
    }
    if (name === "default_template_id") {
      nextValue = event.target.value ? Number(event.target.value) : null;
    }

    const nextDraft = {
      ...settingsDraft,
      [name]: nextValue,
    };

    if (name === "use_env_provider_api_key" && nextValue === true) {
      nextDraft.clear_manual_provider_api_key = false;
      nextDraft.provider_api_key = "";
    }
    if (name === "clear_manual_provider_api_key" && nextValue === true) {
      nextDraft.provider_api_key = "";
    }

    setSettingsDraft(nextDraft);
  }

  return (
    <section className="view-panel min-w-0 space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="bento-card p-4">
          <div className="metric-label">Contacts</div>
          <div className="mt-2 bg-gradient-to-br from-white to-gray-400 bg-clip-text text-2xl font-bold text-transparent">
            {statsQuery.data?.total_contacts ?? 0}
          </div>
        </div>
        <div className="bento-card p-4">
          <div className="metric-label">Templates</div>
          <div className="mt-2 bg-gradient-to-br from-white to-gray-400 bg-clip-text text-2xl font-bold text-transparent">
            {statsQuery.data?.templates ?? 0}
          </div>
        </div>
        <div className="bento-card p-4">
          <div className="metric-label">Batches</div>
          <div className="mt-2 bg-gradient-to-br from-white to-gray-400 bg-clip-text text-2xl font-bold text-transparent">
            {statsQuery.data?.batches ?? 0}
          </div>
        </div>
        <div className="bento-card border-yellow-500/10 bg-gradient-to-br from-yellow-500/5 to-transparent p-4">
          <div className="metric-label text-yellow-500/70">Queued</div>
          <div className="mt-2 text-2xl font-bold text-yellow-400">
            {statsQuery.data?.queued ?? 0}
          </div>
        </div>
        <div className="bento-card border-green-500/10 bg-gradient-to-br from-green-500/5 to-transparent p-4">
          <div className="metric-label text-green-500/70">Sent</div>
          <div className="mt-2 text-2xl font-bold text-green-400">
            {statsQuery.data?.sent ?? 0}
          </div>
        </div>
        <div className="bento-card border-red-500/10 bg-gradient-to-br from-red-500/5 to-transparent p-4">
          <div className="metric-label text-red-500/70">Failed</div>
          <div className="mt-2 text-2xl font-bold text-red-400">
            {statsQuery.data?.failed ?? 0}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
          <div className="bento-card group relative overflow-hidden p-6 md:p-8">
            <div className="pointer-events-none absolute right-0 top-0 -mr-20 -mt-20 h-64 w-64 rounded-full bg-purple-500/10 blur-3xl transition-colors group-hover:bg-purple-500/20" />

            <h2 className="relative z-10 mb-6 flex items-center gap-3 text-xl font-semibold">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400">
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              Launch Campaign
            </h2>

            <div className="relative z-10 grid gap-6 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-wider text-gray-500">
                    1. Select Template
                  </label>
                  <select
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500"
                    value={selectedTemplateId ?? ""}
                    onChange={(event) =>
                      setSelectedTemplateId(
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  >
                    <option value="">No published templates available</option>
                    {publishedTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} · v
                        {template.published_version?.version_number}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    {selectedTemplateId
                      ? (() => {
                          const template = publishedTemplates.find(
                            (item) => item.id === selectedTemplateId,
                          );
                          return template?.published_version
                            ? `Published version ${template.published_version.version_number} · Subject: ${template.published_version.subject}`
                            : "Select a published template to unlock import validation.";
                        })()
                      : "Pick a published template."}
                  </p>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-xs uppercase tracking-wider text-gray-500">
                      2. Upload Audience
                    </label>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs text-purple-400 transition-colors hover:text-purple-300"
                    >
                      Browse File
                    </button>
                  </div>
                  <button
                    type="button"
                    className="group/drop w-full rounded-xl border border-dashed border-white/20 bg-white/5 p-4 text-center transition-colors hover:border-purple-500/50"
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => {
                      event.preventDefault();
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const file = event.dataTransfer.files?.[0];
                      if (file) {
                        void analyzeImport(file);
                      }
                    }}
                  >
                    <div className="text-sm font-medium text-gray-300 transition-colors group-hover/drop:text-white">
                      Drop CSV/Excel here
                    </div>
                    <div className="mt-1 text-xs text-purple-300">
                      {importSession?.original_filename ||
                        "Upload will analyze the selected file."}
                    </div>
                  </button>
                  <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
                      Columns Needed By Template
                    </div>
                    {!selectedPublishedTemplate ? (
                      <p className="mt-2 text-xs text-gray-400">
                        Choose a published template to see the fields your
                        upload should include.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-3">
                        <p className="text-xs text-gray-400">
                          Your file can use different header names. You’ll match
                          them in step 3.
                        </p>
                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-yellow-500/80">
                            Required
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedTemplateFields.required.length ? (
                              selectedTemplateFields.required.map((field) => (
                                <span
                                  key={field.key}
                                  className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-200"
                                >
                                  {field.label || field.key}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-500">
                                No required fields.
                              </span>
                            )}
                          </div>
                        </div>
                        <div>
                          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">
                            Optional
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {selectedTemplateFields.optional.length ? (
                              selectedTemplateFields.optional.map((field) => (
                                <span
                                  key={field.key}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-gray-300"
                                >
                                  {field.label || field.key}
                                </span>
                              ))
                            ) : (
                              <span className="text-xs text-gray-500">
                                No optional fields.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".csv,.xlsx,.xls"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void analyzeImport(file);
                        event.target.value = "";
                      }
                    }}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="block text-xs uppercase tracking-wider text-gray-500">
                      3. Mapping Data
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        importSession &&
                        validateMutation.mutate(importSession.id)
                      }
                      disabled={!importSession || validateMutation.isPending}
                      className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {validateMutation.isPending ? "Validating" : "Validate"}
                    </button>
                  </div>
                  {importSession?.sheet_names?.length ? (
                    <select
                      className="mb-3 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500"
                      value={importSession.selected_sheet || ""}
                      onChange={(event) =>
                        void updateImportMapping(
                          importSession.mapping || {},
                          event.target.value || null,
                        )
                      }
                    >
                      {importSession.sheet_names.map((sheetName) => (
                        <option key={sheetName} value={sheetName}>
                          {sheetName}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <div className="max-h-32 space-y-2 overflow-y-auto pr-1">
                    {!importSession ? (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-500">
                        Upload a file to configure mappings.
                      </div>
                    ) : (
                      importSession.mappable_fields.map((field) => (
                        <div
                          key={field.key}
                          className="rounded-2xl border border-white/10 bg-white/5 p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {field.label || field.key}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                {field.required
                                  ? "Required for validation"
                                  : field.description || "Optional field"}
                              </div>
                            </div>
                            {field.required ? (
                              <span className="rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-yellow-500">
                                Required
                              </span>
                            ) : null}
                          </div>
                          <select
                            className="mt-3 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                            value={importSession.mapping?.[field.key] || ""}
                            onChange={(event) =>
                              void updateImportMapping(
                                {
                                  ...(importSession.mapping || {}),
                                  [field.key]: event.target.value,
                                },
                                importSession.selected_sheet || null,
                              )
                            }
                          >
                            <option value="">
                              {field.required
                                ? "Choose a column"
                                : "Leave unmapped"}
                            </option>
                            {importSession.detected_columns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div
                  className={
                    importSession ? "border-t border-white/10 pt-2" : "hidden"
                  }
                >
                  <div
                    className={
                      importSession?.row_errors_preview?.length ||
                      importSession?.warnings?.length
                        ? "mb-3 rounded-lg bg-red-900/20 p-2 text-xs text-red-400"
                        : "mb-3 hidden"
                    }
                  >
                    {importSession?.warnings?.map((warning) => (
                      <div key={warning}>{warning}</div>
                    ))}
                    {importSession?.row_errors_preview
                      ?.slice(0, 3)
                      .map((row) => (
                        <div key={`${row.row_number}-${row.error}`}>
                          Row {row.row_number}: {row.error}
                        </div>
                      ))}
                    {importSession?.error_report_available ? (
                      <a
                        href={`${API_BASE_URL}/api/v1/imports/${importSession.id}/error-report`}
                        target="_blank"
                        className="mt-2 inline-flex text-white underline"
                      >
                        Download Error Report
                      </a>
                    ) : null}
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-gray-400">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                        Valid rows
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {importSession?.summary_counts?.valid_rows || 0}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                        Invalid rows
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {importSession?.summary_counts?.invalid_rows || 0}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                        Creates
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {importSession?.summary_counts?.created || 0}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                        Updates
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-white">
                        {importSession?.summary_counts?.updated || 0}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        importSession && stageMutation.mutate(importSession.id)
                      }
                      disabled={!importSession || stageMutation.isPending}
                      className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {stageMutation.isPending ? "Staging..." : "Stage Only"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!importSession) return;
                        if (stagedBatch) {
                          launchMutation.mutate(stagedBatch.id);
                          return;
                        }
                        void stageAndLaunch(importSession.id);
                      }}
                      disabled={!importSession || launchMutation.isPending}
                      className="flex-1 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {launchMutation.isPending ? "Launching..." : "Launch Now"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="relative z-10 mt-4 grid gap-3 lg:grid-cols-2">
              {(importSession?.sample_previews || []).map((preview, index) => (
                <div
                  key={`${preview.email || index}`}
                  className="rounded-3xl border border-white/10 bg-white/10 p-4"
                >
                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-500">
                    {preview.email || "Sample preview"}
                  </div>
                  <iframe
                    sandbox=""
                    className="h-[360px] w-full rounded-[20px] border border-white/10 bg-white"
                    srcDoc={preview.html || ""}
                    title={`Sample preview ${index + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bento-card w-full overflow-hidden p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Recent Batches
              </h3>
              <button
                type="button"
                onClick={() => void batchesQuery.refetch()}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10"
              >
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full whitespace-nowrap text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <th className="px-4 py-3">Batch</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Template</th>
                    <th className="px-4 py-3">Counts</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  {(batchesQuery.data?.batches || []).map((batch) => (
                    <tr key={batch.id}>
                      <td className="px-4 py-4">
                        <div
                          className="max-w-[16rem] truncate font-medium text-white"
                          title={batch.name}
                        >
                          {batch.name}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          <span
                            className="inline-block max-w-[20rem] truncate align-bottom"
                            title={batch.source_filename || "Manual stage"}
                          >
                            {batch.source_filename || "Manual stage"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge value={batch.status} />
                      </td>
                      <td className="px-4 py-4 text-gray-300">
                        {batch.template_name || "Template"}
                      </td>
                      <td className="px-4 py-4 text-gray-400">
                        <div>Queued {batch.queued || 0}</div>
                        <div>
                          Sent {batch.sent || 0} · Failed {batch.failed || 0}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        {batch.status === "staged" ? (
                          <button
                            type="button"
                            onClick={() => launchMutation.mutate(batch.id)}
                            className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-black transition hover:bg-gray-200"
                          >
                            Launch
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!batchesQuery.data?.batches?.length ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-6 text-center text-gray-500"
                      >
                        No campaign batches yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="min-w-0 flex flex-col space-y-6">
          <div className="bento-card flex min-h-[400px] flex-1 flex-col p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-semibold text-white">
                Live Activity
              </h3>
              <select
                className="w-32 rounded-lg border border-transparent bg-white/5 px-2 py-1 text-xs text-white outline-none focus:border-white/20"
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
            <div className="flex-1 overflow-auto pr-2">
              <table className="w-full text-left text-xs">
                <tbody className="divide-y divide-white/5 text-gray-400">
                  {(activityQuery.data?.rows || []).map((row) => (
                    <tr key={row.id}>
                      <td className="px-2 py-4">
                        <div
                          className="max-w-[14rem] truncate font-medium text-white"
                          title={row.email}
                        >
                          {row.email}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {row.name || "There"}
                        </div>
                      </td>
                      <td className="px-2 py-4">
                        <StatusBadge value={row.status} />
                      </td>
                      <td className="px-2 py-4 text-gray-300">
                        <span
                          className="inline-block max-w-[10rem] truncate align-bottom"
                          title={row.batch_name || "—"}
                        >
                          {row.batch_name || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-4 text-gray-400">
                        <span
                          className="inline-block max-w-[12rem] truncate align-bottom"
                          title={row.template_subject || "—"}
                        >
                          {row.template_subject || "—"}
                        </span>
                      </td>
                      <td className="px-2 py-4 text-gray-500">
                        {formatDate(row.updated_at)}
                      </td>
                      <td className="px-2 py-4 text-right">
                        {["sent", "failed"].includes(row.status) ? (
                          <button
                            type="button"
                            onClick={() => resendMutation.mutate(row.id)}
                            className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-white/10"
                          >
                            Resend
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {!activityQuery.data?.rows?.length ? (
                    <tr>
                      <td colSpan={6} className="py-4 text-center">
                        No activity yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bento-card group relative overflow-hidden p-6">
            <div className="pointer-events-none absolute bottom-0 right-0 -mb-10 -mr-10 h-48 w-48 rounded-full bg-blue-500/10 blur-3xl transition-colors group-hover:bg-blue-500/20" />
            <h3 className="relative z-10 mb-4 text-lg font-semibold text-white">
              Settings
            </h3>
            {settingsDraft ? (
              <form
                className="relative z-10 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  settingsMutation.mutate(settingsDraft);
                }}
              >
                {settingsDraft.env_has_provider_api_key ||
                settingsDraft.env_has_sender_identity ? (
                  <div className="rounded-xl border border-sky-400/15 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
                    Server `.env` defaults are available. You can use them
                    directly without pasting secrets into the dashboard.
                  </div>
                ) : null}
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    {providerLabel} API Key
                  </label>
                  {settingsDraft.env_has_provider_api_key ? (
                    <label className="mb-2 flex items-center gap-2 text-xs text-gray-300">
                      <input
                        name="use_env_provider_api_key"
                        type="checkbox"
                        checked={settingsDraft.use_env_provider_api_key}
                        onChange={onSettingsChange}
                      />
                      {`Use ${providerEnvKey} from .env`}
                    </label>
                  ) : null}
                  <input
                    type="password"
                    name="provider_api_key"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                    placeholder={
                      settingsDraft.use_env_provider_api_key
                        ? `Using ${providerEnvKey} from .env`
                        : settingsDraft.has_manual_provider_api_key
                          ? `Leave blank to keep the saved ${providerLabel} key`
                          : `${providerLabel} API Key`
                    }
                    value={settingsDraft.provider_api_key || ""}
                    onChange={onSettingsChange}
                    disabled={settingsDraft.use_env_provider_api_key}
                  />
                  {!settingsDraft.use_env_provider_api_key &&
                  settingsDraft.has_manual_provider_api_key ? (
                    <label className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                      <input
                        name="clear_manual_provider_api_key"
                        type="checkbox"
                        checked={Boolean(
                          settingsDraft.clear_manual_provider_api_key,
                        )}
                        onChange={onSettingsChange}
                      />
                      Remove the saved manual {providerLabel} key on next save
                    </label>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs text-gray-500">
                      Sender Source
                    </label>
                    {settingsDraft.env_has_sender_identity ? (
                      <label className="flex items-center gap-2 text-xs text-gray-300">
                        <input
                          name="use_env_sender_identity"
                          type="checkbox"
                          checked={settingsDraft.use_env_sender_identity}
                          onChange={onSettingsChange}
                        />
                        Use `.env` sender identity
                        {settingsDraft.effective_sender_email
                          ? ` (${settingsDraft.effective_sender_email})`
                          : ""}
                      </label>
                    ) : (
                      <div className="text-xs text-gray-500">
                        Using manual sender identity.
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Sender Email
                    </label>
                    <input
                      type="email"
                      name="sender_email"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      value={
                        settingsDraft.use_env_sender_identity
                          ? settingsDraft.effective_sender_email || ""
                          : settingsDraft.sender_email || ""
                      }
                      onChange={onSettingsChange}
                      disabled={settingsDraft.use_env_sender_identity}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Sender Name
                    </label>
                    <input
                      type="text"
                      name="sender_name"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      value={
                        settingsDraft.use_env_sender_identity
                          ? settingsDraft.effective_sender_name || ""
                          : settingsDraft.sender_name || ""
                      }
                      onChange={onSettingsChange}
                      disabled={settingsDraft.use_env_sender_identity}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Hourly Limit
                    </label>
                    <input
                      type="number"
                      name="hourly_limit"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      value={settingsDraft.hourly_limit}
                      onChange={onSettingsChange}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-500">
                      Daily Limit
                    </label>
                    <input
                      type="number"
                      name="daily_limit"
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      value={settingsDraft.daily_limit}
                      onChange={onSettingsChange}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-500">
                    Default Template
                  </label>
                  <select
                    name="default_template_id"
                    className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                    value={settingsDraft.default_template_id || ""}
                    onChange={onSettingsChange}
                  >
                    <option value="">No templates available</option>
                    {(templatesQuery.data?.templates || []).map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
                  <div className="text-xs text-gray-400">
                    <span className="font-medium text-white">
                      {statsQuery.data?.emails_sent_this_hour || 0}
                    </span>
                    /<span>{statsQuery.data?.hourly_limit || 0}</span> hr &bull;{" "}
                    <span className="font-medium text-white">
                      {statsQuery.data?.emails_sent_today || 0}
                    </span>
                    /<span>{statsQuery.data?.daily_limit || 0}</span> day
                  </div>
                  <button
                    type="submit"
                    disabled={settingsMutation.isPending}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {settingsMutation.isPending ? "Saving..." : "Save"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-sm text-gray-500">Loading settings...</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
