# CCA Campaign Manager ✨

[![Repository](https://img.shields.io/badge/GitHub-codezelat%2Fcca--mail--sender-181717?style=for-the-badge&logo=github)](https://github.com/codezelat/cca-mail-sender)
[![License](https://img.shields.io/github/license/codezelat/cca-mail-sender?style=for-the-badge)](https://github.com/codezelat/cca-mail-sender/blob/main/LICENSE)
[![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Next.js-111111?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![Postgres](https://img.shields.io/badge/Postgres-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-D92D2A?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![Brevo](https://img.shields.io/badge/Brevo-0B0D17?style=for-the-badge)](https://www.brevo.com/)
[![Kit](https://img.shields.io/badge/Kit-111111?style=for-the-badge)](https://kit.com/)

**CCA Campaign Manager** is a production-oriented email campaign platform built for Brevo or Kit delivery, typed template management, staged CSV/XLSX imports, queue-based sending, and a premium dashboard workflow.

## 📌 Table of Contents

- [Why This Project Exists](#-why-this-project-exists)
- [What You Get](#-what-you-get)
- [Architecture Overview](#-architecture-overview)
- [Frontend and UX Principles](#-frontend-and-ux-principles)
- [Feature Breakdown](#-feature-breakdown)
- [Project Structure](#-project-structure)
- [Environment Configuration](#-environment-configuration)
- [Run with Docker Compose](#-run-with-docker-compose)
- [Run Locally Without Docker](#-run-locally-without-docker)
- [Provider and Sender Configuration](#-provider-and-sender-configuration)
- [Database Migration](#-database-migration)
- [Testing and Verification](#-testing-and-verification)
- [Security Notes](#-security-notes)
- [Operational Notes](#-operational-notes)
- [Troubleshooting](#-troubleshooting)
- [Recommended Commands](#-recommended-commands)
- [License](#-license)

## 🎯 Why This Project Exists

This repository is built to solve the real operational problems around outbound email campaigns:

- template creation should be versioned and safe to edit
- imports should be validated against the selected template before launch
- sends should be deterministic and tied to the published template version used at launch time
- delivery credentials should support secure server-side environment configuration
- the dashboard should remain premium and user-friendly without becoming fragile

The result is not an MVP shell. It is a structured application with:

- a route-based web frontend
- secure cookie auth
- typed API contracts
- campaign batch staging
- queue-backed delivery
- contact unsubscribe handling
- Postgres persistence
- Redis-backed worker/runtime support

## 🚀 What You Get

### Core product capabilities

- Next.js + TypeScript frontend with route-based pages
- FastAPI API backend under `/api/v1`
- secure cookie auth with CSRF protection and refresh-session rotation
- Postgres as the primary system of record
- Redis-backed queue/runtime path for asynchronous work
- Dramatiq workers for background delivery
- template draft/publish lifecycle
- builder mode and raw HTML/code mode template support
- template-aware CSV/XLSX/XLS import analysis and validation
- staged batches and explicit launch flow
- activity tracking with per-recipient state
- unsubscribe-safe delivery behavior

### Production-minded runtime behavior

- environment-driven sender configuration
- support for server-side provider API key usage without exposing the secret in the browser UI
- local asset serving via `PUBLIC_BASE_URL`
- deterministic sending against the locked template version snapshot
- fallback inline scheduler support when queue mode is disabled
- SQLite-to-Postgres migration utility
- Alembic migrations for evolving the schema

## 🏗️ Architecture Overview

```text
Next.js Web App
  ├─ Login / Signup / Dashboard / Templates / Contacts / Unsubscribe
  ├─ TanStack Query for typed data fetching
  └─ Cookie-authenticated API calls

FastAPI API
  ├─ /api/v1/auth/*
  ├─ /api/v1/settings
  ├─ /api/v1/templates/*
  ├─ /api/v1/imports/*
  ├─ /api/v1/batches/*
  ├─ /api/v1/activity
  └─ /api/v1/contacts/*

Persistence and runtime
  ├─ Postgres: users, settings, templates, versions, contacts, batches, recipients, sessions
  ├─ Redis: queue transport, locks, counters, ephemeral coordination
  └─ Dramatiq: background delivery and async jobs
```

## 🎨 Frontend and UX Principles

The current UI look and feel is intentionally preserved. This repository is not trying to redesign the product into a generic admin panel.

Visual constraints carried forward into the new frontend:

- dark premium background palette
- purple-blue glow accents
- glassmorphism-inspired cards and panels
- rounded bento-style surfaces
- strong contrast for white-on-dark content
- intentional dashboard spacing and hierarchy

Technical improvements were made underneath the visual layer:

- typed components instead of raw page scripts
- route-based pages instead of a single monolithic dashboard file
- reusable primitives for auth, cards, tables, badges, and forms
- better state handling for async workflows

## 🧩 Feature Breakdown

### Authentication

- login and signup flows use secure cookies
- refresh sessions rotate instead of relying on persistent browser tokens
- CSRF protection is enforced for mutating API requests
- session invalidation supports logout and logout-all patterns
- password hashing prefers Argon2id with legacy bcrypt fallback support

### Templates

- create and manage templates from the dashboard
- maintain separate draft and published versions
- preview and test send before publishing
- preserve merge-field schema with each version
- support imported HTML templates without degrading them into broken builder output
- allow builder-style and raw code-mode editing paths

### Imports and batches

- upload CSV, XLSX, or XLS
- choose the target published template
- detect fields and map columns
- validate rows against required template fields
- surface row-level errors
- stage batches before launch
- launch only after validation passes

### Delivery

- recipients move through staged, queued, processing, sent, failed, and unsubscribed states
- queue workers process recipients asynchronously
- sends use the batch’s locked template version
- unsubscribe state is checked before sending
- contact delivery metadata is updated after send/failure

### Settings

- store per-account limits and template defaults
- keep provider API keys in the database when desired
- optionally use `EMAIL_PROVIDER`, provider API key env vars, `SENDER_EMAIL`, and `SENDER_NAME` directly from the server environment
- prevent the dashboard from exposing the env provider API key value

## 📁 Project Structure

```text
cca-mail-sender/
├── alembic/                     # Alembic migration environment and revisions
├── app/                         # FastAPI app, models, auth, services, routers, queue integration
│   ├── routers/
│   ├── services/
│   ├── auth.py
│   ├── config.py
│   ├── database.py
│   ├── main.py
│   └── models.py
├── data/                        # Local templates, imports, asset storage, error reports
├── scripts/                     # Migration and maintenance scripts
├── tests/                       # Backend tests
├── web/                         # Next.js frontend
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── public/
├── .env.example                 # Documented environment sample
├── Dockerfile                   # API/worker image
├── docker-compose.yml           # Full local stack
├── requirements.txt             # Python dependencies
└── LICENSE
```

## 🔐 Environment Configuration

Copy the sample file first:

```bash
cp .env.example .env
```

The sample file is documented with sections and comments. The most important variables are:

### Core runtime

```env
APP_NAME=CCA Campaign Manager
SECRET_KEY=replace-with-a-long-random-secret
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=30
```

### Infrastructure

```env
DATABASE_URL=postgresql+psycopg://cca:cca@127.0.0.1:5432/cca_mail_sender
REDIS_URL=redis://127.0.0.1:6379/0
QUEUE_BACKEND=dramatiq
```

### Browser and asset origins

```env
WEB_ORIGIN=http://127.0.0.1:3000
PUBLIC_BASE_URL=http://127.0.0.1:8000
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
SECURE_COOKIES=false
```

### Provider selection and server defaults

```env
EMAIL_PROVIDER=brevo
BREVO_SMTP_API_KEY=
KIT_API_KEY=
KIT_EMAIL_TEMPLATE_ID=0
KIT_BROADCAST_POLL_INTERVAL_SECONDS=5
KIT_BROADCAST_TIMEOUT_SECONDS=300
SENDER_EMAIL=
SENDER_NAME=
```

Set `EMAIL_PROVIDER` to `brevo` or `kit`.

- when `EMAIL_PROVIDER=brevo`, the runtime uses `BREVO_SMTP_API_KEY`
- when `EMAIL_PROVIDER=kit`, the runtime uses `KIT_API_KEY`
- `KIT_EMAIL_TEMPLATE_ID` is optional; when left as `0`, the backend auto-selects a Kit HTML-capable email template
- `SENDER_EMAIL` and `SENDER_NAME` are shared by both providers

When the active provider key and sender identity exist in `.env`, the dashboard settings page can use them directly without exposing the raw env secret to the browser.

## 🐳 Run with Docker Compose

This is the preferred full-stack local run:

```bash
docker compose up --build
```

That starts:

- `postgres`
- `redis`
- `api`
- `worker`
- `web`

Expected local URLs:

- Web: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- API: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Health check: [http://127.0.0.1:8000/healthz](http://127.0.0.1:8000/healthz)

### Docker notes

- the API and worker both read from environment values
- `docker-compose.yml` now forwards `EMAIL_PROVIDER`, `BREVO_SMTP_API_KEY`, `KIT_API_KEY`, `KIT_EMAIL_TEMPLATE_ID`, `KIT_BROADCAST_POLL_INTERVAL_SECONDS`, `KIT_BROADCAST_TIMEOUT_SECONDS`, `SENDER_EMAIL`, and `SENDER_NAME`
- the API and worker run `alembic upgrade head` before starting
- `NEXT_PUBLIC_API_BASE_URL` is passed to the web container

## 🧪 Run Locally Without Docker

### 1. Create and activate a Python virtual environment

```bash
python -m venv venv
source venv/bin/activate
```

### 2. Install backend dependencies

```bash
pip install -r requirements.txt
```

### 3. Start Postgres and Redis

If you already use local services, point `.env` at them. Otherwise, you can still use Compose just for infrastructure:

```bash
docker compose up -d postgres redis
```

### 4. Apply migrations

```bash
alembic upgrade head
```

### 5. Start the API

```bash
uvicorn app.main:app --reload
```

If your environment blocks file watcher hooks, use:

```bash
WATCHFILES_FORCE_POLLING=1 uvicorn app.main:app --reload
```

### 6. Start the worker

```bash
dramatiq app.tasks
```

### 7. Start the web app

```bash
cd web
npm install
npm run dev
```

## 📬 Provider and Sender Configuration

There are now two supported configuration paths.

### Option 1: server environment defaults

Set these in `.env`:

```env
EMAIL_PROVIDER=brevo
BREVO_SMTP_API_KEY=your-real-brevo-key
SENDER_EMAIL=you@example.com
SENDER_NAME=Your Company
```

Then in the dashboard settings page:

- enable the “use `.env`” option for the active provider
- enable the “use `.env`” option for sender identity

Benefits:

- the provider key does not need to be typed into the UI
- server-managed credentials can be shared across operators
- the frontend never receives the raw env key

For Kit-backed delivery, use:

```env
EMAIL_PROVIDER=kit
KIT_API_KEY=your-real-kit-key
KIT_EMAIL_TEMPLATE_ID=0
KIT_BROADCAST_POLL_INTERVAL_SECONDS=5
KIT_BROADCAST_TIMEOUT_SECONDS=300
SENDER_EMAIL=you@example.com
SENDER_NAME=Your Company
```

### Option 2: manual per-account configuration

Keep the env fields empty and enter:

- provider API key for the active provider
- sender email
- sender name

in the dashboard settings form for that account.

### Effective behavior

- if env defaults exist and no manual value is stored yet, the backend can automatically use the env value
- provider choice is controlled globally through `EMAIL_PROVIDER`
- the batch snapshot stores sender identity at stage time
- test-send and delivery both resolve settings through the same runtime path
- Brevo keeps the current recipient-by-recipient delivery path
- Kit uses a batch-oriented path: temporary subscribers are created or updated, attached to a delivery tag, sent through a broadcast, then untagged and unsubscribed after the broadcast completes

### Kit caveat

Kit does not currently expose a public delete-subscriber API. In this repository's cleanup mode, successful Kit deliveries unsubscribe the temporary subscriber after send so the account behaves as close to send-only as Kit allows.

Tradeoff:

- the subscriber record is not hard-deleted from Kit
- future sends to the same email address can fail if that Kit subscriber is already unsubscribed or otherwise non-active, because Kit's public API does not expose a reliable reactivation flow
- temporary per-batch tags remain in Kit because Kit's public API does not expose a delete-tag endpoint

## 🗃️ Database Migration

If you have older local SQLite data and want to move it into Postgres:

```bash
TARGET_DATABASE_URL=postgresql+psycopg:///cca_mail_sender \
venv/bin/python scripts/migrate_sqlite_to_postgres.py
```

The migration utility:

- prepares the source SQLite schema if older columns are missing
- recreates the target schema from current SQLModel metadata
- copies users, settings, templates, versions, contacts, batches, recipients, sessions, and jobs

After migration, apply Alembic:

```bash
alembic upgrade head
```

## ✅ Testing and Verification

Recommended verification commands:

```bash
venv/bin/python -c "import app.main; print('import ok')"
venv/bin/python -m pytest
venv/bin/python -m compileall app scripts tests
cd web && npm run build
```

What these checks cover:

- API imports and startup wiring
- backend unit/integration coverage currently in `tests/`
- Python syntax compilation across app code
- TypeScript/Next production build safety

## 🛡️ Security Notes

This project includes several security-oriented defaults:

- secure cookie auth instead of browser-stored auth tokens
- CSRF protection on state-changing requests
- Argon2id password hashing when available
- session rotation and revocation support
- per-user data isolation across API routes
- environment-backed secret handling for provider credentials
- unsubscribe-aware delivery suppression
- no raw env provider key sent back to the frontend

## ⚙️ Operational Notes

### Queue backend selection

Set:

```env
QUEUE_BACKEND=dramatiq
```

for Redis-backed background delivery.

If you ever disable it, the inline scheduler path can still run inside the API process, but Redis + Dramatiq is the intended production setup.

### Assets

Local asset upload is enabled when `PUBLIC_BASE_URL` is present. Uploaded files are served from:

```text
/public-assets/<user-id>/<filename>
```

### Default templates

Each user account gets a default template bootstrap path if none exists. The dashboard also allows selecting a default template for convenience.

## 🧯 Troubleshooting

### `uvicorn app.main:app --reload` fails immediately

Check:

- `.env` exists and is valid
- Postgres is reachable
- `data/public_assets` can be created

If the reloader itself is blocked:

```bash
WATCHFILES_FORCE_POLLING=1 uvicorn app.main:app --reload
```

### Test sends fail with configuration errors

Verify at least one valid path exists:

- manual provider key + manual sender email
- or env-backed provider key + `SENDER_EMAIL`
- if `EMAIL_PROVIDER=brevo`, the env key is `BREVO_SMTP_API_KEY`
- if `EMAIL_PROVIDER=kit`, the env key is `KIT_API_KEY`

### The web app cannot reach the API

Confirm:

- API is running on port `8000`
- `NEXT_PUBLIC_API_BASE_URL` is correct for your mode
- `WEB_ORIGIN` matches the web origin

### Docker stack starts but email does not send

Check:

- `redis` is healthy
- `worker` is running
- the active provider env vars are available in the API and worker environment
- for Brevo: `EMAIL_PROVIDER=brevo`, `BREVO_SMTP_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`
- for Kit: `EMAIL_PROVIDER=kit`, `KIT_API_KEY`, `SENDER_EMAIL`, `SENDER_NAME`

## 🧭 Recommended Commands

If you prefer a single command surface, use the Makefile targets below.

### One-command production-like local run

```bash
make stack-up
```

Then verify health and inspect logs:

```bash
make health
make stack-logs
```

Stop everything:

```bash
make stack-down
```

### One-command verification gates

```bash
make audit
```

Optional dependency scan:

```bash
make audit-security
```

### Full stack

```bash
docker compose up --build
```

### Backend only

```bash
uvicorn app.main:app --reload
```

### Worker only

```bash
dramatiq app.tasks
```

### Tests

```bash
venv/bin/python -m pytest
```

### Frontend production build

```bash
cd web && npm run build
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).

If you are using or extending this repository internally, keep the environment values in `.env` only and never commit real secrets to version control.
