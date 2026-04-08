.PHONY: stack-up stack-down stack-logs stack-ps health audit-backend audit-frontend audit-security audit

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
