from sqlmodel import SQLModel, create_engine, Session
# Import all models to ensure they are registered with SQLModel
from .models import User, UserSettings, Contact, Job

sqlite_file_name = "data/app.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

connect_args = {"check_same_thread": False}
engine = create_engine(sqlite_url, connect_args=connect_args)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)
    
def get_session():
    with Session(engine) as session:
        yield session
