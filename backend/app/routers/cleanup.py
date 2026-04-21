import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import CleanupJob, Label, Rule, User
from app.services.ai_service import AIService
from app.services.gmail_service import GmailService, parse_message_details
from app.services.query_utils import build_or_term
from app.services.rule_engine import apply_matching_rules

router = APIRouter(prefix="/api/cleanup", tags=["cleanup"])
log = logging.getLogger("cleanup")


class CleanupCreate(BaseModel):
    label_filter: str | None = None
    sender_filter: str | None = None
    subject_filter: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    action: str  # "delete" | "archive" | "mark_read"


class CleanupOut(BaseModel):
    id: int
    label_filter: str | None
    sender_filter: str | None
    subject_filter: str | None
    date_from: datetime | None
    date_to: datetime | None
    action: str
    status: str
    total_messages: int
    processed_messages: int
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class PreviewRequest(BaseModel):
    label_filter: str | None = None
    sender_filter: str | None = None
    subject_filter: str | None = None
    date_from: str | None = None
    date_to: str | None = None
    action: str | None = None


class PreviewMessageSummary(BaseModel):
    message_id: str
    sender: str
    subject: str
    date: str


class PreviewResponse(BaseModel):
    total_count: int
    messages: list[PreviewMessageSummary]


class RetroactiveRequest(BaseModel):
    date_from: str
    date_to: str
    use_ai: bool = False
    max_messages: int = Field(default=50, ge=1, le=50)


def _build_cleanup_query(
    label_filter: str | None,
    date_from: str | None,
    date_to: str | None,
    sender_filter: str | None = None,
    subject_filter: str | None = None,
) -> str:
    query_parts: list[str] = []
    if label_filter:
        query_parts.append(f"label:{label_filter.replace(' ', '-')}")
    if sender_filter:
        query_parts.append(build_or_term("from", sender_filter))
    if subject_filter:
        query_parts.append(build_or_term("subject", subject_filter))
    if date_from:
        query_parts.append(f"after:{date_from[:10]}")
    if date_to:
        query_parts.append(f"before:{date_to[:10]}")
    return " ".join(query_parts) if query_parts else ""


