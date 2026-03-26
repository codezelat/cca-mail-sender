import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.models import User, UserSession

try:
    from argon2 import PasswordHasher
    from argon2.exceptions import VerifyMismatchError
except ImportError:  # pragma: no cover - fallback for environments without argon2 installed yet.
    PasswordHasher = None
    VerifyMismatchError = Exception

SECRET_KEY = settings.secret_key
ALGORITHM = settings.jwt_algorithm
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

ACCESS_COOKIE_NAME = "cca_access"
REFRESH_COOKIE_NAME = "cca_refresh"
CSRF_COOKIE_NAME = "cca_csrf"
CSRF_HEADER_NAME = "X-CSRF-Token"

LEGACY_PWD_CONTEXT = CryptContext(schemes=["bcrypt"], deprecated="auto")
PASSWORD_HASHER = PasswordHasher() if PasswordHasher else None


def _truncate_bcrypt_password(value: str) -> str:
    return value.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def _hash_value(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if hashed_password.startswith("$argon2") and PASSWORD_HASHER:
        try:
            return PASSWORD_HASHER.verify(hashed_password, plain_password)
        except VerifyMismatchError:
            return False
    return LEGACY_PWD_CONTEXT.verify(
        _truncate_bcrypt_password(plain_password),
        hashed_password,
    )


def password_needs_rehash(hashed_password: str) -> bool:
    if hashed_password.startswith("$argon2") and PASSWORD_HASHER:
        return PASSWORD_HASHER.check_needs_rehash(hashed_password)
    return True


def get_password_hash(password: str) -> str:
    if not PASSWORD_HASHER:
        return LEGACY_PWD_CONTEXT.hash(_truncate_bcrypt_password(password))
    return PASSWORD_HASHER.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "typ": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


def _get_bearer_token(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


def _get_access_token_from_request(request: Request) -> Optional[str]:
    return _get_bearer_token(request) or request.cookies.get(ACCESS_COOKIE_NAME)


def get_current_user(
    request: Request,
    session: Session = Depends(get_session),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = _get_access_token_from_request(request)
    if not token:
        raise credentials_exception
    try:
        payload = decode_access_token(token)
        email = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        raise credentials_exception
    return user


def get_authenticated_session(
    request: Request,
    session: Session = Depends(get_session),
) -> Tuple[User, Optional[UserSession]]:
    user = get_current_user(request, session)
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if not token:
        return user, None
    try:
        payload = decode_access_token(token)
    except JWTError:
        return user, None
    session_id = payload.get("sid")
    if not session_id:
        return user, None
    user_session = session.get(UserSession, session_id)
    return user, user_session


def _set_cookie(response: Response, key: str, value: str, *, httponly: bool) -> None:
    response.set_cookie(
        key=key,
        value=value,
        httponly=httponly,
        secure=settings.secure_cookies,
        samesite="lax",
        path="/",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
    )


def clear_auth_cookies(response: Response) -> None:
    for cookie_name, httponly in (
        (ACCESS_COOKIE_NAME, True),
        (REFRESH_COOKIE_NAME, True),
        (CSRF_COOKIE_NAME, False),
    ):
        response.delete_cookie(
            cookie_name,
            path="/",
            httponly=httponly,
            secure=settings.secure_cookies,
            samesite="lax",
        )


def _build_refresh_cookie_value(session_id: str, token_secret: str) -> str:
    return f"{session_id}.{token_secret}"


def _parse_refresh_cookie_value(value: str) -> Tuple[str, str]:
    try:
        session_id, token_secret = value.split(".", 1)
    except ValueError as exc:
        raise ValueError("Invalid refresh token format.") from exc
    if not session_id or not token_secret:
        raise ValueError("Invalid refresh token.")
    return session_id, token_secret


def _issue_access_token(user: User, session_id: str) -> str:
    return create_access_token(
        {
            "sub": user.email,
            "uid": user.id,
            "sid": session_id,
        }
    )


def create_user_session(
    session: Session,
    user: User,
    request: Request,
) -> Tuple[UserSession, str, str]:
    refresh_secret = secrets.token_urlsafe(48)
    csrf_token = secrets.token_urlsafe(32)
    user_session = UserSession(
        id=uuid.uuid4().hex,
        user_id=user.id or 0,
        refresh_token_hash=_hash_value(refresh_secret),
        csrf_token_hash=_hash_value(csrf_token),
        token_family=uuid.uuid4().hex,
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
        expires_at=datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        last_seen_at=datetime.utcnow(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(user_session)
    session.commit()
    session.refresh(user_session)
    return user_session, refresh_secret, csrf_token


def set_auth_cookies(
    response: Response,
    *,
    access_token: str,
    refresh_cookie_value: str,
    csrf_token: str,
) -> None:
    _set_cookie(response, ACCESS_COOKIE_NAME, access_token, httponly=True)
    _set_cookie(response, REFRESH_COOKIE_NAME, refresh_cookie_value, httponly=True)
    _set_cookie(response, CSRF_COOKIE_NAME, csrf_token, httponly=False)


def issue_auth_session(
    response: Response,
    session: Session,
    user: User,
    request: Request,
) -> UserSession:
    user_session, refresh_secret, csrf_token = create_user_session(session, user, request)
    access_token = _issue_access_token(user, user_session.id)
    set_auth_cookies(
        response,
        access_token=access_token,
        refresh_cookie_value=_build_refresh_cookie_value(user_session.id, refresh_secret),
        csrf_token=csrf_token,
    )
    return user_session


def refresh_auth_session(
    response: Response,
    request: Request,
    session: Session,
) -> User:
    raw_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        raise HTTPException(status_code=401, detail="Missing refresh session.")

    try:
        session_id, refresh_secret = _parse_refresh_cookie_value(raw_refresh)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user_session = session.get(UserSession, session_id)
    if not user_session or user_session.revoked_at:
        raise HTTPException(status_code=401, detail="Session has been revoked.")
    if user_session.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=401, detail="Session expired.")

    if not hmac.compare_digest(
        user_session.refresh_token_hash,
        _hash_value(refresh_secret),
    ):
        user_session.revoked_at = datetime.utcnow()
        user_session.updated_at = datetime.utcnow()
        session.add(user_session)
        session.commit()
        raise HTTPException(status_code=401, detail="Refresh token mismatch.")

    user = session.get(User, user_session.user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User not found.")

    new_refresh_secret = secrets.token_urlsafe(48)
    csrf_token = secrets.token_urlsafe(32)
    user_session.refresh_token_hash = _hash_value(new_refresh_secret)
    user_session.csrf_token_hash = _hash_value(csrf_token)
    user_session.last_seen_at = datetime.utcnow()
    user_session.updated_at = datetime.utcnow()
    user_session.expires_at = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    session.add(user_session)
    session.commit()

    set_auth_cookies(
        response,
        access_token=_issue_access_token(user, user_session.id),
        refresh_cookie_value=_build_refresh_cookie_value(user_session.id, new_refresh_secret),
        csrf_token=csrf_token,
    )
    return user


def revoke_current_session(request: Request, session: Session) -> None:
    raw_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_refresh:
        return
    try:
        session_id, _ = _parse_refresh_cookie_value(raw_refresh)
    except ValueError:
        return
    user_session = session.get(UserSession, session_id)
    if not user_session:
        return
    user_session.revoked_at = datetime.utcnow()
    user_session.updated_at = datetime.utcnow()
    session.add(user_session)
    session.commit()


def revoke_all_user_sessions(session: Session, user: User) -> None:
    user_sessions = session.exec(
        select(UserSession).where(UserSession.user_id == (user.id or 0))
    ).all()
    now = datetime.utcnow()
    for user_session in user_sessions:
        user_session.revoked_at = now
        user_session.updated_at = now
        session.add(user_session)
    session.commit()


def require_csrf_protection(
    request: Request,
    session: Session = Depends(get_session),
) -> None:
    if _get_bearer_token(request):
        return

    cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
    header_token = request.headers.get(CSRF_HEADER_NAME)
    if not cookie_token or not header_token or cookie_token != header_token:
        raise HTTPException(status_code=403, detail="CSRF validation failed.")

    access_token = request.cookies.get(ACCESS_COOKIE_NAME)
    if not access_token:
        raise HTTPException(status_code=401, detail="Missing access session.")
    try:
        payload = decode_access_token(access_token)
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid access session.") from exc

    session_id = payload.get("sid")
    if not session_id:
        raise HTTPException(status_code=401, detail="Invalid session payload.")

    user_session = session.get(UserSession, session_id)
    if not user_session or user_session.revoked_at:
        raise HTTPException(status_code=401, detail="Session revoked.")
    if not hmac.compare_digest(user_session.csrf_token_hash, _hash_value(header_token)):
        raise HTTPException(status_code=403, detail="CSRF validation failed.")
