from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from fastapi import HTTPException, Response
from jwt import InvalidTokenError

from app.config import get_settings
from app.models import User


class JwtService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.secret = self.settings.jwt_secret or self.settings.app_secret_key
        if not self.secret:
            raise ValueError("JWT secret is required. Set JWT_SECRET or APP_SECRET_KEY.")
        self.algorithm = self.settings.jwt_algorithm
        self.cookie_name = self.settings.jwt_cookie_name

    def issue_token(self, user: User) -> str:
        if not user.id:
            raise ValueError("Cannot issue token without user id")
        now = datetime.now(UTC)
        exp = now + timedelta(minutes=self.settings.jwt_exp_minutes)
        payload = {
            "sub": str(user.id),
            "google_id": user.google_id,
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
        }
        return jwt.encode(payload, self.secret, algorithm=self.algorithm)

    def decode_token(self, token: str) -> dict[str, Any]:
        try:
            payload = jwt.decode(token, self.secret, algorithms=[self.algorithm])
        except InvalidTokenError as exc:
            raise HTTPException(status_code=401, detail="Invalid or expired authentication token") from exc
        return payload

    def set_auth_cookie(self, response: Response, token: str) -> None:
        response.set_cookie(
            key=self.cookie_name,
            value=token,
            httponly=True,
            secure=self.settings.jwt_cookie_secure,
            samesite=self.settings.jwt_cookie_samesite,
            max_age=self.settings.jwt_exp_minutes * 60,
            domain=self.settings.jwt_cookie_domain or None,
            path="/",
        )

    def clear_auth_cookie(self, response: Response) -> None:
        response.delete_cookie(
            key=self.cookie_name,
            domain=self.settings.jwt_cookie_domain or None,
            path="/",
            httponly=True,
            secure=self.settings.jwt_cookie_secure,
            samesite=self.settings.jwt_cookie_samesite,
        )
