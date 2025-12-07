from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel import Session, select
from datetime import timedelta

from app.database import get_session
from app.models import User, UserSettings
from app.auth import get_password_hash, verify_password, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES

router = APIRouter()


@router.post("/auth/signup")
async def signup(user_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    # Validate password length (bcrypt has a 72-byte limit)
    if len(user_data.password.encode('utf-8')) > 72:
        raise HTTPException(
            status_code=400,
            detail="Password is too long. Please use a password with 72 bytes or fewer."
        )

    # Check if user exists
    existing_user = session.exec(select(User).where(
        User.email == user_data.username)).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create User
    new_user = User(
        email=user_data.username,
        password_hash=get_password_hash(user_data.password)
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)

    # Create Default Settings for User
    # This shouldn't be None after commit/refresh
    settings = UserSettings(user_id=new_user.id or 0)
    session.add(settings)
    session.commit()

    return {"status": "success", "message": "User created successfully"}


@router.post("/auth/token")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), session: Session = Depends(get_session)):
    user = session.exec(select(User).where(
        User.email == form_data.username)).first()
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}
