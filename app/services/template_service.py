import copy
import html
import os
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import quote

from jose import JWTError, jwt
from jinja2 import Environment
from sqlmodel import Session, select

from app.auth import ALGORITHM, SECRET_KEY
from app.models import (
    CampaignBatch,
    Contact,
    EmailTemplate,
    EmailTemplateVersion,
    User,
    UserSettings,
)

TOKEN_RE = re.compile(r"\{\{\s*(.*?)\s*\}\}")
FIELD_KEY_RE = re.compile(r"^[a-z_][a-z0-9_]*$")

DEFAULT_TEMPLATE_NAME = "CCA Default"
DEFAULT_TEMPLATE_SUBJECT = "Campaign Update"
DEFAULT_TEMPLATE_PREHEADER = "A quick update from CCA."
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")

BUILTIN_FIELDS: List[Dict[str, Any]] = [
    {
        "key": "email",
        "label": "Email",
        "required": False,
        "default_value": "",
        "sample_value": "alex@example.com",
        "description": "Recipient email address.",
        "builtin": True,
    },
    {
        "key": "name",
        "label": "Name",
        "required": False,
        "default_value": "There",
        "sample_value": "Alex Johnson",
        "description": "Full recipient name.",
        "builtin": True,
    },
    {
        "key": "first_name",
        "label": "First Name",
        "required": False,
        "default_value": "Alex",
        "sample_value": "Alex",
        "description": "Derived from the name field when available.",
        "builtin": True,
    },
    {
        "key": "last_name",
        "label": "Last Name",
        "required": False,
        "default_value": "",
        "sample_value": "Johnson",
        "description": "Derived from the name field when available.",
        "builtin": True,
    },
    {
        "key": "unsubscribe_url",
        "label": "Unsubscribe URL",
        "required": False,
        "default_value": "",
        "sample_value": f"{PUBLIC_BASE_URL}/unsubscribe?token=sample",
        "description": "System generated unsubscribe URL.",
        "builtin": True,
    },
]
BUILTIN_FIELD_KEYS = {field["key"] for field in BUILTIN_FIELDS}
FIELD_ALIASES = {
    "unsubscribe": "unsubscribe_url",
    "unsubscribe_link": "unsubscribe_url",
    "firstname": "first_name",
    "lastname": "last_name",
}


def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", (value or "").strip().lower())
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or f"template-{uuid.uuid4().hex[:8]}"


