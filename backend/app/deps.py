from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import User
from app.services.jwt_service import JwtService


def require_jwt_payload(request: Request) -> dict:
    """Validate JWT from auth cookie and return payload."""
    settings = get_settings()
    token = request.cookies.get(settings.jwt_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Session expired or not authenticated")
    service = JwtService()
    return service.decode_token(token)


def require_jwt_user(
    payload: dict = Depends(require_jwt_payload),
    db: Session = Depends(get_db),
) -> User:
    sub = payload.get("sub")
    try:
        user_id = int(sub)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    user = db.scalar(select(User).where(User.id == user_id).limit(1))
    if not user:
        raise HTTPException(status_code=401, detail="Authenticated user not found")
    return user
