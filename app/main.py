import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import User
from app.routers import pages, api, auth_routes
from app.services.scheduler_service import SchedulerService
from app.services.template_service import ensure_default_template_for_user
import logging

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
    os.makedirs(os.path.join("data", "public_assets"), exist_ok=True)

    logger.info("Bootstrapping templates...")
    with Session(engine) as session:
        users = session.exec(select(User)).all()
        for user in users:
            ensure_default_template_for_user(session, user)

    logger.info("Starting Scheduler...")
    scheduler.start()

    yield

    # Shutdown
    logger.info("Stopping Scheduler...")
    scheduler.stop()

app = FastAPI(title="CCA Campaign Manager", lifespan=lifespan)

# Mount Routers
app.include_router(pages.router)
app.include_router(api.router)
app.include_router(auth_routes.router)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount(
    "/public-assets",
    StaticFiles(directory=os.path.join("data", "public_assets")),
    name="public-assets",
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
