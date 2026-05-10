import logging
from datetime import datetime, timezone, date as date_type

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import CleanupJob, RetroactiveClassificationJob, User
from app.services.gmail_service import GmailService
from app.services.query_utils import build_or_term

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


class RetroactiveJobCreate(BaseModel):
    date_from: str
    date_to: str
    use_ai: bool = False


class RetroactiveJobOut(BaseModel):
    id: int
    date_from: date_type
    date_to: date_type
    use_ai: bool
    status: str
    page_token: str | None
    processed_count: int
    rule_matched_count: int
    ai_classified_count: int
    ai_trash_count: int
    ai_temporary_count: int
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class RetroactiveJobCreateResponse(BaseModel):
    job_id: int


def _parse_iso_date(raw: str) -> date_type:
    return date_type.fromisoformat(raw.strip()[:10])


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
def create_retroactive_job(
    body: RetroactiveJobCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RetroactiveJobCreateResponse:
    date_from_d = _parse_iso_date(body.date_from)
    date_to_d = _parse_iso_date(body.date_to)

    blocked = db.scalar(
        select(RetroactiveClassificationJob.id)
        .where(
            RetroactiveClassificationJob.user_id == user.id,
            RetroactiveClassificationJob.status.in_(("pending", "running")),
        )
        .limit(1)
    )
    if blocked:
        raise HTTPException(
            status_code=409,
            detail="A retroactive classification job is already queued or running for this account.",
        )

    job = RetroactiveClassificationJob(
        user_id=user.id,
        date_from=date_from_d,
        date_to=date_to_d,
        use_ai=body.use_ai,
        status="pending",
        page_token=None,
        processed_count=0,
        rule_matched_count=0,
        ai_classified_count=0,
        ai_trash_count=0,
        ai_temporary_count=0,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    log.info("Retroactive classification job queued id=%s user=%s", job.id, user.email)
    return RetroactiveJobCreateResponse(job_id=job.id)


@router.get("/retroactive", response_model=list[RetroactiveJobOut])
def list_retroactive_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
    limit: int = 100,
) -> list[RetroactiveJobOut]:
    capped = max(1, min(limit, 100))
    jobs = db.scalars(
        select(RetroactiveClassificationJob)
        .where(RetroactiveClassificationJob.user_id == user.id)
        .order_by(RetroactiveClassificationJob.created_at.desc())
        .limit(capped)
    ).all()
    return [RetroactiveJobOut.model_validate(j) for j in jobs]


@router.get("/retroactive/{job_id}")
def get_retroactive_job(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> RetroactiveJobOut:
    job = db.scalar(
        select(RetroactiveClassificationJob).where(
            RetroactiveClassificationJob.id == job_id,
            RetroactiveClassificationJob.user_id == user.id,
        ).limit(1)
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return RetroactiveJobOut.model_validate(job)


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
