"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useDialog } from "@/components/providers/dialog-provider";
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

const BLOCK_TYPES = ["section", "columns", "text", "image", "button", "spacer", "divider", "social_footer", "raw_html"];

function cloneDraft(template: TemplateSummary): DraftState {
  const draft = template.draft_version || template.published_version;
  return {
    name: template.name,
    editor_mode: draft?.editor_mode || template.editor_mode,
    subject: draft?.subject || "",
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

function createCustomField(existingFields: TemplateField[]) {
  const count = existingFields.filter((field) => !field.builtin).length + 1;
  return {
    key: `custom_field_${count}`,
    label: "Custom Field",
    required: true,
    default_value: "",
    sample_value: "",
    description: "",
    builtin: false
  };
}

export function TemplatesWorkspace() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { confirm, prompt } = useDialog();
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
    if (!detailQuery.data?.template) return;
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
    setPreviewHtml(detailQuery.data.template.draft_version?.compiled_html || detailQuery.data.template.published_version?.compiled_html || "");
    setPreviewSubject(detailQuery.data.template.draft_version?.subject || detailQuery.data.template.published_version?.subject || "");
  }, [detailQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: DraftState) =>
      apiFetch<{ template: TemplateSummary }>(`/api/v1/templates/${selectedTemplateId}/draft`, {
        method: "PUT",
        bodyJson: payload
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] }),
        queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] })
      ]);
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
      pushToast("Template Published", "The template is now live.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] }),
        queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] })
      ]);
    },
    onError: (error) => {
      pushToast("Publish Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  });

  const selectedTemplate = detailQuery.data?.template || null;
  const publishedVersion = selectedTemplate?.published_version || null;
  const selectedDraftVersion: TemplateVersion | null =
    (selectedTemplate?.draft_version as TemplateVersion | null) ||
    (publishedVersion as TemplateVersion | null) ||
    null;
  const blocks = draftState ? ensureBlocks(draftState) : [];
  const selectedBlock = blocks.find((block) => String(block.id) === selectedBlockId) || null;

  async function saveDraft(options?: { silent?: boolean }) {
    if (!draftState) return;
    try {
      await saveMutation.mutateAsync(draftState);
      if (!options?.silent) {
        pushToast("Draft Saved", "Draft changes were saved.");
      }
    } catch {
      // handled in mutation
    }
  }

  async function refreshPreview() {
    if (!selectedTemplateId) return;
    try {
      if (draftState) {
        await saveMutation.mutateAsync(draftState);
      }
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
    const defaultName = editorMode === "builder" ? "New Builder Template" : "New Code Template";
    const name = await prompt({
      title: "New Template",
      message: "Template name",
      defaultValue: defaultName
    });
    if (!name?.trim()) return;
    try {
      const data = await apiFetch<{ template: TemplateSummary }>("/api/v1/templates", {
        method: "POST",
        bodyJson: { name: name.trim(), editor_mode: editorMode }
      });
      pushToast("Template Created", `${name.trim()} is ready to edit.`);
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      setSelectedTemplateId(data.template.id);
    } catch (error) {
      pushToast("Create Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function importHtmlTemplate() {
    if (!htmlImportFile) {
      pushToast("No File Selected", "Choose an HTML file to import.", "error");
      return;
    }
    try {
      const formData = buildUploadForm({
        name: htmlImportFile.name.replace(/\.html$/i, ""),
        make_default: false,
        file: htmlImportFile
      });
      const data = await apiFetch<{ template: TemplateSummary }>("/api/v1/templates/import-html", {
        method: "POST",
        body: formData
      });
      pushToast("Template Imported", `${data.template.name} was imported in code mode.`);
      setHtmlImportFile(null);
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      setSelectedTemplateId(data.template.id);
    } catch (error) {
      pushToast("Import Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function renameTemplate() {
    if (!draftState) return;
    const name = await prompt({
      title: "Rename template",
      message: "Enter new name:",
      defaultValue: draftState.name
    });
    if (!name?.trim()) return;
    const nextDraft = { ...draftState, name: name.trim() };
    setDraftState(nextDraft);
    try {
      await saveMutation.mutateAsync(nextDraft);
      pushToast("Template Renamed", `${name.trim()} was saved.`);
    } catch {
      // handled in mutation
    }
  }

  async function duplicateTemplate() {
    if (!selectedTemplateId) return;
    try {
      const data = await apiFetch<{ template: TemplateSummary }>(`/api/v1/templates/${selectedTemplateId}/duplicate`, {
        method: "POST",
        bodyJson: {}
      });
      pushToast("Template Duplicated", `${data.template.name} was created.`);
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
      setSelectedTemplateId(data.template.id);
    } catch (error) {
      pushToast("Duplicate Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function archiveTemplate() {
    if (!selectedTemplateId || !selectedTemplate) return;
    try {
      await apiFetch(`/api/v1/templates/${selectedTemplateId}/archive`, {
        method: "POST",
        bodyJson: { is_archived: !selectedTemplate.is_archived }
      });
      pushToast(
        selectedTemplate.is_archived ? "Template Restored" : "Template Archived",
        selectedTemplate.name
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] }),
        queryClient.invalidateQueries({ queryKey: ["template-detail", selectedTemplateId] })
      ]);
    } catch (error) {
      pushToast("Archive Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function setDefaultTemplate() {
    if (!selectedTemplateId) return;
    try {
      await apiFetch(`/api/v1/templates/${selectedTemplateId}/default`, {
        method: "POST",
        bodyJson: {}
      });
      pushToast("Default Template Updated", "This template will be preselected for campaigns.");
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
    } catch (error) {
      pushToast("Update Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function deleteTemplate() {
    if (!selectedTemplateId) return;
    const approved = await confirm({
      title: "Delete Template",
      message: "Delete this template? This cannot be undone."
    });
    if (!approved) {
      return;
    }
    try {
      await apiFetch(`/api/v1/templates/${selectedTemplateId}`, {
        method: "DELETE",
        bodyJson: {}
      });
      pushToast("Template Deleted", "The template was removed.");
      setSelectedTemplateId(null);
      setDraftState(null);
      await queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] });
    } catch (error) {
      pushToast("Delete Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function uploadAsset() {
    if (!assetFile) {
      pushToast("No File Selected", "Choose an image file to upload.", "error");
      return;
    }
    try {
      const formData = buildUploadForm({ file: assetFile });
      await apiFetch("/api/v1/template-assets/upload", {
        method: "POST",
        body: formData
      });
      pushToast("Asset Uploaded", assetFile.name);
      setAssetFile(null);
      await queryClient.invalidateQueries({ queryKey: ["template-assets"] });
    } catch (error) {
      pushToast("Upload Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  async function sendTestEmail() {
    if (!selectedTemplateId || !testEmail.trim()) {
      pushToast("Missing Email", "Enter a recipient email for the test send.", "error");
      return;
    }
    try {
      if (draftState) {
        await saveMutation.mutateAsync(draftState);
      }
      await apiFetch(`/api/v1/templates/${selectedTemplateId}/test-send`, {
        method: "POST",
        bodyJson: {
          test_email: testEmail.trim(),
          sample_data: previewData
        }
      });
      pushToast("Test Email Sent", "Brevo accepted the test send.");
    } catch (error) {
      pushToast("Test Send Failed", error instanceof Error ? error.message : "Request failed.", "error");
    }
  }

  function updateBlockField(key: string, value: string, type: string) {
    if (!draftState || !selectedBlockId) return;
    let nextValue: unknown = value;
    if (type === "number") {
      nextValue = Number(value || 0);
    }
    if (type === "json") {
      try {
        nextValue = JSON.parse(value || "[]");
      } catch {
        return;
      }
    }
    const nextBlocks = blocks.map((block) =>
      String(block.id) === selectedBlockId ? { ...block, [key]: nextValue } : block
    );
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
  }

  function addBlock(type: string) {
    if (!draftState) return;
    const nextBlock = createBuilderBlock(type);
    const nextBlocks = [...blocks, nextBlock];
    setDraftState({ ...draftState, editor_mode: "builder", design_json: { ...draftState.design_json, blocks: nextBlocks } });
    setActiveTab("design");
    setSelectedBlockId(String(nextBlock.id));
  }

  function moveBlock(direction: -1 | 1) {
    if (!selectedBlockId || !draftState) return;
    const currentIndex = blocks.findIndex((block) => String(block.id) === selectedBlockId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= blocks.length) return;
    const nextBlocks = [...blocks];
    [nextBlocks[currentIndex], nextBlocks[nextIndex]] = [nextBlocks[nextIndex], nextBlocks[currentIndex]];
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
  }

  function removeBlock(blockId: string) {
    if (!draftState) return;
    const nextBlocks = blocks.filter((block) => String(block.id) !== blockId);
    setDraftState({ ...draftState, design_json: { ...draftState.design_json, blocks: nextBlocks } });
    setSelectedBlockId((nextBlocks[0]?.id as string) || null);
  }

  function addCustomField() {
    if (!draftState) return;
    setDraftState({
      ...draftState,
      merge_fields_schema: [...draftState.merge_fields_schema, createCustomField(draftState.merge_fields_schema)]
    });
  }

  function updateSchemaField(index: number, key: keyof TemplateField, value: string | boolean) {
    if (!draftState) return;
    const nextFields = [...draftState.merge_fields_schema];
    nextFields[index] = { ...nextFields[index], [key]: value } as TemplateField;
    setDraftState({ ...draftState, merge_fields_schema: nextFields });
  }

  function removeSchemaField(index: number) {
    if (!draftState) return;
    const field = draftState.merge_fields_schema[index];
    if (field?.builtin) return;
    const nextFields = [...draftState.merge_fields_schema];
    nextFields.splice(index, 1);
    setDraftState({ ...draftState, merge_fields_schema: nextFields });
  }

  async function copyAssetUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      pushToast("Copied", "Asset URL copied to clipboard.");
    } catch {
      pushToast("Copy Failed", "Could not copy the asset URL.", "error");
    }
  }

  return (
    <section className="view-panel">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <div className="bento-card group relative overflow-hidden p-5">
            <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-blue-500/10 blur-2xl transition-colors group-hover:bg-blue-500/20" />
            <div className="relative z-10 mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Templates</h2>
              <button
                type="button"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ["templates-workspace-list"] })}
                className="text-xs text-gray-400 hover:text-white"
              >
                Refresh
              </button>
            </div>
            <div className="relative z-10 mb-6 space-y-2">
              <button
                type="button"
                onClick={() => void createTemplate("builder")}
                className="w-full rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-colors hover:bg-gray-200"
              >
                New Builder Template
              </button>
              <button
                type="button"
                onClick={() => void createTemplate("code")}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/10"
              >
                New Code Template
              </button>
            </div>

            <div className="relative z-10 mb-3 text-xs uppercase tracking-wider text-gray-500">Your Library</div>
            <div className="relative z-10 max-h-[400px] space-y-2 overflow-y-auto pr-2">
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
                      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-gray-500">
                        {template.editor_mode}
                      </div>
                    </div>
                    {template.is_default ? (
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-black">
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
              {!templatesQuery.data?.templates?.length ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-500">
                  No templates yet.
                </div>
              ) : null}
            </div>

            <div className="relative z-10 mt-6 border-t border-white/10 pt-4">
              <label className="mb-2 block text-xs text-gray-400">Import HTML</label>
              <input
                type="file"
                accept=".html"
                className="w-full text-xs text-gray-400"
                onChange={(event) => setHtmlImportFile(event.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => void importHtmlTemplate()}
                className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs text-white transition-colors hover:bg-white/10"
              >
                Import as Code
              </button>
            </div>
          </div>
        </aside>

        <div className="bento-card flex h-[800px] flex-col overflow-hidden p-0">
          <div className="flex flex-col items-start justify-between gap-4 border-b border-white/10 bg-white/[0.01] p-6 sm:flex-row sm:items-center">
            <div>
              <h2
                onDoubleClick={() => void renameTemplate()}
                className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-xl font-semibold text-transparent"
              >
                {selectedTemplate?.name || "Select a template"}
              </h2>
              <div className="mt-1 text-xs text-gray-500">
                {selectedTemplate ? (
                  <div className="flex flex-wrap gap-2">
                    <span>{draftState?.editor_mode || selectedTemplate.editor_mode} mode</span>
                    {selectedTemplate.draft_version ? (
                      <span>Draft v{selectedTemplate.draft_version.version_number}</span>
                    ) : null}
                    {selectedTemplate.published_version ? (
                      <span>Published v{selectedTemplate.published_version.version_number}</span>
                    ) : (
                      <span>Not yet published</span>
                    )}
                  </div>
                ) : (
                  "Pick or create a template to begin editing."
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void renameTemplate()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10">
                Rename
              </button>
              <button type="button" onClick={() => void duplicateTemplate()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10">
                Duplicate
              </button>
              <button type="button" onClick={() => void archiveTemplate()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10">
                {selectedTemplate?.is_archived ? "Restore" : "Archive"}
              </button>
              <button type="button" onClick={() => void setDefaultTemplate()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10">
                Set Default
              </button>
              <button type="button" onClick={() => void deleteTemplate()} className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-500/20">
                Delete
              </button>
              <div className="mx-1 h-6 w-px bg-white/10" />
              <button
                type="button"
                onClick={() => void saveDraft()}
                disabled={!draftState || saveMutation.isPending}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saveMutation.isPending ? "Saving..." : "Save Draft"}
              </button>
              <button
                type="button"
                onClick={() => publishMutation.mutate()}
                disabled={!selectedTemplateId || publishMutation.isPending}
                className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black shadow-[0_0_15px_rgba(255,255,255,0.1)] transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishMutation.isPending ? "Publishing..." : "Publish"}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 border-b border-white/5 bg-black/20 px-6 py-3">
            {(["design", "code", "preview", "settings"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  if (tab === "design" && draftState) {
                    setDraftState({ ...draftState, editor_mode: "builder" });
                  }
                  if (tab === "code" && draftState) {
                    setDraftState({ ...draftState, editor_mode: "code" });
                  }
                }}
                className={
                  activeTab === tab
                    ? "rounded-full border border-purple-400/35 bg-purple-500/15 px-4 py-2 text-sm font-semibold text-purple-100"
                    : "rounded-full px-4 py-2 text-sm font-medium text-gray-400 transition hover:text-white"
                }
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <div className="ml-auto text-xs text-gray-500">
              {selectedDraftVersion ? <StatusBadge value={selectedDraftVersion.status || "draft"} /> : null}
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto bg-gradient-to-b from-transparent to-black/30 p-6">
            {!draftState || !selectedTemplate ? (
              <div className="flex h-full items-center justify-center text-gray-500">
                Select a template to open its workspace.
              </div>
            ) : null}

            {draftState && selectedTemplate && activeTab === "design" ? (
              <div className="grid h-full items-start gap-8 lg:grid-cols-[1fr_320px]">
                <div className="flex h-[750px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-black/20 shadow-2xl">
                  <div className="relative z-20 flex items-center justify-between border-b border-white/5 bg-black/40 px-6 py-4 shadow-sm">
                    <div className="text-sm font-semibold tracking-wide text-white">Workspace Canvas</div>
                    <div className="grid grid-cols-2 gap-2">
                      {BLOCK_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => addBlock(type)}
                          className={`rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left text-xs text-white transition hover:bg-white/10 ${
                            type === "raw_html" ? "col-span-2 text-center" : ""
                          }`}
                        >
                          {type.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="relative z-10 flex-1 space-y-4 overflow-y-auto p-6">
                    {!blocks.length ? (
                      <div className="flex flex-col items-center justify-center space-y-3 pt-24 opacity-50">
                        <p>No blocks yet. Add one from the canvas header to get started.</p>
                      </div>
                    ) : (
                      blocks.map((block, index) => {
                        const summary =
                          block.heading ||
                          block.text ||
                          block.left_heading ||
                          block.alt ||
                          block.html ||
                          block.type;
                        return (
                          <div
                            key={String(block.id)}
                            className={`rounded-3xl border p-4 ${
                              String(block.id) === selectedBlockId
                                ? "border-purple-500/40 bg-purple-500/10"
                                : "border-white/10 bg-white/5"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <button
                                type="button"
                                onClick={() => setSelectedBlockId(String(block.id))}
                                className="flex-1 text-left"
                              >
                                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                                  {String(block.type)}
                                </div>
                                <div className="mt-1 text-sm font-semibold text-white">
                                  {String(summary).slice(0, 90)}
                                </div>
                              </button>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBlockId(String(block.id));
                                    moveBlock(-1);
                                  }}
                                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white transition hover:bg-white/10"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedBlockId(String(block.id));
                                    moveBlock(1);
                                  }}
                                  className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-white transition hover:bg-white/10"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeBlock(String(block.id))}
                                  className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                              <span>Position {index + 1}</span>
                              <span>
                                {block.visibility_field
                                  ? `Visible when ${String(block.visibility_field)} is ${String(block.visibility_mode || "present")}`
                                  : "Always visible"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="h-[750px]">
                  <div className="sticky top-0 h-full w-full overflow-y-auto rounded-2xl border border-white/5 bg-black/40 p-5 text-sm text-gray-400 shadow-lg">
                    {!selectedBlock ? (
                      <div className="flex flex-col items-center justify-center space-y-3 pt-24 opacity-50">
                        <p>Select a block to configure its properties</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                            {String(selectedBlock.type)}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-white">Inspector</div>
                        </div>
                        {(BLOCK_FIELD_CONFIG[String(selectedBlock.type)] || BLOCK_FIELD_CONFIG.text).map((field) => {
                          const rawValue = selectedBlock[field.key];
                          const value =
                            field.type === "json"
                              ? JSON.stringify(rawValue || [], null, 2)
                              : String(rawValue ?? "");
                          return (
                            <div key={field.key}>
                              <label className="text-sm text-gray-400">{field.label}</label>
                              {field.type === "textarea" || field.type === "json" ? (
                                <textarea
                                  spellCheck={false}
                                  value={value}
                                  onChange={(event) => updateBlockField(field.key, event.target.value, field.type)}
                                  className="mt-2 h-28 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                                />
                              ) : field.type === "select" ? (
                                <select
                                  value={String(rawValue ?? "")}
                                  onChange={(event) => updateBlockField(field.key, event.target.value, field.type)}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
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
                                  value={value}
                                  onChange={(event) => updateBlockField(field.key, event.target.value, field.type)}
                                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                                />
                              )}
                            </div>
                          );
                        })}
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Visibility rule</div>
                          <div className="mt-3 grid gap-3">
                            <div>
                              <label className="text-sm text-gray-400">Field</label>
                              <select
                                value={String(selectedBlock.visibility_field || "")}
                                onChange={(event) => updateBlockField("visibility_field", event.target.value, "select")}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                              >
                                <option value="">Always visible</option>
                                {draftState.merge_fields_schema
                                  .filter((field) => field.key !== "unsubscribe_url")
                                  .map((field) => (
                                    <option key={field.key} value={field.key}>
                                      {field.key}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-sm text-gray-400">Mode</label>
                              <select
                                value={String(selectedBlock.visibility_mode || "present")}
                                onChange={(event) => updateBlockField("visibility_mode", event.target.value, "select")}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                              >
                                <option value="present">Show when field is present</option>
                                <option value="missing">Show when field is missing</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {draftState && activeTab === "code" ? (
              <div className="h-full">
                <textarea
                  spellCheck={false}
                  value={draftState.html_source}
                  onChange={(event) =>
                    setDraftState({ ...draftState, html_source: event.target.value, editor_mode: "code" })
                  }
                  className="h-full w-full rounded-xl border border-white/10 bg-black/50 p-4 font-mono text-sm text-gray-300"
                />
              </div>
            ) : null}

            {draftState && activeTab === "preview" ? (
              <div className="grid h-full gap-6 lg:grid-cols-[280px_1fr]">
                <div className="space-y-6">
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs uppercase tracking-wider text-gray-500">Sample Data</div>
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewData(
                            Object.fromEntries(
                              draftState.merge_fields_schema
                                .filter((field) => field.key !== "unsubscribe_url")
                                .map((field) => [
                                  field.key,
                                  field.sample_value || field.default_value || previewData[field.key] || ""
                                ])
                            )
                          )
                        }
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-gray-200"
                      >
                        Use Auto
                      </button>
                    </div>
                    <div className="mb-4 space-y-2">
                      {draftState.merge_fields_schema
                        .filter((field) => field.key !== "unsubscribe_url")
                        .map((field) => (
                          <div key={field.key}>
                            <label className="text-sm text-gray-400">{field.label || field.key}</label>
                            <input
                              value={previewData[field.key] || ""}
                              onChange={(event) =>
                                setPreviewData({ ...previewData, [field.key]: event.target.value })
                              }
                              className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500"
                            />
                          </div>
                        ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshPreview()}
                      className="w-full rounded-lg bg-white/10 py-2 text-xs font-medium text-white transition hover:bg-white/20"
                    >
                      Update Preview
                    </button>
                  </div>
                  <div>
                    <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Modes</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: "Full Width", width: "100%" },
                        { label: "Desktop", width: "680px" },
                        { label: "Mobile", width: "360px" }
                      ].map((option) => (
                        <button
                          key={option.width}
                          type="button"
                          onClick={() => setPreviewWidth(option.width)}
                          className={
                            previewWidth === option.width
                              ? "rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black"
                              : "rounded-full border border-white/20 bg-transparent px-3 py-1.5 text-xs text-gray-300"
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-white/5 p-3 text-xs text-gray-400">
                    {previewSubject ? `Subject: ${previewSubject}` : "No subject set."}
                  </div>
                </div>
                <div
                  className="mx-auto h-full w-full overflow-hidden rounded-xl border border-white/10 bg-white shadow-2xl transition-all duration-300"
                  style={{ maxWidth: previewWidth }}
                >
                  <iframe
                    title="Template Preview"
                    sandbox=""
                    srcDoc={previewHtml || selectedDraftVersion?.compiled_html || ""}
                    className="h-full w-full border-0 bg-white"
                  />
                </div>
              </div>
            ) : null}

            {draftState && activeTab === "settings" ? (
              <div className="grid h-full content-start gap-8 md:grid-cols-2">
                <div className="space-y-6">
                  <div className="space-y-4 rounded-xl border border-white/5 bg-white/5 p-5">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Subject</label>
                      <input
                        value={draftState.subject}
                        onChange={(event) => setDraftState({ ...draftState, subject: event.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-500">Preheader</label>
                      <input
                        value={draftState.preheader}
                        onChange={(event) => setDraftState({ ...draftState, preheader: event.target.value })}
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="text-xs uppercase tracking-wider text-gray-500">Merge Fields</div>
                      <button
                        type="button"
                        onClick={() => addCustomField()}
                        className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black transition hover:bg-gray-200"
                      >
                        Add Field
                      </button>
                    </div>
                    <div className="max-h-[360px] space-y-2 overflow-auto pr-2">
                      {draftState.merge_fields_schema.map((field, index) => (
                        <div key={`${field.key}-${index}`} className="rounded-3xl border border-white/10 bg-white/5 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">
                                {field.builtin ? "Built-in" : "Custom field"}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-white">
                                {field.label || field.key}
                              </div>
                            </div>
                            {field.builtin ? (
                              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-gray-300">
                                Locked
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => removeSchemaField(index)}
                                className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                          <div className="mt-4 grid gap-3 md:grid-cols-2">
                            <div>
                              <label className="text-sm text-gray-400">Label</label>
                              <input
                                value={field.label || ""}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "label", event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-gray-400">Key</label>
                              <input
                                value={field.key || ""}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "key", event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-gray-400">Default value</label>
                              <input
                                value={field.default_value || ""}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "default_value", event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500 disabled:opacity-60"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-gray-400">Sample value</label>
                              <input
                                value={field.sample_value || ""}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "sample_value", event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500 disabled:opacity-60"
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className="text-sm text-gray-400">Description</label>
                              <input
                                value={field.description || ""}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "description", event.target.value)}
                                className="mt-2 w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-purple-500 disabled:opacity-60"
                              />
                            </div>
                            <label className="flex items-center gap-3 text-sm text-gray-300">
                              <input
                                type="checkbox"
                                checked={field.required}
                                disabled={Boolean(field.builtin)}
                                onChange={(event) => updateSchemaField(index, "required", event.target.checked)}
                                className="h-4 w-4 rounded border-white/10 bg-black/40"
                              />
                              Required during import validation
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                    <div className="mb-2 text-xs uppercase tracking-wider text-gray-500">Test Send</div>
                    <div className="mb-4 text-xs text-gray-400">Fire a real test email with current draft layout.</div>
                    <input
                      type="email"
                      placeholder="you@domain.com"
                      value={testEmail}
                      onChange={(event) => setTestEmail(event.target.value)}
                      className="mb-3 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                    />
                    <button
                      type="button"
                      onClick={() => void sendTestEmail()}
                      className="w-full rounded-lg bg-white py-2 text-sm font-semibold text-black transition hover:bg-gray-200"
                    >
                      Send Test
                    </button>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                    <div className="mb-4 text-xs uppercase tracking-wider text-gray-500">Assets Gallery</div>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.gif,.webp"
                      className="mb-3 w-full text-xs text-gray-400"
                      onChange={(event) => setAssetFile(event.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      onClick={() => void uploadAsset()}
                      disabled={!assetsQuery.data?.enabled}
                      className="mb-4 w-full rounded-lg border border-white/10 bg-white/5 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Upload New Asset
                    </button>
                    <div className="max-h-[180px] space-y-2 overflow-auto pr-2">
                      {(assetsQuery.data?.assets || []).map((asset) => (
                        <div key={asset.filename} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-white">{asset.filename}</div>
                              <div className="mt-1 text-xs text-gray-500">{Math.round(asset.size / 1024)} KB</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void copyAssetUrl(asset.url)}
                              className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white transition hover:bg-white/10"
                            >
                              Copy URL
                            </button>
                          </div>
                        </div>
                      ))}
                      {!assetsQuery.data?.assets?.length ? (
                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-500">
                          No uploaded assets yet.
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-3 text-[10px] text-gray-500">
                      {assetsQuery.data?.enabled
                        ? `Assets are publicly available from ${assetsQuery.data.base_url || API_BASE_URL}.`
                        : "Set PUBLIC_BASE_URL to enable local asset uploads. External image URLs still work."}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                    <div className="mb-3 text-xs uppercase tracking-wider text-gray-500">Published Snapshot</div>
                    {publishedVersion ? (
                      <div className="space-y-2 text-sm text-gray-300">
                        <StatusBadge value="published" />
                        <div>Subject: {publishedVersion.subject}</div>
                        <div>Version: {publishedVersion.version_number}</div>
                        <div className="text-xs text-gray-500">
                          Published at {publishedVersion.published_at || "not available"}
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">No published version yet.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