@router.post("/preview")
def preview_cleanup(
    body: PreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> PreviewResponse:
    gmail = GmailService(db)
    query = _build_cleanup_query(
        body.label_filter, body.date_from, body.date_to,
        sender_filter=body.sender_filter, subject_filter=body.subject_filter,
    )
    all_msg_ids: list[str] = []
    page_token = None
    while True:
        result = gmail.list_messages(user, query=query, max_results=100, page_token=page_token)
        messages = result.get("messages", [])
        all_msg_ids.extend(m["id"] for m in messages)
        page_token = result.get("nextPageToken")
        if not page_token or not messages:
            break

    total_count = len(all_msg_ids)
    detail_ids = all_msg_ids[:500]
    summaries: list[PreviewMessageSummary] = []
    for msg_id in detail_ids:
        try:
            meta = gmail.get_message_metadata(user, msg_id)
            summaries.append(PreviewMessageSummary(**meta))
        except Exception:
            log.warning("Failed to fetch metadata for msg=%s", msg_id)

    return PreviewResponse(total_count=total_count, messages=summaries)


@router.post("/retroactive")
def retroactive_classification(
    body: RetroactiveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict:
    gmail = GmailService(db)

    # Process Primary inbox emails (read and unread)
    query = (
        f"in:inbox -category:promotions -category:social -category:updates -category:forums "
        f"after:{body.date_from[:10]} before:{body.date_to[:10]}"
    )

    rules = db.scalars(
        select(Rule)
        .where(Rule.user_id == user.id, Rule.enabled == True)  # noqa: E712
        .order_by(Rule.priority.asc(), Rule.created_at.asc())
    ).all()

    ai_service = None
    if body.use_ai and user.ai_enabled and user.ai_api_key:
        ai_service = AIService(user.ai_api_key)

    user_labels = db.scalars(
        select(Label).where(Label.user_id == user.id, Label.label_type == "user")
    ).all()
    available_labels = [
        {"id": l.gmail_label_id, "name": l.name, "description": l.ai_description}
        for l in user_labels
    ]
    label_name_by_id = {l.gmail_label_id: l.name for l in user_labels}

    total_processed = 0
    rule_matched_count = 0
    ai_classified_count = 0

    page_token = None
    while True:
        remaining = body.max_messages - total_processed
        if remaining <= 0:
            break
        result = gmail.list_messages(
            user,
            query=query,
            max_results=min(50, remaining),
            page_token=page_token,
        )
        messages = result.get("messages", [])
        if not messages:
            break

        for msg_ref in messages:
            if total_processed >= body.max_messages:
                break
            try:
                raw_msg = gmail.get_message(user, msg_ref["id"])
                details = parse_message_details(raw_msg)

                total_processed += 1

                matched_rule_ids = apply_matching_rules(
                    rules,
                    msg_ref["id"],
                    details,
                    gmail,
                    user,
                    db,
                )
                matched = bool(matched_rule_ids)
                if matched:
                    rule_matched_count += 1

                # AI fallback
                if not matched and ai_service and available_labels:
                    label_id = ai_service.classify_email(
                        details["from"], details["subject"], details["body"],
                        available_labels,
                    )
                    if label_id:
                        gmail.modify_message(
                            user,
                            msg_ref["id"],
                            add_labels=[label_id],
                        )
                        ai_classified_count += 1

            except Exception as exc:
                log.error("Retroactive processing failed for msg=%s: %s", msg_ref["id"], exc)

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    log.info(
        "Retroactive classification: processed=%d rule_matched=%d ai_classified=%d max=%d",
        total_processed, rule_matched_count, ai_classified_count, body.max_messages,
    )
    return {
        "total_processed": total_processed,
        "rule_matched": rule_matched_count,
        "ai_classified": ai_classified_count,
        "max_messages": body.max_messages,
    }


@router.post("")
def start_cleanup(
    body: CleanupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> CleanupOut:
    if body.action not in ("delete", "archive", "mark_read"):
        raise HTTPException(status_code=400, detail="Action must be delete, archive, or mark_read")

    job = CleanupJob(
        user_id=user.id,
        label_filter=body.label_filter,
        sender_filter=body.sender_filter,
        subject_filter=body.subject_filter,
        date_from=datetime.fromisoformat(body.date_from) if body.date_from else None,
        date_to=datetime.fromisoformat(body.date_to) if body.date_to else None,
        action=body.action,
        status="running",
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    gmail = GmailService(db)
    query = _build_cleanup_query(
        body.label_filter, body.date_from, body.date_to,
        sender_filter=body.sender_filter, subject_filter=body.subject_filter,
    )
    total_processed = 0

    try:
        page_token = None
        while True:
            result = gmail.list_messages(user, query=query, max_results=100, page_token=page_token)
            messages = result.get("messages", [])
            if not messages:
                break

            msg_ids = [m["id"] for m in messages]
            job.total_messages += len(msg_ids)

            if body.action == "delete":
                gmail.batch_trash_messages(user, msg_ids)
            elif body.action == "archive":
                gmail.batch_modify_messages(user, msg_ids, remove_labels=["INBOX"])
            elif body.action == "mark_read":
                gmail.batch_modify_messages(user, msg_ids, remove_labels=["UNREAD"])

            total_processed += len(msg_ids)
            job.processed_messages = total_processed
            db.commit()

            page_token = result.get("nextPageToken")
            if not page_token:
                break

        job.status = "completed"
        job.completed_at = datetime.now(timezone.utc)
    except Exception as exc:
        job.status = "failed"
        log.error("Cleanup job %d failed: %s", job.id, exc)

    db.commit()
    db.refresh(job)
    log.info("Cleanup job %d: action=%s processed=%d status=%s", job.id, body.action, total_processed, job.status)
    return CleanupOut.model_validate(job)


@router.get("")
def list_cleanups(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> list[CleanupOut]:
    jobs = db.scalars(
        select(CleanupJob).where(CleanupJob.user_id == user.id).order_by(CleanupJob.created_at.desc())
    ).all()
    return [CleanupOut.model_validate(j) for j in jobs]


@router.get("/{job_id}")
def get_cleanup(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> CleanupOut:
    job = db.scalar(select(CleanupJob).where(CleanupJob.id == job_id, CleanupJob.user_id == user.id).limit(1))
    if not job:
        raise HTTPException(status_code=404, detail="Cleanup job not found")
    return CleanupOut.model_validate(job)
