"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useToast } from "@/components/providers/toast-provider";
import { StatusBadge } from "@/components/ui/status-badge";
import { API_BASE_URL, apiFetch, buildUploadForm } from "@/lib/api";
import { BLOCK_FIELD_CONFIG, createBuilderBlock } from "@/lib/template-builder";
import type { TemplateField, TemplateSummary, TemplateVersion } from "@/lib/types";

type AssetResponse = {
  enabled: boolean;
  assets: Array<{ filename: string; url: string; size: number }>;
  base_url?: string;
};

type DraftState = {
  name: string;
  editor_mode: string;
  subject: string;
  preheader: string;
  design_json: Record<string, unknown>;
  html_source: string;
  merge_fields_schema: TemplateField[];
};

function cloneDraft(template: TemplateSummary): DraftState {
  const draft = template.draft_version || template.published_version;
  return {
    name: template.name,
    editor_mode: draft?.editor_mode || template.editor_mode,
    subject: draft?.subject || "Campaign Update",
    preheader: draft?.preheader || "",
    design_json: JSON.parse(JSON.stringify(draft?.design_json || { blocks: [] })),
    html_source: draft?.html_source || "",
    merge_fields_schema: JSON.parse(JSON.stringify(draft?.merge_fields_schema || []))
  };
}

function ensureBlocks(draft: DraftState) {
  const design = (draft.design_json ||= {});
  if (!Array.isArray((design as { blocks?: unknown[] }).blocks)) {
    (design as { blocks: unknown[] }).blocks = [];
  }
  return (design as { blocks: Record<string, unknown>[] }).blocks;
}

