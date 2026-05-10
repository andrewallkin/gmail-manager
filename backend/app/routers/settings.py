import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import SystemLabelRetention, User
from app.services.triage import get_triage_labels

router = APIRouter(prefix="/api/settings", tags=["settings"])
log = logging.getLogger("settings")


class SettingsOut(BaseModel):
    connected: bool
    email: str | None
    display_name: str | None
    profile_picture_url: str | None
    ai_enabled: bool
    ai_provider: str | None
    ai_api_key_configured: bool
    auto_remove_inbox_labeled_read: bool
    polling_enabled: bool
    polling_interval_minutes: int
    google_auth_broken: bool
    triage_labels_ok: bool

    model_config = {"from_attributes": True}


class SettingsUpdate(BaseModel):
    ai_enabled: bool | None = None
    ai_provider: str | None = None
    ai_api_key: str | None = None
    auto_remove_inbox_labeled_read: bool | None = None
    polling_enabled: bool | None = None
    polling_interval_minutes: int | None = None


class RetentionItem(BaseModel):
    category: str
    retention_days: int
    enabled: bool


class RetentionOut(BaseModel):
    items: list[RetentionItem]


class RetentionUpdate(BaseModel):
    items: list[RetentionItem]


def _settings_out(user: User, db: Session) -> SettingsOut:
    triage_labels_ok = get_triage_labels(db, user.id) is not None
    return SettingsOut(
        connected=user.google_id is not None,
        email=user.email,
        display_name=user.display_name,
        profile_picture_url=user.profile_picture_url,
        ai_enabled=user.ai_enabled,
        ai_provider=user.ai_provider,
        ai_api_key_configured=bool(user.ai_api_key),
        auto_remove_inbox_labeled_read=user.auto_remove_inbox_labeled_read,
        polling_enabled=user.polling_enabled,
        polling_interval_minutes=user.polling_interval_minutes,
        google_auth_broken=user.google_auth_broken,
        triage_labels_ok=triage_labels_ok,
    )


@router.get("")
def get_settings(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> SettingsOut:
    return _settings_out(user, db)


@router.patch("")
def update_settings(
    body: SettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> SettingsOut:
    if body.ai_enabled is not None:
        user.ai_enabled = body.ai_enabled
    if body.ai_provider is not None:
        user.ai_provider = body.ai_provider
    if body.ai_api_key is not None:
        user.ai_api_key = body.ai_api_key
    if body.auto_remove_inbox_labeled_read is not None:
        user.auto_remove_inbox_labeled_read = body.auto_remove_inbox_labeled_read
    if body.polling_enabled is not None:
        user.polling_enabled = body.polling_enabled
    if body.polling_interval_minutes is not None:
        user.polling_interval_minutes = max(1, min(60, body.polling_interval_minutes))
    db.commit()
    db.refresh(user)
    log.info("Settings updated for user=%s", user.email)
    return _settings_out(user, db)


VALID_CATEGORIES = {"promotions", "social", "updates", "forums"}


@router.get("/retention")
def get_retention(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RetentionOut:
    retentions = db.scalars(
        select(SystemLabelRetention).where(SystemLabelRetention.user_id == user.id)
    ).all()

    items = []
    existing = {r.category: r for r in retentions}
    for cat in ["promotions", "social", "updates", "forums"]:
        if cat in existing:
            r = existing[cat]
            items.append(RetentionItem(category=r.category, retention_days=r.retention_days, enabled=r.enabled))
        else:
            items.append(RetentionItem(category=cat, retention_days=30, enabled=False))

    return RetentionOut(items=items)


@router.put("/retention")
def update_retention(
    body: RetentionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RetentionOut:
    for item in body.items:
        if item.category not in VALID_CATEGORIES:
            continue
        existing = db.scalar(
            select(SystemLabelRetention).where(
                SystemLabelRetention.user_id == user.id,
                SystemLabelRetention.category == item.category,
            ).limit(1)
        )
        if existing:
            existing.retention_days = item.retention_days
            existing.enabled = item.enabled
        else:
            db.add(SystemLabelRetention(
                user_id=user.id,
                category=item.category,
                retention_days=item.retention_days,
                enabled=item.enabled,
            ))
    db.commit()
    log.info("Retention settings updated for user=%s", user.email)
    return get_retention(db=db, user=user)
