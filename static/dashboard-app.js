const token = localStorage.getItem("token");
if (!token) {
  window.location.href = "/login";
}

const authHeaders = { Authorization: `Bearer ${token}` };
const state = {
  activeView: "dashboard",
  settings: {},
  stats: {},
  templates: [],
  selectedTemplate: null,
  selectedTemplateId: null,
  templateEditorMode: "builder",
  templateValidationErrors: [],
  selectedBlockId: null,
  previewData: {},
  assets: [],
  importSession: null,
  importValidation: null,
  stagedBatch: null,
  batches: [],
  activity: [],
  contacts: [],
  contactSearchTimeout: null,
  previewWidth: "100%",
};

const BUILDER_BLOCK_DEFAULTS = {
  section: {
    type: "section",
    heading: "Section title",
    body: "Write a concise message here.",
    background_color: "#ffffff",
    text_color: "#111827",
    padding: 32,
    align: "left",
  },
  columns: {
    type: "columns",
    left_heading: "Left column",
    left_text: "Add supporting copy here.",
    right_heading: "Right column",
    right_text: "Add complementary content here.",
    background_color: "#ffffff",
    text_color: "#111827",
    padding: 24,
    gap: 16,
  },
  text: {
    type: "text",
    text: "Text block",
    color: "#334155",
    font_size: 16,
    padding: 16,
    align: "left",
  },
  image: {
    type: "image",
    src: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=1200",
    alt: "Image",
    href: "",
    width: 520,
    padding: 16,
    align: "center",
    background_color: "#ffffff",
  },
  button: {
    type: "button",
    text: "Call to Action",
    url: "https://example.com",
    align: "left",
    background_color: "#111827",
    text_color: "#ffffff",
    padding: 0,
  },
  spacer: {
    type: "spacer",
    height: 24,
  },
  divider: {
    type: "divider",
    color: "#e5e7eb",
    padding: 24,
  },
  social_footer: {
    type: "social_footer",
    heading: "Stay connected",
    footer_text: "Manage your preferences anytime.",
    text_color: "#64748b",
    padding: 24,
    links: [{ label: "Website", url: "https://example.com" }],
  },
  raw_html: {
    type: "raw_html",
    html: "<div>Custom HTML block</div>",
  },
};

const BLOCK_FIELD_CONFIG = {
  section: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
    {
      key: "align",
      label: "Alignment",
      type: "select",
      options: ["left", "center", "right"],
    },
  ],
  columns: [
    { key: "left_heading", label: "Left heading", type: "text" },
    { key: "left_text", label: "Left text", type: "textarea" },
    { key: "right_heading", label: "Right heading", type: "text" },
    { key: "right_text", label: "Right text", type: "textarea" },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "gap", label: "Gap", type: "number" },
  ],
  text: [
    { key: "text", label: "Text", type: "textarea" },
    { key: "color", label: "Text color", type: "color" },
    { key: "font_size", label: "Font size", type: "number" },
    { key: "padding", label: "Padding", type: "number" },
    {
      key: "align",
      label: "Alignment",
      type: "select",
      options: ["left", "center", "right"],
    },
  ],
  image: [
    { key: "src", label: "Image URL", type: "text" },
    { key: "alt", label: "Alt text", type: "text" },
    { key: "href", label: "Link URL", type: "text" },
    { key: "width", label: "Max width", type: "number" },
    { key: "padding", label: "Padding", type: "number" },
    {
      key: "align",
      label: "Alignment",
      type: "select",
      options: ["left", "center", "right"],
    },
    { key: "background_color", label: "Background", type: "color" },
  ],
  button: [
    { key: "text", label: "Label", type: "text" },
    { key: "url", label: "Target URL", type: "text" },
    {
      key: "align",
      label: "Alignment",
      type: "select",
      options: ["left", "center", "right"],
    },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
  ],
  spacer: [{ key: "height", label: "Height", type: "number" }],
  divider: [
    { key: "color", label: "Color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
  ],
  social_footer: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "footer_text", label: "Footer text", type: "textarea" },
    { key: "text_color", label: "Text color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "links", label: "Links JSON", type: "json" },
  ],
  raw_html: [{ key: "html", label: "HTML", type: "textarea" }],
};

async function api(path, options = {}) {
  const requestOptions = { ...options, headers: { ...authHeaders, ...(options.headers || {}) } };
  if (requestOptions.body && !(requestOptions.body instanceof FormData)) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(requestOptions.body);
  }

  const response = await fetch(path, requestOptions);
  if (response.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail = typeof data === "string" ? data : data.detail || "Request failed";
    throw new Error(detail);
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value.endsWith("Z") ? value : `${value}Z`);
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status) {
  const styles = {
    draft: "bg-slate-400/10 text-slate-200 border-slate-400/20",
    published: "bg-emerald-400/10 text-emerald-200 border-emerald-400/20",
    archived: "bg-slate-400/10 text-slate-300 border-slate-400/20",
    subscribed: "bg-emerald-400/10 text-emerald-200 border-emerald-400/20",
    queued: "bg-amber-400/10 text-amber-200 border-amber-400/20",
    processing: "bg-sky-400/10 text-sky-200 border-sky-400/20",
    sent: "bg-emerald-400/10 text-emerald-200 border-emerald-400/20",
    failed: "bg-rose-400/10 text-rose-200 border-rose-400/20",
    staged: "bg-slate-400/10 text-slate-200 border-slate-400/20",
    unsubscribed: "bg-fuchsia-400/10 text-fuchsia-200 border-fuchsia-400/20",
    completed: "bg-emerald-400/10 text-emerald-200 border-emerald-400/20",
    completed_with_errors: "bg-rose-400/10 text-rose-200 border-rose-400/20",
  };
  const cls = styles[status] || "bg-slate-400/10 text-slate-200 border-slate-400/20";
  return `<span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${cls}">${escapeHtml(status || "unknown")}</span>`;
}

function switchView(view) {
  state.activeView = view;
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `view-${view}`);
  });
  document.querySelectorAll(".view-trigger").forEach((button) => {
    const active = button.dataset.viewTrigger === view;
    button.className = active
      ? "view-trigger rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950 transition"
      : "view-trigger rounded-full px-4 py-2 text-sm font-medium text-slate-300 transition hover:text-white";
  });
}

function getDraftVersion() {
  return state.selectedTemplate?.draft_version || null;
}

function currentSchema() {
  return getDraftVersion()?.merge_fields_schema || [];
}

function currentDesign() {
  const draft = getDraftVersion();
  if (!draft) return { blocks: [] };
  if (!draft.design_json || typeof draft.design_json !== "object") {
    draft.design_json = { blocks: [] };
  }
  if (!Array.isArray(draft.design_json.blocks)) {
    draft.design_json.blocks = [];
  }
  return draft.design_json;
}

function ensureBuilderDesign() {
  const design = currentDesign();
  if (!design.content_width) design.content_width = 600;
  if (!design.body_background_color) design.body_background_color = "#030712";
  if (!design.content_background_color) design.content_background_color = "#ffffff";
  return design;
}

function getSelectedBlock() {
  const blocks = currentDesign().blocks || [];
  return blocks.find((block) => block.id === state.selectedBlockId) || null;
}

