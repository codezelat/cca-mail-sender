# Project Overview
CCA Campaign Manager is a full-stack email campaign platform built around a FastAPI API, a Next.js App Router dashboard, PostgreSQL persistence, Redis-backed background work, and provider adapters for Brevo and Kit. The repository is organized for production-minded outbound email workflows: authenticated template authoring, staged CSV/XLSX imports, publish-time template locking, queued delivery, unsubscribe-aware sending, and a dark premium admin UI that talks to the API through secure cookies and CSRF-protected mutations.

## Repository Structure
- `alembic/` - Alembic environment and revision history for schema changes.
- `app/` - FastAPI backend, SQLModel models, auth/session logic, queue runtime, routers, and email/import/template services.
- `data/` - Runtime storage for SQLite fallback data, imports, templates, public assets, and generated reports; treat as operational state, not source code.
- `scripts/` - One-off maintenance utilities such as SQLite-to-Postgres migration.
- `tests/` - Backend pytest coverage for template rendering, import validation, auth/session behavior, and sender settings resolution.
- `venv/` - Checked-in local Python virtual environment used by the current project setup.
- `web/` - Next.js 15 frontend with App Router pages, reusable components, Tailwind styling, middleware, and typed API helpers.
- `.env.example` - Canonical sample environment file that must be updated whenever configuration changes.
- `Dockerfile` - Backend image build for the API and worker containers.
- `docker-compose.yml` - Local multi-service stack for Postgres, Redis, API, worker, and web.
- `README.md` - Human-oriented product, setup, architecture, and operational documentation.
- `requirements.txt` - Backend Python dependency manifest.
- `LICENSE` - Repository license terms.

## Build & Development Commands
```bash
# Backend install
python3 -m venv venv
venv/bin/pip install -r requirements.txt

# Frontend install
cd web && npm ci

# Full local stack with Docker
docker compose up --build

# Backend dev server
venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend dev server
cd web && npm run dev

# Background worker
venv/bin/dramatiq app.tasks --processes 1 --threads 4

# Apply database migrations
venv/bin/python -m alembic upgrade head

# Optional SQLite -> Postgres migration
SOURCE_SQLITE_URL=sqlite:///data/app.db TARGET_DATABASE_URL=postgresql+psycopg://... \
venv/bin/python scripts/migrate_sqlite_to_postgres.py
```

```bash
# Backend tests
venv/bin/python -m pytest -q

# Frontend type check
cd web && npm exec tsc -- --noEmit

# Frontend production build smoke test
cd web && npm run build

# Docker stack logs / debugging
docker compose logs -f api worker web postgres redis

# Production-like container rollout for a self-managed host
docker compose up -d --build
```

Notes:
- Plain `pytest` may fail if it does not use the project virtualenv; prefer `venv/bin/python -m pytest -q`.
- There is no dedicated lint script checked in today for either Python or TypeScript; use the existing build and type-check commands as the current verification baseline.

## Code Style & Conventions
- Follow the existing split: backend Python in `app/`, frontend TypeScript/React in `web/`, migrations in `alembic/versions/`, and maintenance code in `scripts/`.
- Python uses 4-space indentation, `snake_case` for functions/modules/variables, `PascalCase` for SQLModel classes, and typed helper/service functions where practical.
- TypeScript uses `strict` mode, `PascalCase` for React components, `camelCase` for functions/hooks/utilities, and `@/` path aliases for internal imports from the `web/` root.
- Keep API routes versioned under `/api/v1/...`; when adding endpoints, update both the FastAPI router contract and the corresponding frontend types/helpers in `web/lib/`.
- Preserve the existing visual language in the frontend: dark premium palette, glassy panels, rounded surfaces, and Tailwind utility composition rather than ad hoc inline styles.
- Prefer small service-layer changes over route-handler sprawl; import, template, settings, and provider logic already live under `app/services/`.
- No formatter or linter config is enforced in-repo today; match surrounding code style, keep imports tidy, and avoid drive-by reformatting.
- Commit messages should stay short and imperative. Preferred template: `type: summary`, for example `feat: add mailgun provider`, `fix: validate import mapping`, or `docs: update README`.

## Architecture Notes
```mermaid
flowchart LR
  Browser["Next.js dashboard (`web/`)"] -->|"cookie auth + CSRF"| API["FastAPI (`app/main.py`)"]
  Browser -->|"uploads / previews / settings"| API
  API --> Router["Routers (`app/routers/`)"]
  Router --> Services["Services (`app/services/`)"]
  Services --> DB[(Postgres or SQLite fallback)]
  Services --> Files["`data/` runtime files"]
  Services --> Queue["Redis / queue runtime"]
  Queue --> Worker["Dramatiq worker (`app/tasks.py`)"]
  Worker --> Providers["Brevo / Kit provider adapters"]
  Providers --> Contacts["Recipients / contacts"]
```

The browser talks to the FastAPI backend through `web/lib/api.ts`, always sending credentials and attaching the CSRF cookie value for mutating requests. FastAPI owns authentication, session rotation, security headers, template management, import staging, and campaign orchestration. Persistent state lives in SQLModel models backed by PostgreSQL in the primary deployment path, with SQLite fallback logic still supported for local/dev migration scenarios. Import artifacts, generated reports, and public assets live under `data/`. Delivery work fans out through Redis-backed queue helpers into Dramatiq workers; if `QUEUE_BACKEND` is not `dramatiq`, the API process starts the inline scheduler instead. Provider-specific delivery details are isolated behind `brevo_service.py` and `kit_service.py`, while `settings_service.py` resolves whether credentials come from user settings or server environment variables.

