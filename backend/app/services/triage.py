"""Triage bucket labels — exact Gmail label names."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Label, User
from app.services.gmail_service import GmailService

TRIAGE_LABEL_TRASH_NAME = "Action/Triage-Trash"
TRIAGE_LABEL_TEMPORARY_NAME = "Action/Triage-Temporary"


def get_triage_labels(db: Session, user_id: int) -> tuple[Label, Label] | None:
    """Resolve both triage rows by exact `Label.name`; missing either → None."""
    trash = db.scalar(
        select(Label).where(
            Label.user_id == user_id,
            Label.name == TRIAGE_LABEL_TRASH_NAME,
        ).limit(1)
    )
    temporary = db.scalar(
        select(Label).where(
            Label.user_id == user_id,
            Label.name == TRIAGE_LABEL_TEMPORARY_NAME,
        ).limit(1)
    )
    if not trash or not temporary:
        return None
    return (trash, temporary)


def is_triage_label_name(name: str) -> bool:
    return name.startswith("Action/Triage-")


def ensure_gmail_triage_labels(gmail: GmailService, user: User) -> None:
    """Create missing Action/Triage-* labels on Gmail side (Option B UX)."""
    remote = gmail.list_labels(user)
    names = {
        rl.get("name")
        for rl in remote
        if rl.get("type", "user").lower() == "user"
    }
    for canonical in (TRIAGE_LABEL_TRASH_NAME, TRIAGE_LABEL_TEMPORARY_NAME):
        if canonical not in names:
            gmail.create_label(user, canonical)
