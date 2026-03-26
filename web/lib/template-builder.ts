export const BUILDER_BLOCK_DEFAULTS: Record<string, Record<string, unknown>> = {
  section: {
    type: "section",
    heading: "Section title",
    body: "Write a concise message here.",
    background_color: "#ffffff",
    text_color: "#111827",
    padding: 32,
    align: "left"
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
    gap: 16
  },
  text: {
    type: "text",
    text: "Text block",
    color: "#334155",
    font_size: 16,
    padding: 16,
    align: "left"
  },
  image: {
    type: "image",
    src: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=1200",
    alt: "Image",
    href: "",
    width: 520,
    padding: 16,
    align: "center",
    background_color: "#ffffff"
  },
  button: {
    type: "button",
    text: "Call to Action",
    url: "https://example.com",
    align: "left",
    background_color: "#111827",
    text_color: "#ffffff",
    padding: 0
  },
  spacer: {
    type: "spacer",
    height: 24
  },
  divider: {
    type: "divider",
    color: "#e5e7eb",
    padding: 24
  },
  social_footer: {
    type: "social_footer",
    heading: "Stay connected",
    footer_text: "Manage your preferences anytime.",
    text_color: "#64748b",
    padding: 24,
    links: [{ label: "Website", url: "https://example.com" }]
  },
  raw_html: {
    type: "raw_html",
    html: "<div>Custom HTML block</div>"
  }
};

export const BLOCK_FIELD_CONFIG: Record<
  string,
  Array<{ key: string; label: string; type: string; options?: string[] }>
> = {
  section: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "body", label: "Body", type: "textarea" },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text Color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "align", label: "Alignment", type: "select", options: ["left", "center", "right"] }
  ],
  columns: [
    { key: "left_heading", label: "Left Heading", type: "text" },
    { key: "left_text", label: "Left Text", type: "textarea" },
    { key: "right_heading", label: "Right Heading", type: "text" },
    { key: "right_text", label: "Right Text", type: "textarea" },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text Color", type: "color" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "gap", label: "Gap", type: "number" }
  ],
  text: [
    { key: "text", label: "Text", type: "textarea" },
    { key: "color", label: "Text Color", type: "color" },
    { key: "font_size", label: "Font Size", type: "number" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "align", label: "Alignment", type: "select", options: ["left", "center", "right"] }
  ],
  image: [
    { key: "src", label: "Image URL", type: "text" },
    { key: "alt", label: "Alt Text", type: "text" },
    { key: "href", label: "Link URL", type: "text" },
    { key: "width", label: "Max Width", type: "number" },
    { key: "padding", label: "Padding", type: "number" },
    { key: "align", label: "Alignment", type: "select", options: ["left", "center", "right"] }
  ],
  button: [
    { key: "text", label: "Label", type: "text" },
    { key: "url", label: "Target URL", type: "text" },
    { key: "align", label: "Alignment", type: "select", options: ["left", "center", "right"] },
    { key: "background_color", label: "Background", type: "color" },
    { key: "text_color", label: "Text Color", type: "color" }
  ],
  spacer: [{ key: "height", label: "Height", type: "number" }],
  divider: [
    { key: "color", label: "Color", type: "color" },
    { key: "padding", label: "Padding", type: "number" }
  ],
  social_footer: [
    { key: "heading", label: "Heading", type: "text" },
    { key: "footer_text", label: "Footer Text", type: "textarea" },
    { key: "text_color", label: "Text Color", type: "color" },
    { key: "links", label: "Links JSON", type: "json" }
  ],
  raw_html: [{ key: "html", label: "HTML", type: "textarea" }]
};

export function createBuilderBlock(type: string): Record<string, unknown> {
  return {
    id: `block-${Math.random().toString(36).slice(2, 10)}`,
    visibility_field: "",
    visibility_mode: "present",
    ...(BUILDER_BLOCK_DEFAULTS[type] || BUILDER_BLOCK_DEFAULTS.text)
  };
}