function createBlock(type) {
  return {
    id: `block-${Math.random().toString(36).slice(2, 10)}`,
    visibility_field: "",
    visibility_mode: "present",
    ...(BUILDER_BLOCK_DEFAULTS[type] || BUILDER_BLOCK_DEFAULTS.text),
  };
}

function updateStatsUI() {
  const stats = state.stats || {};
  document.getElementById("stat-total-contacts").textContent = stats.total_contacts || 0;
  document.getElementById("stat-templates").textContent = stats.templates || 0;
  document.getElementById("stat-batches").textContent = stats.batches || 0;
  document.getElementById("stat-queued").textContent = stats.queued || 0;
  document.getElementById("stat-sent").textContent = stats.sent || 0;
  document.getElementById("stat-failed").textContent = stats.failed || 0;
  document.getElementById("usage-hour").textContent = stats.emails_sent_this_hour || 0;
  document.getElementById("usage-day").textContent = stats.emails_sent_today || 0;
  document.getElementById("limit-hour").textContent = stats.hourly_limit || 0;
  document.getElementById("limit-day").textContent = stats.daily_limit || 0;
}

async function loadStats() {
  state.stats = await api("/api/stats");
  updateStatsUI();
}

function populateSettingsForm() {
  const form = document.getElementById("settings-form");
  form.elements.brevo_api_key.value = state.settings.brevo_api_key || "";
  form.elements.sender_email.value = state.settings.sender_email || "";
  form.elements.sender_name.value = state.settings.sender_name || "";
  form.elements.hourly_limit.value = state.settings.hourly_limit || 20;
  form.elements.daily_limit.value = state.settings.daily_limit || 300;
}

function renderTemplateSelectors() {
  const defaultSelect = document.getElementById("settings-default-template");
  const launchSelect = document.getElementById("campaign-template-select");
  const templates = state.templates || [];
  const publishedTemplates = templates.filter(
    (template) => template.published_version && !template.is_archived,
  );

  defaultSelect.innerHTML = templates.length
    ? ""
    : '<option value="">No templates available</option>';
  launchSelect.innerHTML = publishedTemplates.length
    ? ""
    : '<option value="">No published templates available</option>';

  templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.name}${template.is_archived ? " (Archived)" : ""}`;
    option.selected = template.id === state.settings.default_template_id;
    defaultSelect.appendChild(option);
  });

  publishedTemplates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.name} · v${template.published_version.version_number}`;
    if (!launchSelect.value && template.id === state.settings.default_template_id) {
      option.selected = true;
    }
    launchSelect.appendChild(option);
  });

  updateCampaignTemplateHint();
}

function renderTemplateList() {
  const list = document.getElementById("template-list");
  if (!state.templates.length) {
    list.innerHTML = '<div class="rounded-2xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-500">No templates yet.</div>';
    return;
  }

  list.innerHTML = state.templates
    .map((template) => {
      const selected = state.selectedTemplateId === template.id;
      const published = template.published_version;
      const draft = template.draft_version;
      const badge = template.is_default
        ? '<span class="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-950">Default</span>'
        : "";
      return `
        <button data-template-id="${template.id}" class="template-list-item w-full rounded-3xl border ${
          selected ? "border-sky-400/40 bg-sky-400/10" : "border-white/10 bg-slate-950/40"
        } p-4 text-left transition hover:border-sky-400/30 hover:bg-sky-400/5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-white">${escapeHtml(template.name)}</div>
              <div class="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">${escapeHtml(template.editor_mode)}</div>
            </div>
            ${badge}
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${draft ? statusBadge("draft") : ""}
            ${published ? statusBadge("published") : ""}
            ${template.is_archived ? statusBadge("archived") : ""}
          </div>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".template-list-item").forEach((button) => {
    button.addEventListener("click", () => loadTemplateDetail(Number(button.dataset.templateId)));
  });
}

function updateCampaignTemplateHint() {
  const selectedId = Number(document.getElementById("campaign-template-select").value || 0);
  const template = state.templates.find((item) => item.id === selectedId);
  const hint = document.getElementById("campaign-template-hint");
  if (!template?.published_version) {
    hint.textContent = "Select a published template to unlock import validation.";
    return;
  }
  hint.textContent = `Published version ${template.published_version.version_number} · Subject: ${template.published_version.subject}`;
}

async function loadSettings() {
  state.settings = await api("/api/settings");
  populateSettingsForm();
}

async function loadTemplates(preserveSelection = true) {
  const data = await api("/api/templates");
  state.templates = data.templates || [];
  if (!preserveSelection || !state.selectedTemplateId) {
    state.selectedTemplateId = state.settings.default_template_id || state.templates[0]?.id || null;
  } else if (!state.templates.some((template) => template.id === state.selectedTemplateId)) {
    state.selectedTemplateId = state.templates[0]?.id || null;
  }
  renderTemplateSelectors();
  renderTemplateList();
  if (state.selectedTemplateId) {
    await loadTemplateDetail(state.selectedTemplateId, true);
  } else {
    renderTemplateWorkspaceEmpty();
  }
}

function renderTemplateWorkspaceEmpty() {
  state.selectedTemplate = null;
  state.selectedBlockId = null;
  document.getElementById("template-editor-title").textContent = "Select a template";
  document.getElementById("template-editor-meta").textContent =
    "Choose a template from the library to open its draft workspace.";
  document.getElementById("builder-block-list").innerHTML =
    '<div class="rounded-3xl border border-white/10 bg-slate-950/40 p-5 text-sm text-slate-500">No template selected.</div>';
  document.getElementById("block-inspector").innerHTML =
    "Select a block to edit its fields, visibility rules, and content.";
  document.getElementById("schema-fields-list").innerHTML = "";
  document.getElementById("preview-sample-fields").innerHTML = "";
  document.getElementById("asset-list").innerHTML = "";
  document.getElementById("template-html-source").value = "";
  document.getElementById("template-subject").value = "";
  document.getElementById("template-preheader").value = "";
  document.getElementById("preview-subject").textContent = "";
  document.getElementById("preview-frame").srcdoc = "";
}

async function loadTemplateDetail(templateId, preserveScroll = false) {
  state.selectedTemplateId = templateId;
  const data = await api(`/api/templates/${templateId}`);
  state.selectedTemplate = data.template;
  state.templateEditorMode = state.selectedTemplate?.draft_version?.editor_mode || state.selectedTemplate?.editor_mode || "builder";
  state.activeTemplateTab = state.templateEditorMode === "code" ? "code" : "design";
  state.templateValidationErrors = [];
  const blocks = currentDesign().blocks || [];
  state.selectedBlockId = blocks[0]?.id || null;
  buildPreviewDataFromSchema(false);
  renderTemplateList();
  renderTemplateEditor();
  await loadAssets();
  if (!preserveScroll) {
    switchView("templates");
  }
}

function buildPreviewDataFromSchema(useSamples) {
  const schema = currentSchema();
  const nextData = {};
  schema.forEach((field) => {
    if (field.key === "unsubscribe_url") return;
    nextData[field.key] = useSamples
      ? field.sample_value || field.default_value || ""
      : state.previewData[field.key] || field.default_value || "";
  });
  nextData.email = nextData.email || "alex@example.com";
  nextData.name = nextData.name || "Alex Johnson";
  state.previewData = nextData;
}

function renderTemplateEditor() {
  if (!state.selectedTemplate) {
    renderTemplateWorkspaceEmpty();
    return;
  }

  const template = state.selectedTemplate;
  const draft = getDraftVersion();
  const published = template.published_version;
  document.getElementById("template-editor-title").textContent = template.name;
  document.getElementById("template-editor-meta").innerHTML = `
    <div class="flex flex-wrap gap-2">
      <span class="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">${escapeHtml(state.templateEditorMode)} mode</span>
      ${draft ? `<span class="text-slate-400">Draft v${draft.version_number}</span>` : ""}
      ${published ? `<span class="text-slate-400">Published v${published.version_number}</span>` : '<span class="text-amber-300">Not yet published</span>'}
    </div>
  `;
  document.getElementById("template-subject").value = draft?.subject || "";
  document.getElementById("template-preheader").value = draft?.preheader || "";
  document.getElementById("template-html-source").value = draft?.html_source || "";
  document.getElementById("template-validation-banner").innerHTML = state.templateValidationErrors.length
    ? `<span class="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">${state.templateValidationErrors.length} validation issue(s)</span>`
    : '<span class="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Draft ready</span>';

  renderBuilderBlocks();
  renderBlockInspector();
  renderSchemaFields();
  renderPreviewSampleFields();
  renderTemplateTabs();
}

function renderTemplateTabs() {
  document.querySelectorAll(".template-tab-panel").forEach((panel) => {
    panel.classList.add("hidden");
  });
  document.getElementById(`template-tab-${state.activeTemplateTab || "design"}`).classList.remove("hidden");
  document.querySelectorAll(".template-tab").forEach((button) => {
    const active = button.dataset.templateTab === (state.activeTemplateTab || "design");
    button.className = active
      ? "template-tab rounded-full border border-white/10 bg-white px-4 py-2 text-sm font-semibold text-slate-950"
      : "template-tab rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-300";
  });
}

function renderBuilderBlocks() {
  const container = document.getElementById("builder-block-list");
  const blocks = currentDesign().blocks || [];
  if (!blocks.length) {
    container.innerHTML =
      '<div class="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-500">No blocks yet. Add one from the library.</div>';
    return;
  }

  container.innerHTML = blocks
    .map((block, index) => {
      const selected = block.id === state.selectedBlockId;
      const summary =
        block.heading ||
        block.text ||
        block.left_heading ||
        block.alt ||
        block.html ||
        block.type;
      return `
        <div class="rounded-3xl border ${
          selected ? "border-sky-400/40 bg-sky-400/10" : "border-white/10 bg-slate-950/40"
        } p-4">
          <div class="flex items-start justify-between gap-4">
            <button data-select-block="${block.id}" class="flex-1 text-left">
              <div class="text-xs uppercase tracking-[0.18em] text-slate-500">${escapeHtml(block.type)}</div>
              <div class="mt-1 text-sm font-semibold text-white">${escapeHtml(String(summary).slice(0, 90))}</div>
            </button>
            <div class="flex items-center gap-2">
              <button data-move-block="${block.id}:up" class="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-200">↑</button>
              <button data-move-block="${block.id}:down" class="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-200">↓</button>
              <button data-delete-block="${block.id}" class="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-200">Delete</button>
            </div>
          </div>
          <div class="mt-3 flex items-center justify-between text-xs text-slate-400">
            <span>Position ${index + 1}</span>
            <span>${block.visibility_field ? `Visible when ${block.visibility_field} is ${block.visibility_mode}` : "Always visible"}</span>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll("[data-select-block]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedBlockId = button.dataset.selectBlock;
      renderBuilderBlocks();
      renderBlockInspector();
    });
  });
  container.querySelectorAll("[data-move-block]").forEach((button) => {
    button.addEventListener("click", () => moveBlock(button.dataset.moveBlock));
  });
  container.querySelectorAll("[data-delete-block]").forEach((button) => {
    button.addEventListener("click", () => deleteBlock(button.dataset.deleteBlock));
  });
}

