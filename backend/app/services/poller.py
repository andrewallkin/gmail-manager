import logging
import threading
from datetime import datetime, timedelta, timezone
from time import perf_counter
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Label, RetroactiveClassificationJob, Rule, SystemLabelRetention, User
from app.services.ai_service import AIService
from app.services.gmail_service import GmailService, parse_message_details
from app.services.message_pipeline import process_message_rules_and_triage
from app.services.triage import get_triage_labels

log = logging.getLogger("poller")

_timer: threading.Timer | None = None
_running = False
_last_poll_per_user: dict[int, datetime] = {}

POLL_INTERVAL_SECONDS = 60
RETRO_CLASSIFICATION_MESSAGES_PER_TICK = 35


def _build_retro_inbox_query(date_from, date_to) -> str:  # type: ignore[no-untyped-def]
    ds = date_from.strftime("%Y/%m/%d")
    de = date_to.strftime("%Y/%m/%d")
    return f"in:inbox after:{ds} before:{de}"


def _advance_retroactive_classification_jobs(
    user: User,
    gmail: GmailService,
    db,
    *,
    cycle_id: str,
) -> None:
    """Process one paginated chunk of the user's retro classification job."""
    log_retro = logging.getLogger("cleanup")
    job = db.scalar(
        select(RetroactiveClassificationJob)
        .where(
            RetroactiveClassificationJob.user_id == user.id,
            RetroactiveClassificationJob.status.in_(("pending", "running")),
        )
        .order_by(RetroactiveClassificationJob.id.asc())
        .limit(1)
    )
    if not job:
        return

    job_id_early = job.id

    rules = db.scalars(
        select(Rule)
        .where(Rule.user_id == user.id, Rule.enabled == True)  # noqa: E712
        .order_by(Rule.priority.asc(), Rule.created_at.asc())
    ).all()
    triage_labels = get_triage_labels(db, user.id)
    user_ai_allowed = bool(user.ai_enabled and user.ai_api_key)
    ai_service = AIService(user.ai_api_key) if user_ai_allowed else None

    try:
        if job.status == "pending":
            job.status = "running"

        query = _build_retro_inbox_query(job.date_from, job.date_to)

        log_retro.info(
            "event=retro_job_batch_started cycle_id=%s user=%s job_id=%s processed_count=%s has_page_token=%s",
            cycle_id,
            user.email,
            job.id,
            job.processed_count,
            bool(job.page_token),
        )

        try:
            result = gmail.list_messages(
                user,
                query=query,
                max_results=RETRO_CLASSIFICATION_MESSAGES_PER_TICK,
                page_token=job.page_token,
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                log_retro.warning(
                    "event=retro_job_throttled cycle_id=%s user=%s job_id=%s",
                    cycle_id,
                    user.email,
                    job.id,
                )
                db.commit()
                return
            raise

        messages = result.get("messages") or []
        next_page_token = result.get("nextPageToken")

        retro_skip_ai = not job.use_ai
        ai_for_pipe = ai_service if not retro_skip_ai else None
        allowed_ai = user_ai_allowed and not retro_skip_ai

        processed_this_batch = 0
        rule_matched_this_batch = 0
        ai_this_batch = 0

        for msg_ref in messages:
            mid = msg_ref["id"]
            try:
                raw_msg = gmail.get_message(user, mid)
                details = parse_message_details(raw_msg)
                out = process_message_rules_and_triage(
                    log=log_retro,
                    gmail=gmail,
                    user=user,
                    db=db,
                    msg_id=mid,
                    details=details,
                    rules=rules,
                    triage_labels=triage_labels,
                    ai_service=ai_for_pipe,
                    user_ai_allowed=allowed_ai,
                    retro_skip_ai=retro_skip_ai,
                    cycle_id=cycle_id,
                    job_id=job.id,
                )
                processed_this_batch += 1
                if out.kind == "rule_applied":
                    rule_matched_this_batch += 1
                if out.kind == "ai_triage":
                    ai_this_batch += 1
            except Exception as exc:
                log_retro.exception(
                    "event=retro_job_message_failed cycle_id=%s job_id=%s msg_id=%s error=%s",
                    cycle_id,
                    job.id,
                    mid,
                    exc,
                )
                job.status = "failed"
                job.error_message = str(exc)
                job.completed_at = datetime.now(timezone.utc)
                db.commit()
                return

        job.processed_count += processed_this_batch
        job.rule_matched_count += rule_matched_this_batch
        job.ai_classified_count += ai_this_batch
        job.page_token = next_page_token

        if not messages:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.page_token = None
        elif not next_page_token:
            job.status = "completed"
            job.completed_at = datetime.now(timezone.utc)
            job.page_token = None

        db.commit()
        log_retro.info(
            "event=retro_job_batch_finished cycle_id=%s user=%s job_id=%s batch_processed=%d "
            "page_token_kept=%s job_status=%s",
            cycle_id,
            user.email,
            job.id,
            processed_this_batch,
            bool(job.page_token) if job.status == "running" else False,
            job.status,
        )
    except Exception as exc:
        log_retro.error(
            "event=retro_job_failed cycle_id=%s user=%s job_id=%s error=%s",
            cycle_id,
            user.email,
            job.id,
            exc,
        )
        db.rollback()
        job_row = db.get(RetroactiveClassificationJob, job_id_early)
        if job_row is not None and job_row.status not in ("completed", "failed"):
            job_row.status = "failed"
            job_row.error_message = str(exc)
            job_row.completed_at = datetime.now(timezone.utc)
            db.commit()


def start_poller() -> None:
    global _running
    _running = True
    log.info("Poller started")
    _schedule_next()


def stop_poller() -> None:
    global _running, _timer
    _running = False
    if _timer:
        _timer.cancel()
        _timer = None
    log.info("Poller stopped")


def _schedule_next() -> None:
    global _timer
    if not _running:
        return
    _timer = threading.Timer(POLL_INTERVAL_SECONDS, _poll_tick)
    _timer.daemon = True
    _timer.start()


def _poll_tick() -> None:
    if not _running:
        return
    try:
        _run_poll_cycle()
    except Exception as exc:
        log.error("Poll cycle error: %s", exc)
    finally:
        _schedule_next()


def _run_poll_cycle() -> None:
    cycle_id = uuid4().hex[:12]
    cycle_started_at = perf_counter()
    db: Session = SessionLocal()
    try:
        users = db.scalars(
            select(User).where(
                User.polling_enabled == True,  # noqa: E712
                User.google_auth_broken == False,  # noqa: E712
                User.google_id.isnot(None),
                User.access_token.isnot(None),
                User.refresh_token.isnot(None),
            )
        ).all()
        now = datetime.now(timezone.utc)
        eligible_users = len(users)
        processed_users = 0
        skipped_interval_users = 0
        failed_users = 0

        log.info("event=poll_cycle_started cycle_id=%s eligible_users=%d", cycle_id, eligible_users)
        if not users:
            log.info("event=poll_cycle_no_eligible_users cycle_id=%s", cycle_id)

        for user in users:
            last_poll = _last_poll_per_user.get(user.id)
            interval = timedelta(minutes=user.polling_interval_minutes)
            if last_poll and (now - last_poll) < interval:
                skipped_interval_users += 1
                log.info(
                    "event=poll_user_skipped_interval cycle_id=%s user=%s user_id=%s interval_minutes=%d seconds_since_last_poll=%.2f",
                    cycle_id,
                    user.email,
                    user.id,
                    user.polling_interval_minutes,
                    (now - last_poll).total_seconds(),
                )
                continue

            _last_poll_per_user[user.id] = now
            try:
                _poll_user(user, db, cycle_id=cycle_id)
                processed_users += 1
            except httpx.HTTPStatusError as exc:
                failed_users += 1
                if exc.response.status_code == 401:
                    user.google_auth_broken = True
                    db.commit()
                    _last_poll_per_user.pop(user.id, None)
                    log.warning(
                        "event=poll_user_failed_auth_401 cycle_id=%s user=%s user_id=%s action=marked_google_auth_broken",
                        cycle_id,
                        user.email,
                        user.id,
                    )
                else:
                    log.error(
                        "event=poll_user_failed cycle_id=%s user=%s user_id=%s error=%s",
                        cycle_id,
                        user.email,
                        user.id,
                        exc,
                    )
            except Exception as exc:
                failed_users += 1
                log.error(
                    "event=poll_user_failed cycle_id=%s user=%s user_id=%s error=%s",
                    cycle_id,
                    user.email,
                    user.id,
                    exc,
                )
    finally:
        duration_ms = int((perf_counter() - cycle_started_at) * 1000)
        log.info(
            "event=poll_cycle_finished cycle_id=%s eligible_users=%d processed_users=%d skipped_interval_users=%d failed_users=%d duration_ms=%d",
            cycle_id,
            locals().get("eligible_users", 0),
            locals().get("processed_users", 0),
            locals().get("skipped_interval_users", 0),
            locals().get("failed_users", 0),
            duration_ms,
        )
        db.close()


def _poll_user(user: User, db: Session, cycle_id: str = "manual") -> None:
    user_started_at = perf_counter()
    gmail = GmailService(db)
    new_msg_ids: set[str] = set()
    rules_loaded = 0
    message_processed = 0
    message_rule_applied = 0
    message_ai_triage = 0
    message_skipped_no_inbox = 0
    message_triage_labels_missing = 0
    message_ai_disabled = 0
    message_missing = 0
    message_error = 0
    history_records_count = 0
    history_pages = 0
    new_history_id = None

    log.info(
        "event=poll_user_started cycle_id=%s user=%s user_id=%s interval_minutes=%d last_history_id=%s",
        cycle_id,
        user.email,
        user.id,
        user.polling_interval_minutes,
        user.last_history_id or "none",
    )

    # Initialize history_id if not set
    if not user.last_history_id:
        profile = gmail.get_profile(user)
        user.last_history_id = str(profile.get("historyId", ""))
        db.commit()
        log.info(
            "event=poll_user_initialized_history cycle_id=%s user=%s user_id=%s history_id=%s",
            cycle_id,
            user.email,
            user.id,
            user.last_history_id or "none",
        )
        log.info(
            "event=poll_user_finished cycle_id=%s user=%s user_id=%s new_messages=0 rules_loaded=0 message_processed=0 duration_ms=%d",
            cycle_id,
            user.email,
            user.id,
            int((perf_counter() - user_started_at) * 1000),
        )
        return

    # Get new messages since last history ID
    try:
        history_records: list[dict] = []
        next_page_token = None
        while True:
            history = gmail.history_list(
                user,
                user.last_history_id,
                page_token=next_page_token,
            )
            history_pages += 1
            page_history_id = history.get("historyId")
            if page_history_id:
                new_history_id = page_history_id
            history_records.extend(history.get("history", []))
            next_page_token = history.get("nextPageToken")
            if not next_page_token:
                break
        history_records_count = len(history_records)
        log.info(
            "event=history_fetch_completed cycle_id=%s user=%s user_id=%s pages=%d records=%d last_history_id=%s new_history_id=%s",
            cycle_id,
            user.email,
            user.id,
            history_pages,
            history_records_count,
            user.last_history_id,
            str(new_history_id) if new_history_id else "none",
        )
    except Exception as exc:
        # 404 means history ID is too old, reset it
        if "404" in str(exc):
            profile = gmail.get_profile(user)
            user.last_history_id = str(profile.get("historyId", ""))
            db.commit()
            log.warning(
                "event=history_id_expired_reset cycle_id=%s user=%s user_id=%s new_history_id=%s",
                cycle_id,
                user.email,
                user.id,
                user.last_history_id or "none",
            )
            log.info(
                "event=poll_user_finished cycle_id=%s user=%s user_id=%s new_messages=0 rules_loaded=0 message_processed=0 duration_ms=%d",
                cycle_id,
                user.email,
                user.id,
                int((perf_counter() - user_started_at) * 1000),
            )
            return
        raise

    if not history_records:
        log.info(
            "event=poll_user_no_history_records cycle_id=%s user=%s user_id=%s",
            cycle_id,
            user.email,
            user.id,
        )

    # Collect new message IDs
    for record in history_records:
        for added in record.get("messagesAdded", []):
            msg = added.get("message", {})
            new_msg_ids.add(msg["id"])

    if not new_msg_ids:
        log.info(
            "event=poll_user_no_new_messages cycle_id=%s user=%s user_id=%s history_records=%d",
            cycle_id,
            user.email,
            user.id,
            history_records_count,
        )

    rules = db.scalars(
        select(Rule)
        .where(Rule.user_id == user.id, Rule.enabled == True)  # noqa: E712
        .order_by(Rule.priority.asc(), Rule.created_at.asc())
    ).all()
    rules_loaded = len(rules)
    if not rules:
        log.info(
            "event=poll_user_no_enabled_rules cycle_id=%s user=%s user_id=%s",
            cycle_id,
            user.email,
            user.id,
        )

    triage_labels_pair = get_triage_labels(db, user.id)

    ai_service_live = AIService(user.ai_api_key) if (user.ai_enabled and user.ai_api_key) else None
    user_ai_live = bool(user.ai_enabled and user.ai_api_key and ai_service_live)

    if new_msg_ids:
        log.info(
            "event=poll_user_processing_messages cycle_id=%s user=%s user_id=%s new_messages=%d",
            cycle_id,
            user.email,
            user.id,
            len(new_msg_ids),
        )

        for msg_id in new_msg_ids:
            try:
                message_processed += 1
                raw_msg = gmail.get_message(user, msg_id)
                details = parse_message_details(raw_msg)

                pipe = process_message_rules_and_triage(
                    log=log,
                    gmail=gmail,
                    user=user,
                    db=db,
                    msg_id=msg_id,
                    details=details,
                    rules=rules,
                    triage_labels=triage_labels_pair,
                    ai_service=ai_service_live,
                    user_ai_allowed=user_ai_live,
                    retro_skip_ai=False,
                    cycle_id=cycle_id,
                )
                if pipe.kind == "rule_applied":
                    message_rule_applied += 1
                elif pipe.kind == "ai_triage":
                    message_ai_triage += 1
                elif pipe.kind == "skipped_no_inbox":
                    message_skipped_no_inbox += 1
                elif pipe.kind == "triage_labels_missing":
                    message_triage_labels_missing += 1
                elif pipe.kind == "ai_disabled":
                    message_ai_disabled += 1

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    message_missing += 1
                    log.debug(
                        "event=message_processed cycle_id=%s user=%s user_id=%s msg_id=%s outcome=message_missing status_code=404",
                        cycle_id,
                        user.email,
                        user.id,
                        msg_id,
                    )
                else:
                    message_error += 1
                    log.error(
                        "event=message_processed cycle_id=%s user=%s user_id=%s msg_id=%s outcome=error error=%s",
                        cycle_id,
                        user.email,
                        user.id,
                        msg_id,
                        exc,
                    )
            except Exception as exc:
                message_error += 1
                log.error(
                    "event=message_processed cycle_id=%s user=%s user_id=%s msg_id=%s outcome=error error=%s",
                    cycle_id,
                    user.email,
                    user.id,
                    msg_id,
                    exc,
                )

    _advance_retroactive_classification_jobs(user, gmail, db, cycle_id=cycle_id)
    inbox_sweep_removed = 0
    inbox_sweep_found = 0
    if user.auto_remove_inbox_labeled_read:
        inbox_sweep_stats = _run_inbox_removal_sweep(user, gmail, db, cycle_id=cycle_id)
        inbox_sweep_removed = inbox_sweep_stats["messages_changed"]
        inbox_sweep_found = inbox_sweep_stats["messages_found"]
    else:
        log.info(
            "event=inbox_removal_sweep_skipped cycle_id=%s user=%s user_id=%s reason=disabled",
            cycle_id,
            user.email,
            user.id,
        )

    # Run retention cleanup
    retention_stats = _run_retention_cleanup(user, gmail, db, cycle_id=cycle_id)
    label_retention_stats = _run_label_retention_cleanup(user, gmail, db, cycle_id=cycle_id)

    # Update history ID
    if new_history_id:
        user.last_history_id = str(new_history_id)
        db.commit()
        log.debug(
            "event=history_cursor_updated cycle_id=%s user=%s user_id=%s history_id=%s",
            cycle_id,
            user.email,
            user.id,
            user.last_history_id,
        )

    log.info(
        "event=poll_user_finished cycle_id=%s user=%s user_id=%s new_messages=%d rules_loaded=%d "
        "message_processed=%d rule_applied=%d ai_triage=%d skipped_no_inbox=%d triage_labels_missing=%d "
        "ai_disabled=%d message_missing=%d message_error=%d inbox_sweep_found=%d inbox_sweep_removed=%d "
        "retention_rules=%d retention_trashed=%d label_retention_rules=%d label_retention_trashed=%d duration_ms=%d",
        cycle_id,
        user.email,
        user.id,
        len(new_msg_ids),
        rules_loaded,
        message_processed,
        message_rule_applied,
        message_ai_triage,
        message_skipped_no_inbox,
        message_triage_labels_missing,
        message_ai_disabled,
        message_missing,
        message_error,
        inbox_sweep_found,
        inbox_sweep_removed,
        retention_stats["rules_configured"],
        retention_stats["messages_changed"],
        label_retention_stats["rules_configured"],
        label_retention_stats["messages_changed"],
        int((perf_counter() - user_started_at) * 1000),
    )


def _run_inbox_removal_sweep(
    user: User,
    gmail: GmailService,
    db: Session,
    cycle_id: str = "manual",
) -> dict[str, int]:
    """Remove INBOX label from read emails that have a user label (including Unclassified)."""
    user_labels = db.scalars(
        select(Label).where(Label.user_id == user.id, Label.label_type == "user")
    ).all()
    if not user_labels:
        log.info(
            "event=inbox_removal_sweep_skipped cycle_id=%s user=%s user_id=%s reason=no_user_labels",
            cycle_id,
            user.email,
            user.id,
        )
        return {"pages_scanned": 0, "messages_found": 0, "messages_changed": 0}

    label_clauses = " OR ".join(
        f"label:{l.name.replace(' ', '-')}" for l in user_labels
    )
    query = f"is:read in:inbox {{{label_clauses}}}"

    try:
        page_token = None
        total_removed = 0
        total_found = 0
        pages_scanned = 0
        while True:
            result = gmail.list_messages(user, query=query, max_results=100, page_token=page_token)
            pages_scanned += 1
            messages = result.get("messages", [])
            total_found += len(messages)
            if not messages:
                break
            msg_ids = [m["id"] for m in messages]
            gmail.batch_modify_messages(user, msg_ids, remove_labels=["INBOX"])
            total_removed += len(msg_ids)
            page_token = result.get("nextPageToken")
            if not page_token:
                break
        log.info(
            "event=inbox_removal_sweep_completed cycle_id=%s user=%s user_id=%s pages_scanned=%d messages_found=%d messages_changed=%d query=%s",
            cycle_id,
            user.email,
            user.id,
            pages_scanned,
            total_found,
            total_removed,
            query,
        )
        return {
            "pages_scanned": pages_scanned,
            "messages_found": total_found,
            "messages_changed": total_removed,
        }
    except Exception as exc:
        log.error(
            "event=inbox_removal_sweep_failed cycle_id=%s user=%s user_id=%s query=%s error=%s",
            cycle_id,
            user.email,
            user.id,
            query,
            exc,
        )
        return {"pages_scanned": 0, "messages_found": 0, "messages_changed": 0}


def _run_retention_cleanup(
    user: User,
    gmail: GmailService,
    db: Session,
    cycle_id: str = "manual",
) -> dict[str, int]:
    retentions = db.scalars(
        select(SystemLabelRetention).where(
            SystemLabelRetention.user_id == user.id,
            SystemLabelRetention.enabled == True,  # noqa: E712
        )
    ).all()
    if not retentions:
        log.info(
            "event=retention_cleanup_skipped cycle_id=%s user=%s user_id=%s reason=no_system_retentions",
            cycle_id,
            user.email,
            user.id,
        )
        return {"rules_configured": 0, "rules_run": 0, "messages_changed": 0}

    rules_run = 0
    total_trashed_all = 0
    for retention in retentions:
        rules_run += 1
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention.retention_days)
        cutoff_str = cutoff.strftime("%Y/%m/%d")
        query = f"label:{retention.category} before:{cutoff_str} -has:userlabels"

        try:
            page_token = None
            total_trashed = 0
            total_found = 0
            pages_scanned = 0
            while True:
                result = gmail.list_messages(
                    user,
                    query=query,
                    max_results=100,
                    page_token=page_token,
                )
                pages_scanned += 1
                messages = result.get("messages", [])
                total_found += len(messages)
                if not messages:
                    break
                msg_ids = [m["id"] for m in messages]
                gmail.batch_trash_messages(user, msg_ids)
                total_trashed += len(msg_ids)
                page_token = result.get("nextPageToken")
                if not page_token:
                    break
            total_trashed_all += total_trashed
            log.info(
                "event=retention_cleanup_completed cycle_id=%s user=%s user_id=%s category=%s retention_days=%d pages_scanned=%d messages_found=%d messages_changed=%d query=%s",
                cycle_id,
                user.email,
                user.id,
                retention.category,
                retention.retention_days,
                pages_scanned,
                total_found,
                total_trashed,
                query,
            )
        except Exception as exc:
            log.error(
                "event=retention_cleanup_failed cycle_id=%s user=%s user_id=%s category=%s query=%s error=%s",
                cycle_id,
                user.email,
                user.id,
                retention.category,
                query,
                exc,
            )

    return {
        "rules_configured": len(retentions),
        "rules_run": rules_run,
        "messages_changed": total_trashed_all,
    }


