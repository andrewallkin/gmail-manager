import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User

log = logging.getLogger("auth")

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"


class GoogleService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def auth_url(self) -> str:
        redirect_uri = self.settings.public_base_url.rstrip("/") + "/api/auth/google/callback"
        params = {
            "client_id": self.settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": self.settings.google_scopes,
            "access_type": "offline",
            "prompt": "consent",
        }
        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"

    def exchange_code_for_token(self, db: Session, code: str) -> User:
        if not self.settings.google_allowed_email:
            raise HTTPException(
                status_code=500,
                detail="GOOGLE_ALLOWED_EMAIL must be configured for single-user mode",
            )

        redirect_uri = self.settings.public_base_url.rstrip("/") + "/api/auth/google/callback"
        resp = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
            timeout=20,
        )
        resp.raise_for_status()
        token_data = resp.json()

        access_token = token_data["access_token"]
        refresh_token = token_data.get("refresh_token")
        expires_in = token_data.get("expires_in", 3600)

        # Fetch user info
        info_resp = httpx.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=20,
        )
        info_resp.raise_for_status()
        user_info = info_resp.json()

        email = user_info.get("email", "")
        if email.lower() != self.settings.google_allowed_email.lower():
            raise HTTPException(status_code=403, detail="Unauthorized email address")

        google_id = user_info["id"]
        user = db.scalar(select(User).where(User.google_id == google_id).limit(1))
        if not user:
            # Single-user mode: reconnect should reuse the same local user row.
            user = db.scalar(
                select(User).where(func.lower(User.email) == email.lower()).limit(1)
            )
        if not user:
            user = User(google_id=google_id)
            db.add(user)

        user.google_id = google_id
        user.email = email
        user.display_name = user_info.get("name")
        user.profile_picture_url = user_info.get("picture")
        user.access_token = access_token
        if refresh_token:
            user.refresh_token = refresh_token
        user.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        db.commit()
        db.refresh(user)
        return user

    def ensure_fresh_token(self, db: Session, user: User) -> User:
        if not user.token_expiry or not user.refresh_token:
            return user

        now = datetime.now(timezone.utc)
        expiry = user.token_expiry
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if now < expiry:
            return user

        resp = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": self.settings.google_client_id,
                "client_secret": self.settings.google_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": user.refresh_token,
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()

        user.access_token = data["access_token"]
        expires_in = data.get("expires_in", 3600)
        user.token_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        if "refresh_token" in data:
            user.refresh_token = data["refresh_token"]

        db.commit()
        db.refresh(user)
        log.info("Refreshed Google token for user=%s", user.email)
        return user