def normalize_field_key(key: str) -> str:
    key = (key or "").strip().lower()
    key = FIELD_ALIASES.get(key, key)
    key = re.sub(r"[^a-z0-9_]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    return key


def normalize_template_source(source: Optional[str]) -> str:
    source = source or ""
    source = source.replace("{{ unsubscribe }}", "{{ unsubscribe_url }}")
    source = source.replace("{{unsubscribe}}", "{{ unsubscribe_url }}")
    return source


def parse_token_expression(raw_expr: str) -> Optional[str]:
    expr = (raw_expr or "").strip()
    if not expr:
        return None
    expr = expr.split("|", 1)[0].strip()
    expr = expr.split(".", 1)[-1].strip()
    key = normalize_field_key(expr)
    if not key:
        return None
    return FIELD_ALIASES.get(key, key)


def extract_merge_fields(source: str) -> List[str]:
    fields: List[str] = []
    for raw_expr in TOKEN_RE.findall(normalize_template_source(source)):
        key = parse_token_expression(raw_expr)
        if key and key not in fields:
            fields.append(key)
    return fields


def build_default_builder_design() -> Dict[str, Any]:
    return {
        "body_background_color": "#030712",
        "content_background_color": "#ffffff",
        "content_width": 600,
        "blocks": [
            {
                "id": uuid.uuid4().hex,
                "type": "section",
                "heading": "A polished update from your team",
                "body": "Hi {{ name }},\n\nShare your announcement, offer, or launch message here.",
                "background_color": "#ffffff",
                "text_color": "#0f172a",
                "padding": 32,
                "align": "left",
            },
            {
                "id": uuid.uuid4().hex,
                "type": "button",
                "text": "Open the Update",
                "url": "https://example.com",
                "align": "left",
                "background_color": "#111827",
                "text_color": "#ffffff",
                "padding": 0,
            },
            {
                "id": uuid.uuid4().hex,
                "type": "divider",
                "color": "#e5e7eb",
                "padding": 24,
            },
            {
                "id": uuid.uuid4().hex,
                "type": "social_footer",
                "heading": "Stay connected",
                "footer_text": "You received this email because you were added to our campaign list.",
                "text_color": "#64748b",
                "padding": 24,
                "links": [
                    {"label": "Website", "url": "https://example.com"},
                    {"label": "LinkedIn", "url": "https://linkedin.com"},
                ],
            },
        ],
    }


def builder_block_factory(block_type: str) -> Dict[str, Any]:
    base = {"id": uuid.uuid4().hex, "type": block_type}
    block_defaults = {
        "section": {
            "heading": "Section title",
            "body": "Write a concise message here.",
            "background_color": "#ffffff",
            "text_color": "#111827",
            "padding": 32,
            "align": "left",
        },
        "columns": {
            "left_heading": "Left column",
            "left_text": "Add supporting copy here.",
            "right_heading": "Right column",
            "right_text": "Add complementary content here.",
            "background_color": "#ffffff",
            "text_color": "#111827",
            "padding": 24,
            "gap": 16,
        },
        "text": {
            "text": "Text block",
            "color": "#334155",
            "font_size": 16,
            "padding": 16,
            "align": "left",
        },
        "image": {
            "src": "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=1200",
            "alt": "Image",
            "href": "",
            "width": 520,
            "padding": 16,
            "align": "center",
            "background_color": "#ffffff",
        },
        "button": {
            "text": "Call to Action",
            "url": "https://example.com",
            "align": "left",
            "background_color": "#111827",
            "text_color": "#ffffff",
            "padding": 0,
        },
        "spacer": {"height": 24},
        "divider": {"color": "#e5e7eb", "padding": 24},
        "social_footer": {
            "heading": "Stay connected",
            "footer_text": "Manage your preferences anytime.",
            "text_color": "#64748b",
            "padding": 24,
            "links": [{"label": "Website", "url": "https://example.com"}],
        },
        "raw_html": {"html": "<div>Custom HTML block</div>"},
    }
    base.update(block_defaults.get(block_type, {}))
    return base


def ensure_schema(schema: Optional[Iterable[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    normalized_custom: List[Dict[str, Any]] = []
    seen_keys = set()

    for item in schema or []:
        key = normalize_field_key(str(item.get("key", "")))
        if not key or key in BUILTIN_FIELD_KEYS or key in seen_keys:
            continue
        seen_keys.add(key)
        normalized_custom.append(
            {
                "key": key,
                "label": str(item.get("label") or key.replace("_", " ").title()),
                "required": bool(item.get("required", True)),
                "default_value": str(item.get("default_value") or ""),
                "sample_value": str(item.get("sample_value") or ""),
                "description": str(item.get("description") or ""),
                "builtin": False,
            }
        )

    return [copy.deepcopy(field) for field in BUILTIN_FIELDS] + normalized_custom


def schema_from_source(source: str) -> List[Dict[str, Any]]:
    custom_fields = []
    for field in extract_merge_fields(source):
        if field in BUILTIN_FIELD_KEYS:
            continue
        custom_fields.append(
            {
                "key": field,
                "label": field.replace("_", " ").title(),
                "required": True,
                "default_value": "",
                "sample_value": "",
                "description": "Imported from template HTML.",
                "builtin": False,
            }
        )
    return ensure_schema(custom_fields)


def validate_schema(schema: Optional[Iterable[Dict[str, Any]]]) -> List[str]:
    errors: List[str] = []
    seen_keys = set()
    for item in schema or []:
        key = normalize_field_key(str(item.get("key", "")))
        if not key:
            errors.append("Schema fields must include a key.")
            continue
        if key in seen_keys:
            errors.append(f"Duplicate schema field '{key}'.")
            continue
        seen_keys.add(key)
        if key not in BUILTIN_FIELD_KEYS and not FIELD_KEY_RE.match(key):
            errors.append(f"Field '{key}' must use snake_case.")
    return errors


def _jinja_token(raw_expr: str) -> str:
    key = parse_token_expression(raw_expr)
    if not key:
        return ""
    return "{{ %s|e }}" % key


def _builder_text(value: str, preserve_breaks: bool = True) -> str:
    value = value or ""
    parts: List[str] = []
    cursor = 0
    for match in TOKEN_RE.finditer(value):
        static_part = html.escape(value[cursor:match.start()])
        if preserve_breaks:
            static_part = static_part.replace("\n", "<br/>")
        parts.append(static_part)
        parts.append(_jinja_token(match.group(1)))
        cursor = match.end()

    tail = html.escape(value[cursor:])
    if preserve_breaks:
        tail = tail.replace("\n", "<br/>")
    parts.append(tail)
    return "".join(parts)


def _visibility_wrapper_start(block: Dict[str, Any]) -> str:
    field = normalize_field_key(str(block.get("visibility_field") or ""))
    if not field:
        return ""
    mode = str(block.get("visibility_mode") or "present")
    if mode == "missing":
        return "{% if not %s %}" % field
    return "{% if %s %}" % field


def _visibility_wrapper_end(block: Dict[str, Any]) -> str:
    return "{% endif %}" if block.get("visibility_field") else ""


def _render_section_block(block: Dict[str, Any]) -> str:
    heading = _builder_text(str(block.get("heading") or ""))
    body = _builder_text(str(block.get("body") or ""))
    background = html.escape(str(block.get("background_color") or "#ffffff"))
    text_color = html.escape(str(block.get("text_color") or "#111827"))
    padding = max(int(block.get("padding") or 0), 0)
    align = html.escape(str(block.get("align") or "left"))
    return f"""
    <tr>
      <td style="padding:{padding}px; background:{background}; text-align:{align};">
        <h2 style="margin:0 0 12px 0; font-size:28px; line-height:1.2; color:{text_color}; font-family:Arial,sans-serif;">{heading}</h2>
        <div style="font-size:16px; line-height:1.7; color:{text_color}; font-family:Arial,sans-serif;">{body}</div>
      </td>
    </tr>
    """


def _render_columns_block(block: Dict[str, Any]) -> str:
    background = html.escape(str(block.get("background_color") or "#ffffff"))
    text_color = html.escape(str(block.get("text_color") or "#111827"))
    padding = max(int(block.get("padding") or 0), 0)
    gap = max(int(block.get("gap") or 0), 0)
    left_heading = _builder_text(str(block.get("left_heading") or ""))
    left_text = _builder_text(str(block.get("left_text") or ""))
    right_heading = _builder_text(str(block.get("right_heading") or ""))
    right_text = _builder_text(str(block.get("right_text") or ""))
    return f"""
    <tr>
      <td style="padding:{padding}px; background:{background};">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td width="50%" valign="top" style="padding-right:{gap // 2}px;">
              <h3 style="margin:0 0 8px 0; font-size:20px; color:{text_color}; font-family:Arial,sans-serif;">{left_heading}</h3>
              <div style="font-size:15px; line-height:1.6; color:{text_color}; font-family:Arial,sans-serif;">{left_text}</div>
            </td>
            <td width="50%" valign="top" style="padding-left:{gap // 2}px;">
              <h3 style="margin:0 0 8px 0; font-size:20px; color:{text_color}; font-family:Arial,sans-serif;">{right_heading}</h3>
              <div style="font-size:15px; line-height:1.6; color:{text_color}; font-family:Arial,sans-serif;">{right_text}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    """


def _render_text_block(block: Dict[str, Any]) -> str:
    text = _builder_text(str(block.get("text") or ""))
    color = html.escape(str(block.get("color") or "#334155"))
    font_size = max(int(block.get("font_size") or 16), 12)
    padding = max(int(block.get("padding") or 0), 0)
    align = html.escape(str(block.get("align") or "left"))
    return f"""
    <tr>
      <td style="padding:{padding}px; text-align:{align};">
        <div style="font-size:{font_size}px; line-height:1.7; color:{color}; font-family:Arial,sans-serif;">{text}</div>
      </td>
    </tr>
    """


def _render_image_block(block: Dict[str, Any]) -> str:
    src = _builder_text(str(block.get("src") or ""), preserve_breaks=False)
    alt = _builder_text(str(block.get("alt") or "Image"), preserve_breaks=False)
    href = str(block.get("href") or "").strip()
    width = max(int(block.get("width") or 520), 40)
    padding = max(int(block.get("padding") or 0), 0)
    align = html.escape(str(block.get("align") or "center"))
    background = html.escape(str(block.get("background_color") or "#ffffff"))
    image_tag = (
        f'<img src="{src}" alt="{alt}" width="{width}" style="display:block; width:100%; max-width:{width}px; border:0; outline:none; text-decoration:none;" />'
    )
    if href:
        image_tag = f'<a href="{_builder_text(href, preserve_breaks=False)}" target="_blank" rel="noreferrer">{image_tag}</a>'

    return f"""
    <tr>
      <td style="padding:{padding}px; background:{background}; text-align:{align};">
        {image_tag}
      </td>
    </tr>
    """


def _render_button_block(block: Dict[str, Any]) -> str:
    text = _builder_text(str(block.get("text") or "Call to Action"))
    url = _builder_text(str(block.get("url") or "https://example.com"), preserve_breaks=False)
    align = html.escape(str(block.get("align") or "left"))
    background = html.escape(str(block.get("background_color") or "#111827"))
    text_color = html.escape(str(block.get("text_color") or "#ffffff"))
    padding = max(int(block.get("padding") or 0), 0)
    return f"""
    <tr>
      <td style="padding:{padding}px; text-align:{align};">
        <a href="{url}" target="_blank" rel="noreferrer" style="display:inline-block; padding:14px 24px; border-radius:999px; background:{background}; color:{text_color}; font-family:Arial,sans-serif; font-size:15px; text-decoration:none; font-weight:700;">{text}</a>
      </td>
    </tr>
    """


def _render_spacer_block(block: Dict[str, Any]) -> str:
    height = max(int(block.get("height") or 0), 0)
    return f"""
    <tr>
      <td style="height:{height}px; line-height:{height}px; font-size:0;">&nbsp;</td>
    </tr>
    """


def _render_divider_block(block: Dict[str, Any]) -> str:
    color = html.escape(str(block.get("color") or "#e5e7eb"))
    padding = max(int(block.get("padding") or 0), 0)
    return f"""
    <tr>
      <td style="padding:{padding}px;">
        <div style="height:1px; background:{color};"></div>
      </td>
    </tr>
    """


def _render_social_footer_block(block: Dict[str, Any]) -> str:
    heading = _builder_text(str(block.get("heading") or "Stay connected"))
    footer_text = _builder_text(str(block.get("footer_text") or ""))
    text_color = html.escape(str(block.get("text_color") or "#64748b"))
    padding = max(int(block.get("padding") or 0), 0)
    links = block.get("links") or []
    link_markup = []
    for link in links:
        label = _builder_text(str(link.get("label") or "Link"))
        url = _builder_text(str(link.get("url") or "https://example.com"), preserve_breaks=False)
        link_markup.append(
            f'<a href="{url}" target="_blank" rel="noreferrer" style="color:{text_color}; text-decoration:none; margin-right:12px;">{label}</a>'
        )
    joined_links = "".join(link_markup)
    return f"""
    <tr>
      <td style="padding:{padding}px; text-align:left;">
        <div style="font-size:18px; font-weight:700; color:{text_color}; font-family:Arial,sans-serif; margin-bottom:10px;">{heading}</div>
        <div style="font-size:14px; line-height:1.6; color:{text_color}; font-family:Arial,sans-serif; margin-bottom:12px;">{footer_text}</div>
        <div style="font-size:14px; line-height:1.6; color:{text_color}; font-family:Arial,sans-serif; margin-bottom:12px;">{joined_links}</div>
        <div style="font-size:12px; color:{text_color}; font-family:Arial,sans-serif;">
          <a href="{{ unsubscribe_url }}" style="color:{text_color}; text-decoration:underline;">Unsubscribe</a>
        </div>
      </td>
    </tr>
    """


def _render_raw_html_block(block: Dict[str, Any]) -> str:
    return normalize_template_source(str(block.get("html") or ""))


def render_builder_block(block: Dict[str, Any]) -> str:
    renderers = {
        "section": _render_section_block,
        "columns": _render_columns_block,
        "text": _render_text_block,
        "image": _render_image_block,
        "button": _render_button_block,
        "spacer": _render_spacer_block,
        "divider": _render_divider_block,
        "social_footer": _render_social_footer_block,
        "raw_html": _render_raw_html_block,
    }
    renderer = renderers.get(str(block.get("type") or "text"), _render_text_block)
    return f"{_visibility_wrapper_start(block)}{renderer(block)}{_visibility_wrapper_end(block)}"


def compile_builder_design(design_json: Optional[Dict[str, Any]], preheader: str = "") -> str:
    design = copy.deepcopy(design_json or build_default_builder_design())
    blocks = design.get("blocks") or []
    content_width = max(int(design.get("content_width") or 600), 320)
    body_background = html.escape(str(design.get("body_background_color") or "#030712"))
    content_background = html.escape(
        str(design.get("content_background_color") or "#ffffff")
    )
    compiled_blocks = "\n".join(render_builder_block(block) for block in blocks)
    safe_preheader = html.escape(preheader or "")

    return f"""
    <!doctype html>
    <html>
      <body style="margin:0; padding:0; background:{body_background};">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          {safe_preheader}
        </div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{body_background};">
          <tr>
            <td align="center" style="padding:32px 16px;">
              <table role="presentation" width="{content_width}" cellspacing="0" cellpadding="0" border="0" style="width:100%; max-width:{content_width}px; background:{content_background}; border-radius:28px; overflow:hidden;">
                {compiled_blocks}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
    """


def compile_template_content(
    editor_mode: str,
    design_json: Optional[Dict[str, Any]],
    html_source: Optional[str],
    preheader: str,
) -> str:
    if editor_mode == "code":
        return normalize_template_source(html_source)
    return compile_builder_design(design_json, preheader=preheader)


def build_render_payload(
    payload: Optional[Dict[str, Any]],
    user_id: Optional[int] = None,
    email: Optional[str] = None,
) -> Dict[str, Any]:
    payload = copy.deepcopy(payload or {})
    email_value = str(payload.get("email") or email or "").strip()
    name_value = str(payload.get("name") or "").strip() or "There"

    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    if not first_name or not last_name:
        name_parts = [part for part in name_value.split() if part]
        if not first_name and name_parts:
            first_name = name_parts[0]
        if not last_name and len(name_parts) > 1:
            last_name = " ".join(name_parts[1:])

    payload["email"] = email_value
    payload["name"] = name_value
    payload["first_name"] = first_name
    payload["last_name"] = last_name
    payload["unsubscribe_url"] = build_unsubscribe_url(user_id or 0, email_value)
    return payload


def render_template_html(
    compiled_html: str,
    payload: Optional[Dict[str, Any]],
    user_id: Optional[int] = None,
) -> str:
    env = Environment(autoescape=True)
    template = env.from_string(compiled_html or "")
    return template.render(**build_render_payload(payload, user_id=user_id))


def render_template_version(
    version: EmailTemplateVersion,
    payload: Optional[Dict[str, Any]],
    user_id: Optional[int] = None,
) -> str:
    compiled_html = version.compiled_html or compile_template_content(
        version.editor_mode, version.design_json, version.html_source, version.preheader
    )
    return render_template_html(compiled_html, payload, user_id=user_id)


def validate_template_version_data(
    editor_mode: str,
    subject: str,
    preheader: str,
    design_json: Optional[Dict[str, Any]],
    html_source: Optional[str],
    merge_fields_schema: Optional[Iterable[Dict[str, Any]]],
) -> tuple[list[str], list[dict[str, Any]], str]:
    errors: List[str] = []
    schema = ensure_schema(merge_fields_schema)
    errors.extend(validate_schema(schema))

    if not subject or not subject.strip():
        errors.append("Subject is required.")

    compiled_html = compile_template_content(editor_mode, design_json, html_source, preheader)
    if not compiled_html or not compiled_html.strip():
        errors.append("Compiled HTML cannot be empty.")

    return errors, schema, compiled_html


def serialize_version(version: Optional[EmailTemplateVersion]) -> Optional[Dict[str, Any]]:
    if not version:
        return None

    return {
        "id": version.id,
        "version_number": version.version_number,
        "status": version.status,
        "editor_mode": version.editor_mode,
        "subject": version.subject,
        "preheader": version.preheader,
        "design_json": version.design_json or {},
        "html_source": version.html_source or "",
        "compiled_html": version.compiled_html or "",
        "merge_fields_schema": ensure_schema(version.merge_fields_schema),
        "thumbnail": version.thumbnail,
        "published_at": version.published_at.isoformat() if version.published_at else None,
        "created_at": version.created_at.isoformat(),
        "updated_at": version.updated_at.isoformat(),
    }


def get_latest_published_version(
    session: Session, template_id: int
) -> Optional[EmailTemplateVersion]:
    return session.exec(
        select(EmailTemplateVersion)
        .where(EmailTemplateVersion.template_id == template_id)
        .where(EmailTemplateVersion.status == "published")
        .order_by(EmailTemplateVersion.version_number.desc())
        .limit(1)
    ).first()


def get_draft_version(session: Session, template_id: int) -> Optional[EmailTemplateVersion]:
    return session.exec(
        select(EmailTemplateVersion)
        .where(EmailTemplateVersion.template_id == template_id)
        .where(EmailTemplateVersion.status == "draft")
        .order_by(EmailTemplateVersion.version_number.desc())
        .limit(1)
    ).first()


def get_or_create_draft_version(
    session: Session, template: EmailTemplate
) -> EmailTemplateVersion:
    draft = get_draft_version(session, template.id or 0)
    if draft:
        return draft

    latest_published = get_latest_published_version(session, template.id or 0)
    next_version_number = (
        (latest_published.version_number if latest_published else 0) + 1
    )

    if latest_published:
        draft = EmailTemplateVersion(
            template_id=template.id or 0,
            version_number=next_version_number,
            status="draft",
            editor_mode=latest_published.editor_mode,
            subject=latest_published.subject,
            preheader=latest_published.preheader,
            design_json=copy.deepcopy(latest_published.design_json or {}),
            html_source=latest_published.html_source,
            compiled_html=latest_published.compiled_html,
            merge_fields_schema=copy.deepcopy(
                ensure_schema(latest_published.merge_fields_schema)
            ),
            thumbnail=latest_published.thumbnail,
        )
    else:
        draft = EmailTemplateVersion(
            template_id=template.id or 0,
            version_number=1,
            status="draft",
            editor_mode=template.editor_mode,
            subject=DEFAULT_TEMPLATE_SUBJECT,
            preheader=DEFAULT_TEMPLATE_PREHEADER,
            design_json=build_default_builder_design(),
            compiled_html=compile_builder_design(
                build_default_builder_design(), DEFAULT_TEMPLATE_PREHEADER
            ),
            merge_fields_schema=ensure_schema([]),
        )

    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def serialize_template(
    session: Session, template: EmailTemplate, include_versions: bool = False
) -> Dict[str, Any]:
    draft = get_draft_version(session, template.id or 0)
    published = get_latest_published_version(session, template.id or 0)

    data: Dict[str, Any] = {
        "id": template.id,
        "name": template.name,
        "slug": template.slug,
        "editor_mode": template.editor_mode,
        "is_default": template.is_default,
        "is_archived": template.is_archived,
        "created_at": template.created_at.isoformat(),
        "updated_at": template.updated_at.isoformat(),
        "draft_version": serialize_version(draft),
        "published_version": serialize_version(published),
    }
    if include_versions:
        versions = session.exec(
            select(EmailTemplateVersion)
            .where(EmailTemplateVersion.template_id == template.id)
            .order_by(EmailTemplateVersion.version_number.desc())
        ).all()
        data["versions"] = [serialize_version(version) for version in versions]
    return data


def _template_name_in_use(session: Session, user_id: int, name: str) -> str:
    base_name = (name or "Untitled Template").strip() or "Untitled Template"
    candidate = base_name
    suffix = 2
    while session.exec(
        select(EmailTemplate)
        .where(EmailTemplate.user_id == user_id)
        .where(EmailTemplate.name == candidate)
    ).first():
        candidate = f"{base_name} {suffix}"
        suffix += 1
    return candidate


def create_template(
    session: Session,
    user: User,
    name: str,
    editor_mode: str = "builder",
    make_default: bool = False,
) -> EmailTemplate:
    name = _template_name_in_use(session, user.id or 0, name)
    template = EmailTemplate(
        user_id=user.id or 0,
        name=name,
        slug=slugify(name),
        editor_mode=editor_mode,
        is_default=make_default,
        is_archived=False,
    )
    session.add(template)
    session.commit()
    session.refresh(template)

    draft = EmailTemplateVersion(
        template_id=template.id or 0,
        version_number=1,
        status="draft",
        editor_mode=editor_mode,
        subject=DEFAULT_TEMPLATE_SUBJECT,
        preheader=DEFAULT_TEMPLATE_PREHEADER,
        design_json=build_default_builder_design() if editor_mode == "builder" else {},
        html_source="" if editor_mode == "builder" else load_legacy_template_source(None),
        compiled_html=compile_template_content(
            editor_mode,
            build_default_builder_design() if editor_mode == "builder" else {},
            "" if editor_mode == "builder" else load_legacy_template_source(None),
            DEFAULT_TEMPLATE_PREHEADER,
        ),
        merge_fields_schema=ensure_schema([]),
    )
    session.add(draft)
    session.commit()

    if make_default:
        set_default_template(session, user, template)
    return template


def create_html_import_template(
    session: Session,
    user: User,
    name: str,
    html_source: str,
    make_default: bool = False,
) -> EmailTemplate:
    template = create_template(session, user, name, editor_mode="code", make_default=False)
    draft = get_or_create_draft_version(session, template)
    normalized_html = normalize_template_source(html_source)
    draft.editor_mode = "code"
    draft.html_source = normalized_html
    draft.merge_fields_schema = schema_from_source(normalized_html)
    draft.compiled_html = normalized_html
    draft.updated_at = datetime.utcnow()
    session.add(draft)
    session.commit()

    publish_template(session, template, draft)

    if make_default:
        set_default_template(session, user, template)
    return template


def publish_template(
    session: Session, template: EmailTemplate, draft: Optional[EmailTemplateVersion] = None
) -> EmailTemplateVersion:
    draft = draft or get_or_create_draft_version(session, template)
    errors, schema, compiled_html = validate_template_version_data(
        draft.editor_mode,
        draft.subject,
        draft.preheader,
        draft.design_json,
        draft.html_source,
        draft.merge_fields_schema,
    )
    if errors:
        raise ValueError("; ".join(errors))

    draft.merge_fields_schema = schema
    draft.compiled_html = compiled_html
    draft.status = "published"
    draft.published_at = datetime.utcnow()
    draft.updated_at = datetime.utcnow()

    template.editor_mode = draft.editor_mode
    template.updated_at = datetime.utcnow()
    session.add(draft)
    session.add(template)
    session.commit()
    session.refresh(draft)
    return draft


def set_default_template(session: Session, user: User, template: EmailTemplate):
    templates = session.exec(
        select(EmailTemplate).where(EmailTemplate.user_id == user.id)
    ).all()
    for item in templates:
        item.is_default = item.id == template.id
        item.updated_at = datetime.utcnow()
        session.add(item)

    settings = user.settings
    if settings:
        settings.default_template_id = template.id
        session.add(settings)

    session.commit()


def load_legacy_template_source(selected_template: Optional[str]) -> str:
    candidates = []
    if selected_template:
        candidates.append(os.path.join("data", "templates", selected_template))
    candidates.extend(
        [
            os.path.join("data", "templates", "mail.html"),
            "mail.html",
        ]
    )
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as file:
                return normalize_template_source(file.read())

    return normalize_template_source(
        """
        <!doctype html>
        <html>
          <body style="font-family:Arial,sans-serif;background:#030712;padding:32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td align="center">
                  <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:24px;">
                    <tr>
                      <td style="padding:32px;">
                        <h1 style="margin:0 0 12px 0;color:#111827;">Hello {{ name }}</h1>
                        <p style="margin:0 0 16px 0;color:#475569;line-height:1.7;">Your campaign content goes here.</p>
                        <a href="https://example.com" style="display:inline-block;padding:14px 24px;background:#111827;color:#ffffff;text-decoration:none;border-radius:999px;">View Details</a>
                        <p style="margin:24px 0 0 0;font-size:12px;color:#64748b;"><a href="{{ unsubscribe_url }}" style="color:#64748b;">Unsubscribe</a></p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """
    )


def ensure_default_template_for_user(session: Session, user: User):
    templates = session.exec(
        select(EmailTemplate)
        .where(EmailTemplate.user_id == user.id)
        .order_by(EmailTemplate.created_at.asc())
    ).all()
    settings = user.settings

    if templates:
        if settings and not settings.default_template_id:
            default_template = next((t for t in templates if t.is_default), templates[0])
            set_default_template(session, user, default_template)
        return

    template_name = DEFAULT_TEMPLATE_NAME
    selected_template = settings.selected_template if settings else None
    legacy_html = load_legacy_template_source(selected_template)
    legacy_subject = (
        settings.subject
        if settings and settings.subject and settings.subject.strip()
        else DEFAULT_TEMPLATE_SUBJECT
    )

    template = EmailTemplate(
        user_id=user.id or 0,
        name=template_name,
        slug=slugify(template_name),
        editor_mode="code",
        is_default=True,
        is_archived=False,
    )
    session.add(template)
    session.commit()
    session.refresh(template)

    published = EmailTemplateVersion(
        template_id=template.id or 0,
        version_number=1,
        status="published",
        editor_mode="code",
        subject=legacy_subject,
        preheader=DEFAULT_TEMPLATE_PREHEADER,
        html_source=legacy_html,
        compiled_html=legacy_html,
        merge_fields_schema=schema_from_source(legacy_html),
        published_at=datetime.utcnow(),
    )
    session.add(published)

    if settings:
        settings.default_template_id = template.id
        session.add(settings)

    session.commit()


def delete_template(session: Session, template: EmailTemplate):
    batch = session.exec(
        select(CampaignBatch)
        .join(EmailTemplateVersion, CampaignBatch.template_version_id == EmailTemplateVersion.id)
        .where(EmailTemplateVersion.template_id == template.id)
        .limit(1)
    ).first()
    if batch:
        raise ValueError("Templates used in campaign batches can only be archived.")

    versions = session.exec(
        select(EmailTemplateVersion).where(EmailTemplateVersion.template_id == template.id)
    ).all()
    for version in versions:
        session.delete(version)
    session.delete(template)
    session.commit()


def duplicate_template(session: Session, user: User, template: EmailTemplate) -> EmailTemplate:
    duplicate = EmailTemplate(
        user_id=user.id or 0,
        name=_template_name_in_use(session, user.id or 0, f"{template.name} Copy"),
        slug=slugify(f"{template.slug}-{uuid.uuid4().hex[:6]}"),
        editor_mode=template.editor_mode,
        is_default=False,
        is_archived=False,
    )
    session.add(duplicate)
    session.commit()
    session.refresh(duplicate)

    versions = session.exec(
        select(EmailTemplateVersion)
        .where(EmailTemplateVersion.template_id == template.id)
        .order_by(EmailTemplateVersion.version_number.asc())
    ).all()
    for version in versions:
        clone = EmailTemplateVersion(
            template_id=duplicate.id or 0,
            version_number=version.version_number,
            status=version.status,
            editor_mode=version.editor_mode,
            subject=version.subject,
            preheader=version.preheader,
            design_json=copy.deepcopy(version.design_json or {}),
            html_source=version.html_source,
            compiled_html=version.compiled_html,
            merge_fields_schema=copy.deepcopy(
                ensure_schema(version.merge_fields_schema)
            ),
            thumbnail=version.thumbnail,
            published_at=version.published_at,
        )
        session.add(clone)
    session.commit()
    return duplicate


def build_unsubscribe_url(user_id: int, email: str) -> str:
    token = jwt.encode(
        {
            "kind": "unsubscribe",
            "user_id": user_id,
            "email": email,
            "exp": datetime.utcnow() + timedelta(days=3650),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return f"{PUBLIC_BASE_URL}/unsubscribe?token={quote(token)}"


def decode_unsubscribe_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid unsubscribe token.") from exc

    if payload.get("kind") != "unsubscribe":
        raise ValueError("Invalid unsubscribe token.")
    return payload


def unsubscribe_contact(session: Session, token: str) -> Contact:
    payload = decode_unsubscribe_token(token)
    normalized_email = str(payload.get("email") or "").strip().lower()
    user_id = int(payload.get("user_id") or 0)

    contact = session.exec(
        select(Contact)
        .where(Contact.user_id == user_id)
        .where(Contact.normalized_email == normalized_email)
    ).first()
    if not contact:
        raise ValueError("Contact not found.")

    contact.unsubscribed_at = datetime.utcnow()
    contact.updated_at = datetime.utcnow()
    session.add(contact)
    session.commit()
    session.refresh(contact)
    return contact


def asset_support_enabled() -> bool:
    return bool(os.getenv("PUBLIC_BASE_URL"))


def asset_public_url(relative_path: str) -> str:
    return f"{PUBLIC_BASE_URL}/public-assets/{relative_path.lstrip('/')}"


def list_template_assets(user_id: int) -> List[Dict[str, Any]]:
    if not asset_support_enabled():
        return []

    asset_dir = os.path.join("data", "public_assets", str(user_id))
    os.makedirs(asset_dir, exist_ok=True)
    assets = []
    for filename in sorted(os.listdir(asset_dir)):
        path = os.path.join(asset_dir, filename)
        if os.path.isfile(path):
            assets.append(
                {
                    "filename": filename,
                    "url": asset_public_url(f"{user_id}/{filename}"),
                    "size": os.path.getsize(path),
                }
            )
    return assets