def _run_label_retention_cleanup(
    user: User,
    gmail: GmailService,
    db: Session,
    cycle_id: str = "manual",
) -> dict[str, int]:
    """Trash emails with user labels that have retention_days set and are past the cutoff."""
    labels_with_retention = db.scalars(
        select(Label).where(
            Label.user_id == user.id,
            Label.label_type == "user",
            Label.retention_days.isnot(None),
        )
    ).all()
    if not labels_with_retention:
        log.info(
            "event=label_retention_cleanup_skipped cycle_id=%s user=%s user_id=%s reason=no_label_retentions",
            cycle_id,
            user.email,
            user.id,
        )
        return {"rules_configured": 0, "rules_run": 0, "messages_changed": 0}

    rules_run = 0
    total_trashed_all = 0
    for label in labels_with_retention:
        rules_run += 1
        cutoff = datetime.now(timezone.utc) - timedelta(days=label.retention_days)
        cutoff_str = cutoff.strftime("%Y/%m/%d")
        label_term = label.name.replace(" ", "-")
        query = f"label:{label_term} before:{cutoff_str}"
        if label.retention_scope == "read_only":
            query += " is:read"
        elif label.retention_scope == "unread_only":
            query += " is:unread"

        try:
            page_token = None
            total_trashed = 0
            total_found = 0
            pages_scanned = 0
            while True:
                result = gmail.list_messages(
                    user,
                    query=query,
                    max_results=100,
                    page_token=page_token,
                )
                pages_scanned += 1
                messages = result.get("messages", [])
                total_found += len(messages)
                if not messages:
                    break
                msg_ids = [m["id"] for m in messages]
                gmail.batch_trash_messages(user, msg_ids)
                total_trashed += len(msg_ids)
                page_token = result.get("nextPageToken")
                if not page_token:
                    break
            total_trashed_all += total_trashed
            log.info(
                "event=label_retention_cleanup_completed cycle_id=%s user=%s user_id=%s label=%s retention_days=%d pages_scanned=%d messages_found=%d messages_changed=%d query=%s",
                cycle_id,
                user.email,
                user.id,
                label.name,
                label.retention_days,
                pages_scanned,
                total_found,
                total_trashed,
                query,
            )
        except Exception as exc:
            log.error(
                "event=label_retention_cleanup_failed cycle_id=%s user=%s user_id=%s label=%s query=%s error=%s",
                cycle_id,
                user.email,
                user.id,
                label.name,
                query,
                exc,
            )

    return {
        "rules_configured": len(labels_with_retention),
        "rules_run": rules_run,
        "messages_changed": total_trashed_all,
    }