## Testing Strategy
- Backend tests live in `tests/test_template_and_import.py` and currently cover template rendering safety, merge-field schema normalization, import validation, auth/session helpers, and sender configuration resolution.
- Run backend tests locally with `venv/bin/python -m pytest -q`; this is the current source of truth because the repo relies on the checked-in virtualenv for Python dependency resolution.
- Frontend verification is build-oriented rather than test-suite-oriented today: run `cd web && npm exec tsc -- --noEmit` and `cd web && npm run build`.
- There is no dedicated end-to-end browser suite checked in yet; for UI-affecting work, verify the dashboard manually against the local API/web stack before considering the change complete.
- There is no `.github/workflows/` CI pipeline in this repository at the moment, so the de facto CI gate is the local sequence: backend pytest, frontend type check, frontend production build, and any migration command relevant to the changed schema.
- When changing auth, imports, template compilation, provider behavior, or migrations, add or update backend tests before merging; do not treat manual clicking as sufficient evidence for those paths.

## Security & Compliance
- Never commit real secrets. Keep runtime credentials in `.env`, document every new variable in `.env.example`, and treat `.env` as local-only even if it exists in a developer workspace.
- The app supports provider credentials in server env vars or persisted user settings; never expose resolved provider API keys to the browser, logs, screenshots, or generated fixtures.
- Preserve the existing auth model: secure cookies, refresh-session rotation, CSRF enforcement for mutating endpoints, and the response security headers configured in `app/main.py`.
- Treat `data/` as potentially sensitive because it can contain imports, recipient information, templates, and public assets generated from campaign workflows.
- Do not send live email during development or automated verification; use test recipients, fake keys, or mocked provider calls when changing delivery code.
- When dependencies change, review both ecosystems. At minimum run `cd web && npm audit` for frontend packages and inspect Python dependency diffs before release; add a dedicated Python audit step if dependency churn increases.
- New database or auth changes must preserve backward-compatible migrations where possible; add new Alembic revisions instead of rewriting historical revisions that other environments may already have applied.
- This repository is MIT-licensed under `LICENSE`; imported templates, brand assets, and provider APIs may carry separate terms that must be respected outside the repo itself.

## Agent Guardrails
- Do not edit `venv/`, `web/node_modules/`, `web/.next/`, `.pytest_cache/`, or generated files unless the task is explicitly about environment repair or dependency/vendor updates.
- Do not modify `.env` values, live API keys, or real recipient data; update `.env.example` and docs instead when configuration changes.
- Treat `data/` as runtime state. Only add deterministic fixtures there if the task explicitly requires them; otherwise avoid churn in imported assets, generated reports, or local databases.
- For schema work, create a new Alembic revision instead of mutating prior revisions in `alembic/versions/`.
- For auth, session, queueing, or provider changes, require both code review and an updated verification trail (`venv/bin/python -m pytest -q`, `cd web && npm exec tsc -- --noEmit`, `cd web && npm run build`, plus any migration exercise).
- Keep edits scoped to the subsystem you are changing. If frontend and backend rules diverge further, add a more specific `AGENTS.md` under `web/` or `app/`; the nearest file should override this root guidance.
- Avoid broad refactors while touching delivery code. Rate limits, unsubscribe handling, and template-version locking are operational guardrails, not cosmetic implementation details.
- Never trigger bulk sends, background flood tests, or provider polling against production accounts from an automated agent session.

## Extensibility Hooks
- `EMAIL_PROVIDER` selects the active delivery provider (`brevo` or `kit`); adding a new provider should mirror the existing service-adapter pattern and update settings resolution, API payload building, and tests together.
- `QUEUE_BACKEND` controls delivery execution mode; `dramatiq` uses Redis-backed workers, while other values fall back to the inline scheduler started by the API lifespan hook.
- `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `PUBLIC_BASE_URL`, `NEXT_PUBLIC_API_BASE_URL`, and `SECURE_COOKIES` are the core deployment/runtime switches and must stay documented in `.env.example`.
- `BREVO_SMTP_API_KEY`, `KIT_API_KEY`, `KIT_EMAIL_TEMPLATE_ID`, `KIT_BROADCAST_POLL_INTERVAL_SECONDS`, `KIT_BROADCAST_TIMEOUT_SECONDS`, `SENDER_EMAIL`, and `SENDER_NAME` act as environment-driven delivery and sender configuration hooks.
- `app/services/template_service.py` is the main extension point for merge fields, template compilation, asset handling, preview rendering, and provider payload generation.
- `app/services/import_service.py` is the main extension point for new import formats, validation rules, staging behavior, and batch launch workflows.
- `web/lib/api.ts`, `web/lib/types.ts`, and the dashboard workspace components are the frontend integration seam for any new API surface.

## Further Reading
- [`README.md`](./README.md)
- [`LICENSE`](./LICENSE)
- [`alembic/versions/`](./alembic/versions/)
- [`scripts/migrate_sqlite_to_postgres.py`](./scripts/migrate_sqlite_to_postgres.py)
