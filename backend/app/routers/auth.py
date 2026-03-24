import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.deps import require_jwt_user
from app.models import User
from app.services.google_service import GoogleService
from app.services.jwt_service import JwtService

router = APIRouter(prefix="/api/auth/google", tags=["auth"])
logout_router = APIRouter(prefix="/api/auth", tags=["auth"])

log = logging.getLogger("auth")


@logout_router.post("/login")
def login(response: Response, db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    user = db.scalar(
        select(User).where(User.google_id.isnot(None), User.refresh_token.isnot(None)).limit(1)
    )
    if not user:
        raise HTTPException(status_code=404, detail="No connected user")
    if settings.google_allowed_email and user.email and user.email.lower() != settings.google_allowed_email.lower():
        raise HTTPException(status_code=401, detail="Unauthorized email")

    jwt_service = JwtService()
    jwt_service.set_auth_cookie(response, jwt_service.issue_token(user))
    log.info("Login successful | user=%s", user.display_name or user.email)
    return {"ok": True}


@router.get("/connect")
def connect() -> RedirectResponse:
    service = GoogleService()
    return RedirectResponse(url=service.auth_url())


@router.get("/callback")
def callback(
    code: str = Query(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    settings = get_settings()
    base_url = (settings.frontend_base_url or settings.public_base_url).rstrip("/") or ""
    try:
        service = GoogleService()
        user = service.exchange_code_for_token(db, code)
        log.info("Google OAuth connected | user=%s email=%s", user.display_name, user.email)
    except HTTPException:
        raise
    except Exception as exc:
        log.error("Google OAuth exchange failed: %s", exc)
        params = urlencode({"google": "error", "message": str(exc)[:200]})
        return RedirectResponse(url=f"{base_url}/?{params}")

    response = RedirectResponse(url=f"{base_url}/?google=connected")
    jwt_service = JwtService()
    jwt_service.set_auth_cookie(response, jwt_service.issue_token(user))
    return response


@logout_router.post("/logout")
def logout(response: Response) -> dict:
    jwt_service = JwtService()
    jwt_service.clear_auth_cookie(response)
    log.info("User logged out")
    return {"logged_out": True}


@router.delete("/disconnect")
def disconnect_google(
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    user_name = user.display_name or user.email
    user.google_id = None
    user.access_token = None
    user.refresh_token = None
    user.token_expiry = None
    user.polling_enabled = False
    user.last_history_id = None
    log.info("Google disconnected | user=%s", user_name)
    db.commit()
    jwt_service = JwtService()
    jwt_service.clear_auth_cookie(response)
    return {"disconnected": True}
