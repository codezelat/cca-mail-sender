export type SessionUser = {
  id: number;
  email: string;
};

export type TemplateField = {
  key: string;
  label: string;
  required: boolean;
  default_value: string;
  sample_value: string;
  description: string;
  builtin?: boolean;
};

export type TemplateVersion = {
  id: number;
  version_number: number;
  status: string;
  editor_mode: string;
  subject: string;
  preheader: string;
  design_json: Record<string, unknown>;
  html_source: string;
  compiled_html: string;
  merge_fields_schema: TemplateField[];
  thumbnail?: string | null;
  published_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type TemplateSummary = {
  id: number;
  name: string;
  slug: string;
  editor_mode: string;
  is_default: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  draft_version?: TemplateVersion | null;
  published_version?: TemplateVersion | null;
  versions?: TemplateVersion[];
};

export type ImportAnalysis = {
  id: number;
  template_version_id: number;
  original_filename: string;
  selected_sheet?: string | null;
  status: string;
  sheet_names: string[];
  detected_columns: string[];
  mapping: Record<string, string>;
  required_fields: TemplateField[];
  mappable_fields: TemplateField[];
  warnings: string[];
  duplicate_headers: string[];
  sample_rows: Record<string, string>[];
  summary_counts: Record<string, number>;
  sample_previews: Array<{ email?: string; html: string }>;
  row_errors_preview?: Array<{ row_number: number; error: string; email?: string; details?: string }>;
  error_report_available: boolean;
};

export type BatchSummary = {
  id: number;
  name: string;
  status: string;
  template_version_id: number;
  template_name: string;
  subject: string;
  source_filename?: string | null;
  created: number;
  updated: number;
  invalid: number;
  queued: number;
  processing: number;
  sent: number;
  failed: number;
  unsubscribed: number;
  launched_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type RecipientActivityItem = {
  id: number;
  email: string;
  name: string;
  status: string;
  error_message?: string | null;
  message_id?: string | null;
  updated_at: string;
  created_at: string;
  batch_name?: string;
  template_subject?: string;
};

export type ContactRecord = {
  id: number;
  name: string;
  email: string;
  custom_fields_json: Record<string, unknown>;
  unsubscribed: boolean;
  last_delivery_status?: string | null;
  last_delivery_error?: string | null;
  updated_at: string;
  created_at: string;
};

export type SettingsRecord = {
  provider: "brevo" | "kit";
  provider_api_key?: string;
  sender_email?: string;
  sender_name?: string;
  use_env_provider_api_key: boolean;
  use_env_sender_identity: boolean;
  clear_manual_provider_api_key?: boolean;
  has_manual_provider_api_key: boolean;
  env_has_provider_api_key: boolean;
  env_has_sender_identity: boolean;
  effective_provider_api_key_configured: boolean;
  effective_sender_email?: string;
  effective_sender_name?: string;
  hourly_limit: number;
  daily_limit: number;
  default_template_id?: number | null;
};