function schemaFieldOptions() {
  return currentSchema()
    .filter((field) => field.key !== "unsubscribe_url")
    .map((field) => field.key);
}

function renderFieldInput(field, value) {
  if (field.type === "textarea" || field.type === "json") {
    const displayValue = field.type === "json" ? JSON.stringify(value || [], null, 2) : value || "";
    return `<textarea data-block-field="${field.key}" class="mt-2 h-28 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400" spellcheck="false">${escapeHtml(displayValue)}</textarea>`;
  }
  if (field.type === "select") {
    return `
      <select data-block-field="${field.key}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400">
        ${field.options
          .map(
            (option) =>
              `<option value="${escapeHtml(option)}" ${value === option ? "selected" : ""}>${escapeHtml(option)}</option>`,
          )
          .join("")}
      </select>
    `;
  }
  return `<input data-block-field="${field.key}" type="${field.type}" value="${escapeHtml(value ?? "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400" />`;
}

function renderBlockInspector() {
  const container = document.getElementById("block-inspector");
  const block = getSelectedBlock();
  if (!block) {
    container.innerHTML =
      "Select a block to edit its fields, visibility rules, and content.";
    return;
  }

  const fieldConfig = BLOCK_FIELD_CONFIG[block.type] || BLOCK_FIELD_CONFIG.text;
  const visibilityOptions = ["", ...schemaFieldOptions()];
  container.innerHTML = `
    <div class="space-y-4">
      <div>
        <div class="text-xs uppercase tracking-[0.18em] text-slate-500">${escapeHtml(block.type)}</div>
        <div class="mt-1 text-sm font-semibold text-white">Inspector</div>
      </div>
      ${fieldConfig
        .map(
          (field) => `
            <div>
              <label class="text-sm text-slate-400">${escapeHtml(field.label)}</label>
              ${renderFieldInput(field, block[field.key])}
            </div>
          `,
        )
        .join("")}
      <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div class="text-xs uppercase tracking-[0.18em] text-slate-500">Visibility rule</div>
        <div class="mt-3 grid gap-3">
          <div>
            <label class="text-sm text-slate-400">Field</label>
            <select data-block-field="visibility_field" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400">
              ${visibilityOptions
                .map(
                  (option) =>
                    `<option value="${escapeHtml(option)}" ${String(block.visibility_field || "") === option ? "selected" : ""}>${option ? escapeHtml(option) : "Always visible"}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div>
            <label class="text-sm text-slate-400">Mode</label>
            <select data-block-field="visibility_mode" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400">
              <option value="present" ${block.visibility_mode === "present" ? "selected" : ""}>Show when field is present</option>
              <option value="missing" ${block.visibility_mode === "missing" ? "selected" : ""}>Show when field is missing</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-block-field]").forEach((input) => {
    input.addEventListener("input", () => updateBlockField(input));
    input.addEventListener("change", () => updateBlockField(input));
  });
}