export function TemplatesWorkspace() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"design" | "code" | "preview" | "settings">("design");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState("");
  const [previewData, setPreviewData] = useState<Record<string, string>>({});
  const [previewWidth, setPreviewWidth] = useState("100%");
  const [htmlImportFile, setHtmlImportFile] = useState<File | null>(null);
  const [assetFile, setAssetFile] = useState<File | null>(null);
  const [testEmail, setTestEmail] = useState("");

  const templatesQuery = useQuery({
    queryKey: ["templates-workspace-list"],
    queryFn: () => apiFetch<{ templates: TemplateSummary[] }>("/api/v1/templates")
  });

  const selectedTemplate = useMemo(
    () => (templatesQuery.data?.templates || []).find((item) => item.id === selectedTemplateId) || null,
    [selectedTemplateId, templatesQuery.data]
  );

  const detailQuery = useQuery({
    queryKey: ["template-detail", selectedTemplateId],
    queryFn: () => apiFetch<{ template: TemplateSummary }>(`/api/v1/templates/${selectedTemplateId}`),
    enabled: Boolean(selectedTemplateId)
  });

  const assetsQuery = useQuery({
    queryKey: ["template-assets"],
    queryFn: () => apiFetch<AssetResponse>("/api/v1/template-assets")
  });

  useEffect(() => {
    if (!selectedTemplateId && templatesQuery.data?.templates?.length) {
      setSelectedTemplateId(templatesQuery.data.templates[0].id);
    }
  }, [selectedTemplateId, templatesQuery.data]);

  useEffect(() => {
    if (detailQuery.data?.template) {
      const nextDraft = cloneDraft(detailQuery.data.template);
      setDraftState(nextDraft);
      const blocks = ensureBlocks(nextDraft);
      setSelectedBlockId((blocks[0]?.id as string) || null);
      setPreviewData(
        Object.fromEntries(
          (nextDraft.merge_fields_schema || [])
            .filter((field) => field.key !== "unsubscribe_url")
            .map((field) => [field.key, field.sample_value || field.default_value || ""])
        )
      );
      setActiveTab(nextDraft.editor_mode === "code" ? "code" : "design");
    }
  }, [detailQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ template: TemplateSummary }>(`/api/v1/templates/${selectedTemplateId}/draft`, {
        method: "PUT",
        bodyJson: draftState
      }),
    onSuccess: async () => {
      pushToast("Saved", "Draft updated successfully.");
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      await queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] });
    },
    onError: (error) => {
      pushToast("Save Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/v1/templates/${selectedTemplateId}/publish`, {
        method: "POST",
        bodyJson: {}
      }),
    onSuccess: async () => {
      pushToast("Published", "Template published successfully.");
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      await queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] });
    },
    onError: (error) => {
      pushToast("Publish Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  async function refreshPreview() {
    if (!selectedTemplateId) return;
    try {
      const data = await apiFetch<{ html: string; subject: string }>(
        `/api/v1/templates/${selectedTemplateId}/preview`,
        {
          method: "POST",
          bodyJson: { sample_data: previewData }
        }
      );
      setPreviewHtml(data.html);
      setPreviewSubject(data.subject);
      setActiveTab("preview");
    } catch (error) {
      pushToast("Preview Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function createTemplate(editorMode: "builder" | "code") {
    const name = window.prompt("Template name");
    if (!name?.trim()) return;
    try {
      const data = await apiFetch<{ template: TemplateSummary }>("/api/v1/templates", {
        method: "POST",
        bodyJson: { name, editor_mode: editorMode }
      });
      pushToast("Template Created", `${name} is ready.`);
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      setSelectedTemplateId(data.template.id);
    } catch (error) {
      pushToast("Create Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function importHtmlTemplate() {
    if (!htmlImportFile) return;
    const formData = buildUploadForm({
      name: htmlImportFile.name.replace(/\.html$/i, ""),
      make_default: false,
      file: htmlImportFile
    });
    try {
      const data = await apiFetch<{ template: TemplateSummary }>("/api/v1/templates/import-html", {
        method: "POST",
        body: formData
      });
      pushToast("Imported", "HTML template imported as code mode.");
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      setSelectedTemplateId(data.template.id);
      setHtmlImportFile(null);
    } catch (error) {
      pushToast("Import Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function executeTemplateAction(path: string, method = "POST", bodyJson: Record<string, unknown> = {}) {
    if (!selectedTemplateId) return;
    try {
      await apiFetch(`/api/v1/templates/${selectedTemplateId}${path}`, {
        method,
        bodyJson
      });
      if (method === "DELETE") {
        setSelectedTemplateId(null);
        setDraftState(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      await queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] });
    } catch (error) {
      pushToast("Action Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function uploadAsset() {
    if (!assetFile) return;
    const formData = buildUploadForm({ file: assetFile });
    try {
      await apiFetch("/api/v1/template-assets/upload", {
        method: "POST",
        body: formData
      });
      pushToast("Uploaded", "Asset uploaded successfully.");
      setAssetFile(null);
      await queryClient.invalidateQueries({ queryKey: ["template-assets"] });
    } catch (error) {
      pushToast("Upload Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function sendTestEmail() {
    if (!selectedTemplateId || !testEmail) return;
    try {
      await apiFetch(`/api/v1/templates/${selectedTemplateId}/test-send`, {
        method: "POST",
        bodyJson: {
          test_email: testEmail,
          sample_data: previewData
        }
      });
      pushToast("Test Sent", `Queued a test email to ${testEmail}.`);
    } catch (error) {
      pushToast("Test Send Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  const selectedDraftVersion: TemplateVersion | null =
    (detailQuery.data?.template.draft_version as TemplateVersion | null) ||
    (detailQuery.data?.template.published_version as TemplateVersion | null) ||
    null;
  const blocks = draftState ? ensureBlocks(draftState) : [];
  const selectedBlock = blocks.find((block) => block.id === selectedBlockId) || null;

  function updateBlockField(key: string, value: string) {
    if (!draftState || !selectedBlockId) return;
    const nextBlocks = blocks.map((block) =>
      block.id === selectedBlockId ? { ...block, [key]: value } : block
    );
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
  }

  function addBlock(type: string) {
    if (!draftState) return;
    const nextBlock = createBuilderBlock(type);
    const nextBlocks = [...blocks, nextBlock];
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
    setSelectedBlockId(nextBlock.id as string);
  }

  function moveBlock(direction: -1 | 1) {
    if (!selectedBlockId || !draftState) return;
    const currentIndex = blocks.findIndex((block) => block.id === selectedBlockId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= blocks.length) return;
    const nextBlocks = [...blocks];
    [nextBlocks[currentIndex], nextBlocks[nextIndex]] = [nextBlocks[nextIndex], nextBlocks[currentIndex]];
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
  }

  function removeBlock() {
    if (!selectedBlockId || !draftState) return;
    const nextBlocks = blocks.filter((block) => block.id !== selectedBlockId);
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
    setSelectedBlockId((nextBlocks[0]?.id as string) || null);
  }

  function updateSchemaField(index: number, key: keyof TemplateField, value: string | boolean) {
    if (!draftState) return;
    const nextFields = [...draftState.merge_fields_schema];
    nextFields[index] = { ...nextFields[index], [key]: value } as TemplateField;
    setDraftState({ ...draftState, merge_fields_schema: nextFields });
  }

  function addCustomField() {
    if (!draftState) return;
    setDraftState({
      ...draftState,
      merge_fields_schema: [
        ...draftState.merge_fields_schema,
        {
          key: "custom_field",
          label: "Custom Field",
          required: false,
          default_value: "",
          sample_value: "",
          description: "",
          builtin: false
        }
      ]
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <aside className="space-y-6">
        <section className="bento-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Templates</h2>
            <button className="text-xs text-slate-400" onClick={() => void queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] })}>
              Refresh
            </button>
          </div>
          <div className="mb-6 space-y-2">
            <button className="premium-button w-full" onClick={() => void createTemplate("builder")}>
              New Builder Template
            </button>
            <button className="ghost-button w-full" onClick={() => void createTemplate("code")}>
              New Code Template
            </button>
          </div>
          <div className="space-y-2">
            {(templatesQuery.data?.templates || []).map((template) => (
              <button
                key={template.id}
                onClick={() => setSelectedTemplateId(template.id)}
                className={`w-full rounded-3xl border p-4 text-left transition ${
                  selectedTemplateId === template.id
                    ? "border-purple-500/40 bg-purple-500/10"
                    : "border-white/10 bg-white/5 hover:border-purple-500/30 hover:bg-purple-500/5"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">{template.name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                      {template.editor_mode}
                    </div>
                  </div>
                  {template.is_default ? (
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-black">
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {template.draft_version ? <StatusBadge value="draft" /> : null}
                  {template.published_version ? <StatusBadge value="published" /> : null}
                  {template.is_archived ? <StatusBadge value="archived" /> : null}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-6 border-t border-white/10 pt-4">
            <label className="mb-2 block text-xs text-slate-400">Import HTML</label>
            <input type="file" accept=".html" className="premium-input py-3 text-xs" onChange={(event) => setHtmlImportFile(event.target.files?.[0] || null)} />
            <button className="ghost-button mt-3 w-full" onClick={() => void importHtmlTemplate()}>
              Import as Code
            </button>
          </div>
        </section>

        <section className="bento-card p-5">
          <div className="mb-3 text-sm font-semibold text-white">Assets</div>
          <input type="file" accept=".png,.jpg,.jpeg,.gif,.webp" className="premium-input py-3 text-xs" onChange={(event) => setAssetFile(event.target.files?.[0] || null)} />
          <button className="ghost-button mt-3 w-full" onClick={() => void uploadAsset()} disabled={!assetsQuery.data?.enabled}>
            Upload Asset
          </button>
          {!assetsQuery.data?.enabled ? (
            <p className="mt-3 text-xs text-slate-500">Set `PUBLIC_BASE_URL` to enable local uploads.</p>
          ) : null}
          <div className="mt-4 space-y-2">
            {(assetsQuery.data?.assets || []).map((asset) => (
              <a key={asset.filename} href={asset.url} target="_blank" className="block rounded-2xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300 hover:bg-white/10">
                <div className="font-medium text-white">{asset.filename}</div>
                <div className="mt-1 text-xs text-slate-500">{asset.url.replace(API_BASE_URL, "")}</div>
              </a>
            ))}
          </div>
        </section>
      </aside>

      <section className="bento-card overflow-hidden p-6">
        {!draftState || !selectedTemplate ? (
          <div className="flex min-h-[420px] items-center justify-center text-slate-500">
            Select a template to open its workspace.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-white">{selectedTemplate.name}</h1>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-400">
                  <span>{draftState.editor_mode} mode</span>
                  {selectedTemplate.draft_version ? <span>Draft v{selectedTemplate.draft_version.version_number}</span> : null}
                  {selectedTemplate.published_version ? <span>Published v{selectedTemplate.published_version.version_number}</span> : <span>Not yet published</span>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="ghost-button px-4 py-2 text-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save Draft"}
                </button>
                <button className="premium-button px-4 py-2 text-sm" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
                  {publishMutation.isPending ? "Publishing..." : "Publish"}
                </button>
                <button className="ghost-button px-4 py-2 text-sm" onClick={() => void executeTemplateAction("/duplicate")}>
                  Duplicate
                </button>
                <button className="ghost-button px-4 py-2 text-sm" onClick={() => void executeTemplateAction("/default")}>
                  Set Default
                </button>
                <button className="ghost-button px-4 py-2 text-sm" onClick={() => void executeTemplateAction("/archive", "POST", { is_archived: !selectedTemplate.is_archived })}>
                  {selectedTemplate.is_archived ? "Restore" : "Archive"}
                </button>
                <button className="ghost-button px-4 py-2 text-sm" onClick={() => void executeTemplateAction("", "DELETE")}>
                  Delete
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {(["design", "code", "preview", "settings"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    activeTab === tab
                      ? "border-purple-400/35 bg-purple-500/15 font-semibold text-purple-100"
                      : "border-white/10 bg-white/[0.03] text-slate-300"
                  }`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-[280px_1fr_320px]">
              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <div className="text-sm font-semibold text-white">Canvas</div>
                    <button className="text-xs text-slate-400" onClick={() => addCustomField()}>
                      Add Field
                    </button>
                  </div>
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    {["section", "columns", "text", "image", "button", "spacer", "divider", "social_footer", "raw_html"].map((type) => (
                      <button key={type} className="ghost-button px-3 py-2 text-xs capitalize" onClick={() => addBlock(type)}>
                        {type.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {blocks.map((block, index) => (
                      <button
                        key={String(block.id)}
                        onClick={() => setSelectedBlockId(String(block.id))}
                        className={`w-full rounded-2xl border p-3 text-left ${
                          selectedBlockId === block.id ? "border-purple-500/35 bg-purple-500/10" : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="text-xs uppercase tracking-[0.18em] text-slate-500">
                          Block {index + 1}
                        </div>
                        <div className="mt-1 text-sm font-medium text-white">
                          {String(block.type).replace("_", " ")}
                        </div>
                      </button>
                    ))}
                    {!blocks.length ? (
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500">
                        Add a block to start building.
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {activeTab === "design" ? (
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">Block Inspector</div>
                      {selectedBlock ? (
                        <div className="flex gap-2">
                          <button className="ghost-button px-3 py-2 text-xs" onClick={() => moveBlock(-1)}>
                            Up
                          </button>
                          <button className="ghost-button px-3 py-2 text-xs" onClick={() => moveBlock(1)}>
                            Down
                          </button>
                          <button className="ghost-button px-3 py-2 text-xs" onClick={() => removeBlock()}>
                            Remove
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {selectedBlock ? (
                      <div className="space-y-3">
                        {(BLOCK_FIELD_CONFIG[String(selectedBlock.type)] || []).map((field) => (
                          <label key={field.key} className="block">
                            <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">
                              {field.label}
                            </span>
                            {field.type === "textarea" ? (
                              <textarea
                                className="premium-input min-h-28"
                                value={String(selectedBlock[field.key] || "")}
                                onChange={(event) => updateBlockField(field.key, event.target.value)}
                              />
                            ) : field.type === "select" ? (
                              <select
                                className="premium-input py-3"
                                value={String(selectedBlock[field.key] || "")}
                                onChange={(event) => updateBlockField(field.key, event.target.value)}
                              >
                                {field.options?.map((option) => (
                                  <option key={option} value={option}>
                                    {option}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={field.type}
                                className="premium-input"
                                value={String(selectedBlock[field.key] || "")}
                                onChange={(event) => updateBlockField(field.key, event.target.value)}
                              />
                            )}
                          </label>
                        ))}
                        <label className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Visibility Field</span>
                          <input
                            className="premium-input"
                            value={String(selectedBlock.visibility_field || "")}
                            onChange={(event) => updateBlockField("visibility_field", event.target.value)}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Visibility Mode</span>
                          <select
                            className="premium-input py-3"
                            value={String(selectedBlock.visibility_mode || "present")}
                            onChange={(event) => updateBlockField("visibility_mode", event.target.value)}
                          >
                            <option value="present">Present</option>
                            <option value="missing">Missing</option>
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">Select a block to edit.</div>
                    )}
                  </div>
                ) : null}

                {activeTab === "code" ? (
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <label className="mb-2 block text-sm font-semibold text-white">HTML Source</label>
                    <textarea
                      className="premium-input min-h-[460px] font-mono text-sm"
                      value={draftState.html_source}
                      onChange={(event) => setDraftState({ ...draftState, html_source: event.target.value, editor_mode: "code" })}
                    />
                  </div>
                ) : null}

                {activeTab === "preview" ? (
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">Live Preview</div>
                        <div className="mt-1 text-xs text-slate-500">{previewSubject || selectedDraftVersion?.subject}</div>
                      </div>
                      <div className="flex gap-2">
                        {[
                          { label: "Desktop", width: "100%" },
                          { label: "Email", width: "720px" },
                          { label: "Mobile", width: "420px" }
                        ].map((option) => (
                          <button
                            key={option.label}
                            className={`ghost-button px-3 py-2 text-xs ${previewWidth === option.width ? "border-purple-500/30 bg-purple-500/10" : ""}`}
                            onClick={() => setPreviewWidth(option.width)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-auto rounded-3xl border border-white/10 bg-slate-950/80 p-4">
                      <iframe
                        title="Template Preview"
                        sandbox=""
                        srcDoc={previewHtml || selectedDraftVersion?.compiled_html || ""}
                        className="mx-auto min-h-[620px] rounded-2xl bg-white"
                        style={{ width: previewWidth }}
                      />
                    </div>
                  </div>
                ) : null}

                {activeTab === "settings" ? (
                  <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Template Name</span>
                        <input className="premium-input" value={draftState.name} onChange={(event) => setDraftState({ ...draftState, name: event.target.value })} />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Editor Mode</span>
                        <select className="premium-input py-3" value={draftState.editor_mode} onChange={(event) => setDraftState({ ...draftState, editor_mode: event.target.value })}>
                          <option value="builder">Builder</option>
                          <option value="code">Code</option>
                        </select>
                      </label>
                      <label className="block md:col-span-2">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Subject</span>
                        <input className="premium-input" value={draftState.subject} onChange={(event) => setDraftState({ ...draftState, subject: event.target.value })} />
                      </label>
                      <label className="block md:col-span-2">
                        <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">Preheader</span>
                        <input className="premium-input" value={draftState.preheader} onChange={(event) => setDraftState({ ...draftState, preheader: event.target.value })} />
                      </label>
                    </div>
                    <div className="mt-6">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-semibold text-white">Merge Field Schema</div>
                        <button className="ghost-button px-3 py-2 text-xs" onClick={() => addCustomField()}>
                          Add Custom Field
                        </button>
                      </div>
                      <div className="space-y-3">
                        {draftState.merge_fields_schema.map((field, index) => (
                          <div key={`${field.key}-${index}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="grid gap-3 md:grid-cols-2">
                              <input className="premium-input" value={field.key} disabled={Boolean(field.builtin)} onChange={(event) => updateSchemaField(index, "key", event.target.value)} />
                              <input className="premium-input" value={field.label} onChange={(event) => updateSchemaField(index, "label", event.target.value)} />
                              <input className="premium-input" value={field.default_value} onChange={(event) => updateSchemaField(index, "default_value", event.target.value)} placeholder="Default value" />
                              <input className="premium-input" value={field.sample_value} onChange={(event) => updateSchemaField(index, "sample_value", event.target.value)} placeholder="Sample value" />
                              <textarea className="premium-input md:col-span-2" value={field.description || ""} onChange={(event) => updateSchemaField(index, "description", event.target.value)} placeholder="Description" />
                              <label className="flex items-center gap-2 text-sm text-slate-300">
                                <input type="checkbox" checked={field.required} onChange={(event) => updateSchemaField(index, "required", event.target.checked)} />
                                Required
                              </label>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Sample Data</div>
                  <div className="space-y-3">
                    {draftState.merge_fields_schema
                      .filter((field) => field.key !== "unsubscribe_url")
                      .map((field) => (
                        <label key={field.key} className="block">
                          <span className="mb-1 block text-xs uppercase tracking-[0.16em] text-slate-500">{field.label}</span>
                          <input
                            className="premium-input"
                            value={previewData[field.key] || ""}
                            onChange={(event) => setPreviewData({ ...previewData, [field.key]: event.target.value })}
                          />
                        </label>
                      ))}
                    <button className="premium-button w-full text-sm" onClick={() => void refreshPreview()}>
                      Refresh Preview
                    </button>
                  </div>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Test Send</div>
                  <input className="premium-input" type="email" placeholder="recipient@example.com" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} />
                  <button className="ghost-button mt-3 w-full text-sm" onClick={() => void sendTestEmail()}>
                    Send Test Email
                  </button>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Published Snapshot</div>
                  {selectedTemplate.published_version ? (
                    <div className="space-y-2 text-sm text-slate-300">
                      <StatusBadge value="published" />
                      <div>Subject: {selectedTemplate.published_version.subject}</div>
                      <div>Version: {selectedTemplate.published_version.version_number}</div>
                      <div className="text-xs text-slate-500">
                        Published at {selectedTemplate.published_version.published_at || "not available"}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No published version yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
