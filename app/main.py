import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app.config import settings
from app.database import create_db_and_tables, engine
from app.models import User
from app.routers import api, auth_routes
from app.services.scheduler_service import SchedulerService
from app.services.template_service import ensure_default_template_for_user
import logging

DATA_DIR = "data"
PUBLIC_ASSETS_DIR = os.path.join(DATA_DIR, "public_assets")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PUBLIC_ASSETS_DIR, exist_ok=True)

# Setup Logger
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

scheduler = SchedulerService()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing Database...")
    create_db_and_tables()
    os.makedirs(PUBLIC_ASSETS_DIR, exist_ok=True)

    logger.info("Bootstrapping templates...")
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        for user in users:
            ensure_default_template_for_user(session, user)

    if settings.queue_backend != "dramatiq":
        logger.info("Starting inline scheduler...")
        scheduler.start()
    else:
        logger.info("Dramatiq queue backend enabled; inline scheduler disabled.")

    yield

    if settings.queue_backend != "dramatiq":
        logger.info("Stopping Scheduler...")
        scheduler.stop()

app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.web_origin,
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception):
    logger.exception("Unhandled application error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
    )

# Mount Routers
app.include_router(api.router)
app.include_router(auth_routes.router)

app.mount(
    "/public-assets",
    StaticFiles(directory=PUBLIC_ASSETS_DIR),
    name="public-assets",
)


@app.get("/healthz")
@app.get("/api/v1/health")
async def healthcheck():
    return {"status": "ok", "service": settings.app_name}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
