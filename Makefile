.PHONY: stack-up stack-down stack-logs stack-ps health dev-infra dev-api dev-worker dev-web dev-up audit-backend audit-frontend audit-security audit

stack-up:
	docker compose up -d --build

stack-down:
	docker compose down

stack-logs:
	docker compose logs -f api worker web postgres redis

stack-ps:
	docker compose ps

health:
	curl -fsS http://127.0.0.1:8000/healthz && echo

# Local development helpers.
dev-infra:
	docker compose up -d postgres redis

dev-api:
	venv/bin/python -m uvicorn app.main:app --reload

dev-worker:
	venv/bin/dramatiq app.tasks --processes 1 --threads 4

dev-web:
	cd web && npm run dev

# Runs infra + migrations + api reload + worker + web in one terminal.
# Stop with Ctrl+C and all child processes are terminated.
dev-up:
	@set -e; \
	trap 'kill 0' INT TERM EXIT; \
	docker compose up -d postgres redis; \
	venv/bin/python -m alembic upgrade head; \
	venv/bin/python -m uvicorn app.main:app --reload & \
	venv/bin/dramatiq app.tasks --processes 1 --threads 4 & \
	cd web && npm run dev & \
	wait

# Backend verification gate used in this repository.
audit-backend:
	venv/bin/python -m pytest -q

# Frontend verification gate used in this repository.
audit-frontend:
	cd web && npm exec tsc -- --noEmit
	cd web && npm run build

# Optional dependency risk scan for frontend packages.
audit-security:
	cd web && npm audit

# Production-like local verification pass.
audit: audit-backend audit-frontend
