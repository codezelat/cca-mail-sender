from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    clear_auth_cookies,
    create_access_token,
    get_authenticated_session,
    get_password_hash,
    issue_auth_session,
    password_needs_rehash,
    refresh_auth_session,
    revoke_all_user_sessions,
    revoke_current_session,
    verify_password,
)
from app.database import get_session
from app.models import User, UserSettings
from app.redis_runtime import delete_key, increment_counter
from app.services.template_service import ensure_default_template_for_user

router = APIRouter()
MAX_AUTH_FAILURES = 10
AUTH_FAILURE_TTL_SECONDS = 10 * 60


class SignupPayload(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=256)


class LoginPayload(BaseModel):
    email: str
    password: str = Field(min_length=1, max_length=256)


def _ensure_password_length(password: str):
    if len(password.encode("utf-8")) > 512:
        raise HTTPException(status_code=400, detail="Password is too long.")


def _ensure_email_shape(email: str):
    normalized_email = email.strip().lower()
    if "@" not in normalized_email or "." not in normalized_email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="A valid email address is required.")


def _find_user_by_email(session: Session, email: str) -> User | None:
    return session.exec(select(User).where(User.email == email.strip().lower())).first()


def _create_user(session: Session, email: str, password: str) -> User:
    _ensure_email_shape(email)
    normalized_email = email.strip().lower()
    existing_user = _find_user_by_email(session, normalized_email)
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    new_user = User(
        email=normalized_email,
        password_hash=get_password_hash(password),
    )
    session.add(new_user)
    session.commit()
    session.refresh(new_user)

    settings = UserSettings(user_id=new_user.id or 0)
    session.add(settings)
    session.commit()
    session.refresh(new_user)
    ensure_default_template_for_user(session, new_user)
    return new_user


def _authenticate_user(session: Session, email: str, password: str) -> User:
    _ensure_email_shape(email)
    user = _find_user_by_email(session, email)
    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if password_needs_rehash(user.password_hash):
        user.password_hash = get_password_hash(password)
        session.add(user)
        session.commit()
    return user


def _failure_key(request: Request, email: str) -> str:
    ip = request.client.host if request.client else "unknown"
    return f"auth-failures:{ip}:{email.strip().lower()}"


def _enforce_login_throttle(request: Request, email: str) -> None:
    key = _failure_key(request, email)
    attempts = increment_counter(key, AUTH_FAILURE_TTL_SECONDS)
    if attempts > MAX_AUTH_FAILURES:
        raise HTTPException(
            status_code=429,
            detail="Too many failed login attempts. Please wait and try again.",
        )


@router.post("/auth/signup")
async def signup(
    user_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    _ensure_password_length(user_data.password)
    _create_user(session, user_data.username, user_data.password)
    return {"status": "success", "message": "User created successfully"}


@router.post("/auth/token")
async def login_for_access_token(
    response: Response,
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: Session = Depends(get_session),
):
    try:
        user = _authenticate_user(session, form_data.username, form_data.password)
    except HTTPException:
        _enforce_login_throttle(request, form_data.username)
        raise

    delete_key(_failure_key(request, form_data.username))

    issue_auth_session(response, session, user, request)
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email, "uid": user.id},
        expires_delta=access_token_expires,
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/api/v1/auth/signup")
async def signup_v1(
    payload: SignupPayload,
    response: Response,
    request: Request,
    session: Session = Depends(get_session),
):
    _ensure_password_length(payload.password)
    user = _create_user(session, payload.email, payload.password)
    issue_auth_session(response, session, user, request)
    return {
        "status": "success",
        "user": {"id": user.id, "email": user.email},
    }


@router.post("/api/v1/auth/login")
async def login_v1(
    payload: LoginPayload,
    response: Response,
    request: Request,
    session: Session = Depends(get_session),
):
    try:
        user = _authenticate_user(session, payload.email, payload.password)
    except HTTPException:
        _enforce_login_throttle(request, payload.email)
        raise

    delete_key(_failure_key(request, payload.email))
    issue_auth_session(response, session, user, request)
    return {
        "status": "success",
        "user": {"id": user.id, "email": user.email},
    }


@router.post("/api/v1/auth/refresh")
async def refresh_v1(
    response: Response,
    request: Request,
    session: Session = Depends(get_session),
):
    user = refresh_auth_session(response, request, session)
    return {
        "status": "success",
        "user": {"id": user.id, "email": user.email},
    }


@router.post("/api/v1/auth/logout")
async def logout_v1(
    response: Response,
    request: Request,
    all_sessions: bool = False,
    session: Session = Depends(get_session),
):
    user = None
    try:
        user, _user_session = get_authenticated_session(request, session)
    except HTTPException:
        user = None

    if all_sessions and user:
        revoke_all_user_sessions(session, user)
    else:
        revoke_current_session(request, session)
    clear_auth_cookies(response)
    return {"status": "success"}


@router.get("/api/v1/auth/me")
async def me_v1(current=Depends(get_authenticated_session)):
    user, user_session = current
    return {
        "user": {
            "id": user.id,
            "email": user.email,
        },
        "session": {
            "id": user_session.id,
            "expires_at": user_session.expires_at.isoformat(),
        }
        if user_session
        else None,
    }
