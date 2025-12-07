from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from app.database import create_db_and_tables
from app.routers import pages, api, auth_routes
from app.services.scheduler_service import SchedulerService
import logging

# Setup Logger
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

scheduler = SchedulerService()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing Database...")
    create_db_and_tables()
    
    logger.info("Starting Scheduler...")
    scheduler.start()
    
    yield
    
    # Shutdown
    logger.info("Stopping Scheduler...")
    scheduler.stop()

app = FastAPI(title="Brevo Campaign Manager", lifespan=lifespan)

# Mount Routers
app.include_router(pages.router)
app.include_router(api.router)
app.include_router(auth_routes.router)

# Optional: Mount static if we add custom JS/CSS later
# app.mount("/static", StaticFiles(directory="static"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