function updateBlockField(input) {
  const block = getSelectedBlock();
  if (!block) return;
  const key = input.dataset.blockField;
  const config = (BLOCK_FIELD_CONFIG[block.type] || []).find((field) => field.key === key);
  let value = input.value;
  if (config?.type === "number") {
    value = Number(value || 0);
  }
  if (config?.type === "json") {
    try {
      value = JSON.parse(value || "[]");
    } catch (error) {
      return;
    }
  }
  block[key] = value;
  renderBuilderBlocks();
}

function addBlock(type) {
  ensureBuilderDesign().blocks.push(createBlock(type));
  state.templateEditorMode = "builder";
  state.activeTemplateTab = "design";
  const blocks = currentDesign().blocks;
  state.selectedBlockId = blocks[blocks.length - 1].id;
  renderTemplateEditor();
}

function moveBlock(descriptor) {
  const [blockId, direction] = descriptor.split(":");
  const blocks = currentDesign().blocks;
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return;
  const offset = direction === "up" ? -1 : 1;
  const targetIndex = index + offset;
  if (targetIndex < 0 || targetIndex >= blocks.length) return;
  [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
  renderBuilderBlocks();
}

function deleteBlock(blockId) {
  const blocks = currentDesign().blocks;
  const nextBlocks = blocks.filter((block) => block.id !== blockId);
  currentDesign().blocks = nextBlocks;
  state.selectedBlockId = nextBlocks[0]?.id || null;
  renderTemplateEditor();
}

function renderSchemaFields() {
  const container = document.getElementById("schema-fields-list");
  const schema = currentSchema();
  container.innerHTML = schema
    .map((field, index) => {
      const disabled = field.builtin ? "disabled" : "";
      return `
        <div class="rounded-3xl border border-white/10 bg-black/20 p-4">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-xs uppercase tracking-[0.18em] text-slate-500">${field.builtin ? "Built-in" : "Custom field"}</div>
              <div class="mt-1 text-sm font-semibold text-white">${escapeHtml(field.label || field.key)}</div>
            </div>
            ${
              field.builtin
                ? '<span class="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-slate-300">Locked</span>'
                : `<button data-remove-schema="${index}" class="rounded-full border border-rose-400/20 bg-rose-400/10 px-3 py-1 text-xs text-rose-200">Remove</button>`
            }
          </div>
          <div class="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label class="text-sm text-slate-400">Label</label>
              <input data-schema-index="${index}" data-schema-key="label" ${disabled} value="${escapeHtml(field.label || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 disabled:opacity-60" />
            </div>
            <div>
              <label class="text-sm text-slate-400">Key</label>
              <input data-schema-index="${index}" data-schema-key="key" ${disabled} value="${escapeHtml(field.key || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 disabled:opacity-60" />
            </div>
            <div>
              <label class="text-sm text-slate-400">Default value</label>
              <input data-schema-index="${index}" data-schema-key="default_value" ${disabled} value="${escapeHtml(field.default_value || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 disabled:opacity-60" />
            </div>
            <div>
              <label class="text-sm text-slate-400">Sample value</label>
              <input data-schema-index="${index}" data-schema-key="sample_value" ${disabled} value="${escapeHtml(field.sample_value || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 disabled:opacity-60" />
            </div>
            <div class="md:col-span-2">
              <label class="text-sm text-slate-400">Description</label>
              <input data-schema-index="${index}" data-schema-key="description" ${disabled} value="${escapeHtml(field.description || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400 disabled:opacity-60" />
            </div>
            <label class="flex items-center gap-3 text-sm text-slate-300">
              <input data-schema-index="${index}" data-schema-key="required" type="checkbox" ${field.required ? "checked" : ""} ${disabled} class="h-4 w-4 rounded border-white/10 bg-black/30" />
              Required during import validation
            </label>
          </div>
        </div>
      `;
    })
    .join("");

  container.querySelectorAll("[data-schema-index]").forEach((input) => {
    input.addEventListener("input", () => updateSchemaField(input));
    input.addEventListener("change", () => updateSchemaField(input));
  });
  container.querySelectorAll("[data-remove-schema]").forEach((button) => {
    button.addEventListener("click", () => {
      const schema = currentSchema();
      schema.splice(Number(button.dataset.removeSchema), 1);
      renderTemplateEditor();
    });
  });
}

function updateSchemaField(input) {
  const schema = currentSchema();
  const index = Number(input.dataset.schemaIndex);
  const key = input.dataset.schemaKey;
  if (!schema[index]) return;
  schema[index][key] = input.type === "checkbox" ? input.checked : input.value;
  renderPreviewSampleFields();
  renderBlockInspector();
}

function renderPreviewSampleFields() {
  const container = document.getElementById("preview-sample-fields");
  const schema = currentSchema().filter((field) => field.key !== "unsubscribe_url");
  container.innerHTML = schema
    .map(
      (field) => `
        <div>
          <label class="text-sm text-slate-400">${escapeHtml(field.label || field.key)}</label>
          <input data-preview-key="${field.key}" value="${escapeHtml(state.previewData[field.key] || "")}" class="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400" />
        </div>
      `,
    )
    .join("");
  container.querySelectorAll("[data-preview-key]").forEach((input) => {
    input.addEventListener("input", () => {
      state.previewData[input.dataset.previewKey] = input.value;
    });
  });
}

function collectTemplateDraftPayload() {
  const draft = getDraftVersion() || {};
  const subject = document.getElementById("template-subject").value.trim();
  const preheader = document.getElementById("template-preheader").value.trim();
  const htmlSource = document.getElementById("template-html-source").value;
  return {
    name: state.selectedTemplate.name,
    editor_mode: state.templateEditorMode,
    subject,
    preheader,
    design_json: currentDesign(),
    html_source: htmlSource,
    merge_fields_schema: currentSchema(),
  };
}

async function saveDraft(options = {}) {
  if (!state.selectedTemplateId) return;
  const payload = collectTemplateDraftPayload();
  const response = await api(`/api/templates/${state.selectedTemplateId}/draft`, {
    method: "PUT",
    body: payload,
  });
  state.selectedTemplate = response.template;
  state.templateValidationErrors = response.errors || [];
  state.templateEditorMode = state.selectedTemplate.draft_version.editor_mode;
  renderTemplateEditor();
  await loadTemplates(true);
  if (!options.silent) {
    showToast(
      state.templateValidationErrors.length ? "Draft Saved With Warnings" : "Draft Saved",
      state.templateValidationErrors.length
        ? state.templateValidationErrors.join(" ")
        : "Draft changes were saved.",
      state.templateValidationErrors.length > 0,
    );
  }
}

async function publishCurrentTemplate() {
  if (!state.selectedTemplateId) return;
  await saveDraft({ silent: true });
  if (state.templateValidationErrors.length) {
    showToast("Cannot Publish", state.templateValidationErrors.join(" "), true);
    return;
  }
  const response = await api(`/api/templates/${state.selectedTemplateId}/publish`, {
    method: "POST",
  });
  showToast("Template Published", response.message || "The template is now live.");
  await loadTemplates(true);
  await loadStats();
}

async function previewCurrentTemplate() {
  if (!state.selectedTemplateId) return;
  await saveDraft({ silent: true });
  const response = await api(`/api/templates/${state.selectedTemplateId}/preview`, {
    method: "POST",
    body: { sample_data: state.previewData },
  });
  document.getElementById("preview-frame").srcdoc = response.html || "";
  document.getElementById("preview-subject").textContent = `Subject: ${response.subject || ""}`;
}

async function sendTestEmail() {
  if (!state.selectedTemplateId) return;
  const email = document.getElementById("test-send-email").value.trim();
  if (!email) {
    showToast("Missing Email", "Enter a recipient email for the test send.", true);
    return;
  }
  await saveDraft({ silent: true });
  const response = await api(`/api/templates/${state.selectedTemplateId}/test-send`, {
    method: "POST",
    body: { test_email: email, sample_data: state.previewData },
  });
  showToast("Test Email Sent", response.message || "Brevo accepted the test send.");
}

async function createTemplateFlow(editorMode) {
  const defaultName = editorMode === "builder" ? "New Builder Template" : "New Code Template";
  const name = window.prompt("Template name", defaultName);
  if (!name) return;
  const response = await api("/api/templates", {
    method: "POST",
    body: { name, editor_mode: editorMode, make_default: false },
  });
  showToast("Template Created", `${name} is ready to edit.`);
  state.selectedTemplateId = response.template.id;
  await loadTemplates(false);
}

async function importHtmlTemplate() {
  const input = document.getElementById("import-html-template-input");
  if (!input.files[0]) {
    showToast("No File Selected", "Choose an HTML file to import.", true);
    return;
  }
  const name = window.prompt("Template name", input.files[0].name.replace(/\.html$/i, ""));
  if (!name) return;
  const formData = new FormData();
  formData.append("file", input.files[0]);
  formData.append("name", name);
  formData.append("make_default", "false");
  const response = await api("/api/templates/import-html", {
    method: "POST",
    body: formData,
  });
  input.value = "";
  state.selectedTemplateId = response.template.id;
  showToast("Template Imported", `${name} was imported in code mode.`);
  await loadTemplates(false);
}

async function duplicateCurrentTemplate() {
  if (!state.selectedTemplateId) return;
  const response = await api(`/api/templates/${state.selectedTemplateId}/duplicate`, {
    method: "POST",
  });
  state.selectedTemplateId = response.template.id;
  showToast("Template Duplicated", `${response.template.name} was created.`);
  await loadTemplates(false);
}

async function archiveCurrentTemplate() {
  if (!state.selectedTemplateId) return;
  const template = state.selectedTemplate;
  const archive = !template.is_archived;
  const response = await api(`/api/templates/${state.selectedTemplateId}/archive`, {
    method: "POST",
    body: { is_archived: archive },
  });
  showToast(archive ? "Template Archived" : "Template Restored", response.template.name);
  await loadTemplates(true);
}

async function setCurrentTemplateDefault() {
  if (!state.selectedTemplateId) return;
  await api(`/api/templates/${state.selectedTemplateId}/default`, { method: "POST" });
  showToast("Default Template Updated", "This template will be preselected for campaigns.");
  await loadSettings();
  await loadTemplates(true);
}

async function deleteCurrentTemplate() {
  if (!state.selectedTemplateId) return;
  if (!window.confirm("Delete this template? This cannot be undone.")) return;
  await api(`/api/templates/${state.selectedTemplateId}`, { method: "DELETE" });
  showToast("Template Deleted", "The template was removed.");
  state.selectedTemplateId = null;
  await loadTemplates(false);
}

function renameCurrentTemplate() {
  if (!state.selectedTemplate) return;
  const name = window.prompt("Rename template", state.selectedTemplate.name);
  if (!name) return;
  state.selectedTemplate.name = name.trim() || state.selectedTemplate.name;
  saveDraft({ silent: false }).catch((error) => {
    showToast("Rename Failed", error.message, true);
  });
}

async function loadAssets() {
  const data = await api("/api/template-assets");
  state.assets = data.assets || [];
  renderAssetPanel(data.enabled, data.base_url);
}

function renderAssetPanel(enabled, baseUrl) {
  const message = document.getElementById("asset-support-message");
  const uploadBtn = document.getElementById("asset-upload-btn");
  uploadBtn.disabled = !enabled;
  uploadBtn.classList.toggle("opacity-50", !enabled);
  message.textContent = enabled
    ? `Assets are publicly available from ${baseUrl || "your configured PUBLIC_BASE_URL"}.`
    : "Set PUBLIC_BASE_URL to enable local asset uploads. External image URLs still work.";

  const container = document.getElementById("asset-list");
  if (!state.assets.length) {
    container.innerHTML =
      '<div class="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500">No uploaded assets yet.</div>';
    return;
  }
  container.innerHTML = state.assets
    .map(
      (asset) => `
        <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div class="flex items-center justify-between gap-4">
            <div>
              <div class="text-sm font-medium text-white">${escapeHtml(asset.filename)}</div>
              <div class="mt-1 text-xs text-slate-500">${Math.round(asset.size / 1024)} KB</div>
            </div>
            <button data-copy-asset="${escapeHtml(asset.url)}" class="rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-100">Copy URL</button>
          </div>
        </div>
      `,
    )
    .join("");
  container.querySelectorAll("[data-copy-asset]").forEach((button) => {
    button.addEventListener("click", async () => {
      await navigator.clipboard.writeText(button.dataset.copyAsset);
      showToast("Copied", "Asset URL copied to clipboard.");
    });
  });
}

async function uploadAsset() {
  const input = document.getElementById("asset-upload-input");
  if (!input.files[0]) {
    showToast("No File Selected", "Choose an image file to upload.", true);
    return;
  }
  const formData = new FormData();
  formData.append("file", input.files[0]);
  const response = await api("/api/template-assets/upload", {
    method: "POST",
    body: formData,
  });
  input.value = "";
  showToast("Asset Uploaded", response.asset.filename);
  await loadAssets();
}

function renderImportMapping() {
  const container = document.getElementById("mapping-grid");
  const importSession = state.importSession;
  if (!importSession) {
    container.innerHTML =
      '<div class="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500">Upload a file to configure mappings.</div>';
    return;
  }
  const fields = importSession.mappable_fields || [];
  const columns = importSession.detected_columns || [];
  container.innerHTML = fields
    .map((field) => {
      const selected = (importSession.mapping || {})[field.key] || "";
      return `
        <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-white">${escapeHtml(field.label || field.key)}</div>
              <div class="mt-1 text-xs text-slate-500">${field.required ? "Required for validation" : field.description || "Optional field"}</div>
            </div>
            ${field.required ? '<span class="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200">Required</span>' : ""}
          </div>
          <select data-import-field="${field.key}" class="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-sky-400">
            <option value="">${field.required ? "Choose a column" : "Leave unmapped"}</option>
            ${columns
              .map(
                (column) =>
                  `<option value="${escapeHtml(column)}" ${selected === column ? "selected" : ""}>${escapeHtml(column)}</option>`,
              )
              .join("")}
          </select>
        </div>
      `;
    })
    .join("");
}

function renderImportSummary() {
  const summaryPanel = document.getElementById("import-summary-panel");
  const errorsPanel = document.getElementById("import-errors-panel");
  const previewGrid = document.getElementById("sample-preview-grid");
  const sheetSelect = document.getElementById("import-sheet-select");
  const validateButton = document.getElementById("validate-import-btn");
  const stageButton = document.getElementById("stage-import-btn");
  const launchButton = document.getElementById("launch-batch-btn");

  if (!state.importSession) {
    sheetSelect.innerHTML = '<option value="">No upload session</option>';
    summaryPanel.innerHTML = "";
    errorsPanel.textContent =
      "Upload a file and run validation to review row-level issues.";
    previewGrid.innerHTML = "";
    validateButton.disabled = true;
    stageButton.disabled = true;
    launchButton.disabled = true;
    return;
  }

  sheetSelect.innerHTML = (state.importSession.sheet_names || [])
    .map(
      (sheetName) =>
        `<option value="${escapeHtml(sheetName)}" ${state.importSession.selected_sheet === sheetName ? "selected" : ""}>${escapeHtml(sheetName)}</option>`,
    )
    .join("");

  validateButton.disabled = false;
  stageButton.disabled = !state.importValidation;
  launchButton.disabled = !state.stagedBatch;
  if (state.stagedBatch && state.stagedBatch.status !== "staged") {
    launchButton.disabled = true;
  }

  if (!state.importValidation) {
    summaryPanel.innerHTML =
      '<div class="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-slate-500 md:col-span-2">Validation has not been run yet.</div>';
    const warnings = state.importSession.warnings || [];
    errorsPanel.innerHTML = warnings.length
      ? warnings.map((warning) => `<div class="mb-2">${escapeHtml(warning)}</div>`).join("")
      : "Validation warnings and row-level errors will appear here.";
    previewGrid.innerHTML = "";
    return;
  }

  const counts = state.importValidation.summary_counts || {};
  summaryPanel.innerHTML = [
    ["Valid rows", counts.valid_rows || 0],
    ["Invalid rows", counts.invalid_rows || 0],
    ["Creates", counts.created || 0],
    ["Updates", counts.updated || 0],
  ]
    .map(
      ([label, value]) => `
        <div class="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div class="text-xs uppercase tracking-[0.18em] text-slate-500">${label}</div>
          <div class="mt-2 text-2xl font-semibold text-white">${value}</div>
        </div>
      `,
    )
    .join("");

  const errorPreview = state.importValidation.row_errors_preview || [];
  const errorReportButton = state.importValidation.error_report_available
    ? '<button id="download-error-report-btn" class="mt-4 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100 transition hover:bg-white/[0.10]">Download Error Report</button>'
    : "";
  errorsPanel.innerHTML = errorPreview.length
    ? `
      <div class="space-y-2">
        ${errorPreview
          .map(
            (row) => `
              <div class="rounded-2xl border border-white/10 bg-black/20 p-3">
                <div class="text-sm font-medium text-white">Row ${row.row_number} · ${escapeHtml(row.email || "No email")}</div>
                <div class="mt-1 text-sm text-rose-200">${escapeHtml(row.error)}</div>
                ${row.details ? `<div class="mt-1 text-xs text-slate-500">${escapeHtml(row.details)}</div>` : ""}
              </div>
            `,
          )
          .join("")}
        ${errorReportButton}
      </div>
    `
    : '<div class="text-sm text-emerald-200">No row-level errors were found during validation.</div>';

  previewGrid.innerHTML = (state.importValidation.sample_previews || [])
    .map(
      (preview) => `
        <div class="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
          <div class="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">${escapeHtml(preview.email || "Sample preview")}</div>
          <iframe sandbox="" class="h-[360px] w-full rounded-[20px] border border-white/10 bg-white" srcdoc="${escapeHtml(preview.html || "")}"></iframe>
        </div>
      `,
    )
    .join("");

  document.getElementById("download-error-report-btn")?.addEventListener("click", downloadImportErrorReport);
}

function collectImportMappingFromUi() {
  const mapping = {};
  document.querySelectorAll("[data-import-field]").forEach((select) => {
    if (select.value) {
      mapping[select.dataset.importField] = select.value;
    }
  });
  return {
    mapping,
    selected_sheet: document.getElementById("import-sheet-select").value || null,
  };
}

async function handleImportFile(file) {
  const templateId = Number(document.getElementById("campaign-template-select").value || 0);
  if (!templateId) {
    showToast("Template Required", "Select a published template before uploading.", true);
    return;
  }
  const formData = new FormData();
  formData.append("template_id", String(templateId));
  formData.append("file", file);
  document.getElementById("campaign-upload-status").textContent = `Analyzing ${file.name}...`;
  const response = await api("/api/imports/analyze", {
    method: "POST",
    body: formData,
  });
  state.importSession = response.import_session;
  state.importValidation = null;
  state.stagedBatch = null;
  document.getElementById("campaign-upload-status").textContent = `${file.name} analyzed.`;
  renderImportMapping();
  renderImportSummary();
}

async function validateCurrentImport() {
  if (!state.importSession?.id) {
    showToast("No Import Session", "Upload a file first.", true);
    return;
  }
  const mappingPayload = collectImportMappingFromUi();
  state.importSession = (
    await api(`/api/imports/${state.importSession.id}/mapping`, {
      method: "POST",
      body: mappingPayload,
    })
  ).import_session;
  const response = await api(`/api/imports/${state.importSession.id}/validate`, {
    method: "POST",
  });
  state.importValidation = response.validation;
  state.importSession = response.validation;
  renderImportSummary();
  showToast("Validation Complete", "The import file was checked against the selected template.");
}

async function stageCurrentImport() {
  if (!state.importSession?.id || !state.importValidation) {
    showToast("Validate First", "Run validation before staging a batch.", true);
    return;
  }
  const response = await api(`/api/imports/${state.importSession.id}/stage`, {
    method: "POST",
  });
  state.stagedBatch = response.batch;
  showToast("Batch Staged", `${response.batch.name} is ready to launch.`);
  await loadBatches();
  await loadStats();
  renderImportSummary();
}

async function launchCurrentBatch() {
  if (!state.stagedBatch?.id) {
    showToast("No Staged Batch", "Stage a batch before launching.", true);
    return;
  }
  const response = await api(`/api/batches/${state.stagedBatch.id}/launch`, {
    method: "POST",
  });
  state.stagedBatch = response.batch;
  showToast("Batch Launched", `${response.batch.name} has been queued.`);
  await Promise.all([loadBatches(), loadStats(), loadActivity()]);
  renderImportSummary();
}

async function downloadImportErrorReport() {
  const response = await fetch(`/api/imports/${state.importSession.id}/error-report`, {
    headers: authHeaders,
  });
  if (!response.ok) {
    showToast("Download Failed", "The error report could not be downloaded.", true);
    return;
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `import-errors-${state.importSession.id}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

async function loadBatches() {
  const data = await api("/api/batches");
  state.batches = data.batches || [];
  const tbody = document.getElementById("batches-table-body");
  if (!state.batches.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-5 py-6 text-center text-slate-500">No campaign batches yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.batches
    .map(
      (batch) => `
        <tr>
          <td class="px-5 py-4">
            <div class="font-medium text-white">${escapeHtml(batch.name)}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(batch.source_filename || "Manual stage")}</div>
          </td>
          <td class="px-5 py-4">${statusBadge(batch.status)}</td>
          <td class="px-5 py-4 text-slate-300">${escapeHtml(batch.template_name || "Template")}</td>
          <td class="px-5 py-4 text-slate-400">
            <div>Queued ${batch.queued || 0}</div>
            <div>Sent ${batch.sent || 0} · Failed ${batch.failed || 0}</div>
          </td>
          <td class="px-5 py-4 text-right">
            ${
              batch.status === "staged"
                ? `<button data-launch-batch="${batch.id}" class="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-950">Launch</button>`
                : ""
            }
          </td>
        </tr>
      `,
    )
    .join("");
  tbody.querySelectorAll("[data-launch-batch]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/batches/${button.dataset.launchBatch}/launch`, { method: "POST" });
      showToast("Batch Launched", "The staged batch is now queued.");
      await Promise.all([loadBatches(), loadStats(), loadActivity()]);
    });
  });
}

