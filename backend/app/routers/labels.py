import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import Label, User
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/api/labels", tags=["labels"])
log = logging.getLogger("labels")


class LabelCreate(BaseModel):
    name: str
    bg_color: str | None = None
    text_color: str | None = None


class LabelUpdate(BaseModel):
    name: str | None = None
    bg_color: str | None = None
    text_color: str | None = None


class LabelOut(BaseModel):
    id: int
    gmail_label_id: str
    name: str
    label_type: str
    color_bg: str | None
    color_text: str | None
    message_count: int
    unread_count: int
    synced_at: str | None

    model_config = {"from_attributes": True}


@router.get("")
def list_labels(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> list[LabelOut]:
    labels = db.scalars(select(Label).where(Label.user_id == user.id).order_by(Label.name)).all()
    return [LabelOut.model_validate(l) for l in labels]


@router.post("/sync")
def sync_labels(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    gmail = GmailService(db)
    remote_labels = gmail.list_labels(user)

    synced = 0
    now = datetime.now(timezone.utc)
    seen_ids: set[str] = set()

    for rl in remote_labels:
        gmail_id = rl["id"]
        seen_ids.add(gmail_id)

        # Get detailed label info for counts
        try:
            detail = gmail.get_label(user, gmail_id)
        except Exception:
            detail = rl

        label = db.scalar(select(Label).where(Label.gmail_label_id == gmail_id).limit(1))
        if not label:
            label = Label(user_id=user.id, gmail_label_id=gmail_id)
            db.add(label)

        label.name = rl.get("name", gmail_id)
        label.label_type = rl.get("type", "user").lower()
        color = rl.get("color", {})
        label.color_bg = color.get("backgroundColor")
        label.color_text = color.get("textColor")
        label.message_count = detail.get("messagesTotal", 0)
        label.unread_count = detail.get("messagesUnread", 0)
        label.synced_at = now
        synced += 1

    # Remove labels no longer in Gmail
    existing = db.scalars(select(Label).where(Label.user_id == user.id)).all()
    for label in existing:
        if label.gmail_label_id not in seen_ids:
            db.delete(label)

    db.commit()
    log.info("Synced %d labels for user=%s", synced, user.email)
    return {"synced": synced}


@router.post("")
def create_label(
    body: LabelCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> LabelOut:
    gmail = GmailService(db)
    result = gmail.create_label(user, body.name, body.bg_color, body.text_color)

    label = Label(
        user_id=user.id,
        gmail_label_id=result["id"],
        name=result.get("name", body.name),
        label_type="user",
        color_bg=body.bg_color,
        color_text=body.text_color,
        synced_at=datetime.now(timezone.utc),
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    log.info("Created label '%s' for user=%s", body.name, user.email)
    return LabelOut.model_validate(label)


@router.patch("/{label_id}")
def patch_label(
    label_id: int,
    body: LabelUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> LabelOut:
    label = db.scalar(select(Label).where(Label.id == label_id, Label.user_id == user.id).limit(1))
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label.label_type == "system":
        raise HTTPException(status_code=400, detail="Cannot edit system labels")

    gmail = GmailService(db)
    gmail.update_label(user, label.gmail_label_id, name=body.name, bg_color=body.bg_color, text_color=body.text_color)

    if body.name is not None:
        label.name = body.name
    if body.bg_color is not None:
        label.color_bg = body.bg_color
    if body.text_color is not None:
        label.color_text = body.text_color
    db.commit()
    db.refresh(label)
    log.info("Updated label '%s' for user=%s", label.name, user.email)
    return LabelOut.model_validate(label)


@router.delete("/{label_id}")
def delete_label(
    label_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    label = db.scalar(select(Label).where(Label.id == label_id, Label.user_id == user.id).limit(1))
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label.label_type == "system":
        raise HTTPException(status_code=400, detail="Cannot delete system labels")

    gmail = GmailService(db)
    gmail.delete_label(user, label.gmail_label_id)
    db.delete(label)
    db.commit()
    log.info("Deleted label '%s' for user=%s", label.name, user.email)
    return {"deleted": True}