async function loadActivity() {
  const filter = document.getElementById("activity-filter").value;
  const query = filter ? `?status=${encodeURIComponent(filter)}` : "";
  const data = await api(`/api/activity${query}`);
  state.activity = data.rows || [];
  const tbody = document.getElementById("activity-table-body");
  if (!state.activity.length) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="px-5 py-6 text-center text-slate-500">No activity yet.</td></tr>';
    return;
  }
  tbody.innerHTML = state.activity
    .map(
      (row) => `
        <tr>
          <td class="px-5 py-4">
            <div class="font-medium text-white">${escapeHtml(row.email)}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(row.name || "There")}</div>
          </td>
          <td class="px-5 py-4">${statusBadge(row.status)}</td>
          <td class="px-5 py-4 text-slate-300">${escapeHtml(row.batch_name || "—")}</td>
          <td class="px-5 py-4 text-slate-400">${escapeHtml(row.template_subject || "—")}</td>
          <td class="px-5 py-4 text-slate-500">${formatDate(row.updated_at)}</td>
          <td class="px-5 py-4 text-right">
            ${
              ["sent", "failed"].includes(row.status)
                ? `<button data-resend-recipient="${row.id}" class="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100">Resend</button>`
                : ""
            }
          </td>
        </tr>
      `,
    )
    .join("");
  tbody.querySelectorAll("[data-resend-recipient]").forEach((button) => {
    button.addEventListener("click", () => resendRecipient(button.dataset.resendRecipient));
  });
}

async function resendRecipient(recipientId) {
  await api(`/api/recipients/${recipientId}/resend`, { method: "POST" });
  showToast("Recipient Requeued", "The recipient was queued from the original version snapshot.");
  await Promise.all([loadActivity(), loadStats(), loadBatches()]);
}

async function loadContacts() {
  const search = document.getElementById("contact-search").value.trim();
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  const data = await api(`/api/contacts${query}`);
  state.contacts = data.contacts || [];
  const tbody = document.getElementById("contacts-table-body");
  if (!state.contacts.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="px-5 py-6 text-center text-slate-500">No contacts found.</td></tr>';
    return;
  }
  tbody.innerHTML = state.contacts
    .map(
      (contact) => `
        <tr>
          <td class="px-5 py-4">
            <div class="font-medium text-white">${escapeHtml(contact.name || "There")}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(contact.email)}</div>
          </td>
          <td class="px-5 py-4">
            ${contact.unsubscribed ? statusBadge("unsubscribed") : statusBadge("subscribed")}
          </td>
          <td class="px-5 py-4 text-slate-400">${Object.keys(contact.custom_fields_json || {}).length} fields</td>
          <td class="px-5 py-4 text-slate-400">
            <div>${escapeHtml(contact.last_delivery_status || "—")}</div>
            <div class="mt-1 text-xs text-slate-500">${escapeHtml(contact.last_delivery_error || "")}</div>
          </td>
          <td class="px-5 py-4 text-right">
            <div class="flex justify-end gap-2">
              <button data-edit-contact="${contact.id}" class="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-100">Edit</button>
              <button data-delete-contact="${contact.id}" class="rounded-full border border-rose-400/20 bg-rose-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-rose-200">Delete</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join("");
  tbody.querySelectorAll("[data-edit-contact]").forEach((button) => {
    button.addEventListener("click", () => openContactModal(Number(button.dataset.editContact)));
  });
  tbody.querySelectorAll("[data-delete-contact]").forEach((button) => {
    button.addEventListener("click", () => deleteContact(Number(button.dataset.deleteContact)));
  });
}

function openContactModal(contactId) {
  const contact = state.contacts.find((item) => item.id === contactId);
  if (!contact) return;
  document.getElementById("contact-form-id").value = contact.id;
  document.getElementById("contact-form-name").value = contact.name || "";
  document.getElementById("contact-form-email").value = contact.email || "";
  document.getElementById("contact-form-custom-fields").value = JSON.stringify(
    contact.custom_fields_json || {},
    null,
    2,
  );
  document.getElementById("contact-form-unsubscribed").checked = Boolean(contact.unsubscribed);
  document.getElementById("contact-modal").classList.remove("hidden");
  document.getElementById("contact-modal").classList.add("flex");
}

function closeContactModal() {
  document.getElementById("contact-modal").classList.add("hidden");
  document.getElementById("contact-modal").classList.remove("flex");
}

async function saveContactFromModal(event) {
  event.preventDefault();
  const id = Number(document.getElementById("contact-form-id").value);
  const payload = {
    name: document.getElementById("contact-form-name").value.trim(),
    email: document.getElementById("contact-form-email").value.trim(),
    unsubscribed: document.getElementById("contact-form-unsubscribed").checked,
  };
  try {
    payload.custom_fields_json = JSON.parse(
      document.getElementById("contact-form-custom-fields").value || "{}",
    );
  } catch (error) {
    showToast("Invalid JSON", "Custom fields must be valid JSON.", true);
    return;
  }
  await api(`/api/contacts/${id}`, { method: "PUT", body: payload });
  closeContactModal();
  showToast("Contact Saved", "The contact record was updated.");
  await loadContacts();
}

async function deleteContact(contactId) {
  if (!window.confirm("Delete this contact?")) return;
  await api(`/api/contacts/${contactId}`, { method: "DELETE" });
  showToast("Contact Deleted", "The contact was removed.");
  await Promise.all([loadContacts(), loadStats()]);
}

async function deleteAllContacts() {
  if (!window.confirm("Delete all contacts? This cannot be undone.")) return;
  const response = await api("/api/contacts", { method: "DELETE" });
  showToast("Contacts Deleted", response.message);
  await Promise.all([loadContacts(), loadStats()]);
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    brevo_api_key: form.elements.brevo_api_key.value.trim(),
    sender_email: form.elements.sender_email.value.trim(),
    sender_name: form.elements.sender_name.value.trim(),
    hourly_limit: Number(form.elements.hourly_limit.value || 20),
    daily_limit: Number(form.elements.daily_limit.value || 300),
    default_template_id: Number(form.elements.default_template_id.value || 0) || null,
  };
  await api("/api/settings", { method: "POST", body: payload });
  showToast("Settings Saved", "Sender settings were updated.");
  await Promise.all([loadSettings(), loadStats(), loadTemplates(true)]);
}

async function bootstrap() {
  try {
    await Promise.all([loadSettings(), loadStats()]);
    await loadTemplates(false);
    await Promise.all([loadBatches(), loadActivity(), loadContacts()]);
    renderImportMapping();
    renderImportSummary();
    switchView("dashboard");
    await previewCurrentTemplate();
  } catch (error) {
    console.error(error);
    showToast("Initialization Failed", error.message || "Could not load dashboard.", true);
  }
}

function attachEvents() {
  document.getElementById("sign-out-btn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/login";
  });

  document.querySelectorAll("[data-view-trigger]").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.viewTrigger));
  });

  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("campaign-template-select").addEventListener("change", updateCampaignTemplateHint);

  document.getElementById("campaign-upload-trigger").addEventListener("click", () => {
    document.getElementById("campaign-file-input").click();
  });
  document.getElementById("campaign-file-input").addEventListener("change", (event) => {
    if (event.target.files[0]) {
      handleImportFile(event.target.files[0]).catch((error) => {
        showToast("Import Analyze Failed", error.message, true);
      });
    }
  });
  const dropzone = document.getElementById("campaign-dropzone");
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("border-sky-400/50");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("border-sky-400/50");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("border-sky-400/50");
    if (event.dataTransfer.files[0]) {
      handleImportFile(event.dataTransfer.files[0]).catch((error) => {
        showToast("Import Analyze Failed", error.message, true);
      });
    }
  });
  document.getElementById("validate-import-btn").addEventListener("click", () => {
    validateCurrentImport().catch((error) => showToast("Validation Failed", error.message, true));
  });
  document.getElementById("stage-import-btn").addEventListener("click", () => {
    stageCurrentImport().catch((error) => showToast("Staging Failed", error.message, true));
  });
  document.getElementById("launch-batch-btn").addEventListener("click", () => {
    launchCurrentBatch().catch((error) => showToast("Launch Failed", error.message, true));
  });

  document.getElementById("refresh-batches-btn").addEventListener("click", () => {
    loadBatches().catch((error) => showToast("Refresh Failed", error.message, true));
  });
  document.getElementById("refresh-activity-btn").addEventListener("click", () => {
    loadActivity().catch((error) => showToast("Refresh Failed", error.message, true));
  });
  document.getElementById("activity-filter").addEventListener("change", () => {
    loadActivity().catch((error) => showToast("Refresh Failed", error.message, true));
  });

  document.getElementById("new-builder-template-btn").addEventListener("click", () => {
    createTemplateFlow("builder").catch((error) => showToast("Create Failed", error.message, true));
  });
  document.getElementById("new-code-template-btn").addEventListener("click", () => {
    createTemplateFlow("code").catch((error) => showToast("Create Failed", error.message, true));
  });
  document.getElementById("import-html-template-btn").addEventListener("click", () => {
    importHtmlTemplate().catch((error) => showToast("Import Failed", error.message, true));
  });
  document.getElementById("refresh-templates-btn").addEventListener("click", () => {
    loadTemplates(true).catch((error) => showToast("Refresh Failed", error.message, true));
  });
  document.getElementById("duplicate-template-btn").addEventListener("click", () => {
    duplicateCurrentTemplate().catch((error) => showToast("Duplicate Failed", error.message, true));
  });
  document.getElementById("rename-template-btn").addEventListener("click", renameCurrentTemplate);
  document.getElementById("archive-template-btn").addEventListener("click", () => {
    archiveCurrentTemplate().catch((error) => showToast("Archive Failed", error.message, true));
  });
  document.getElementById("set-default-template-btn").addEventListener("click", () => {
    setCurrentTemplateDefault().catch((error) => showToast("Update Failed", error.message, true));
  });
  document.getElementById("delete-template-btn").addEventListener("click", () => {
    deleteCurrentTemplate().catch((error) => showToast("Delete Failed", error.message, true));
  });
  document.getElementById("save-draft-btn").addEventListener("click", () => {
    saveDraft().catch((error) => showToast("Save Failed", error.message, true));
  });
  document.getElementById("publish-template-btn").addEventListener("click", () => {
    publishCurrentTemplate().catch((error) => showToast("Publish Failed", error.message, true));
  });
  document.getElementById("template-editor-title").addEventListener("dblclick", renameCurrentTemplate);
  document.querySelectorAll(".template-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTemplateTab = button.dataset.templateTab;
      if (state.activeTemplateTab === "design") state.templateEditorMode = "builder";
      if (state.activeTemplateTab === "code") state.templateEditorMode = "code";
      renderTemplateTabs();
    });
  });
  document.querySelectorAll("[data-add-block]").forEach((button) => {
    button.addEventListener("click", () => addBlock(button.dataset.addBlock));
  });
  document.getElementById("use-sample-values-btn").addEventListener("click", () => {
    buildPreviewDataFromSchema(true);
    renderPreviewSampleFields();
  });
  document.getElementById("refresh-preview-btn").addEventListener("click", () => {
    previewCurrentTemplate().catch((error) => showToast("Preview Failed", error.message, true));
  });
  document.querySelectorAll(".preview-width-btn").forEach((button) => {
    button.addEventListener("click", () => {
      state.previewWidth = button.dataset.previewWidth;
      document.getElementById("preview-frame-shell").style.maxWidth = state.previewWidth;
      document.querySelectorAll(".preview-width-btn").forEach((candidate) => {
        const active = candidate.dataset.previewWidth === state.previewWidth;
        candidate.className = active
          ? "preview-width-btn rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
          : "preview-width-btn rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm font-medium text-slate-100";
      });
    });
  });
  document.getElementById("add-schema-field-btn").addEventListener("click", () => {
    currentSchema().push({
      key: `custom_field_${currentSchema().filter((field) => !field.builtin).length + 1}`,
      label: "Custom Field",
      required: true,
      default_value: "",
      sample_value: "",
      description: "",
      builtin: false,
    });
    renderTemplateEditor();
  });
  document.getElementById("send-test-email-btn").addEventListener("click", () => {
    sendTestEmail().catch((error) => showToast("Test Send Failed", error.message, true));
  });
  document.getElementById("asset-upload-btn").addEventListener("click", () => {
    uploadAsset().catch((error) => showToast("Upload Failed", error.message, true));
  });

  document.getElementById("refresh-contacts-btn").addEventListener("click", () => {
    loadContacts().catch((error) => showToast("Refresh Failed", error.message, true));
  });
  document.getElementById("delete-all-contacts-btn").addEventListener("click", () => {
    deleteAllContacts().catch((error) => showToast("Delete Failed", error.message, true));
  });
  document.getElementById("contact-search").addEventListener("input", () => {
    clearTimeout(state.contactSearchTimeout);
    state.contactSearchTimeout = setTimeout(() => {
      loadContacts().catch((error) => showToast("Search Failed", error.message, true));
    }, 250);
  });
  document.getElementById("close-contact-modal-btn").addEventListener("click", closeContactModal);
  document.getElementById("contact-form").addEventListener("submit", saveContactFromModal);
}

attachEvents();
bootstrap();
