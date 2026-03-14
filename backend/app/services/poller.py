import logging
import threading
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import Label, Rule, SystemLabelRetention, User
from app.services.ai_service import AIService
from app.services.gmail_service import GmailService, parse_message_details
from app.services.inbox_rules import is_primary_inbox_message
from app.services.rule_engine import apply_rule_actions, message_matches_rule

log = logging.getLogger("poller")

_timer: threading.Timer | None = None
_running = False
_last_poll_per_user: dict[int, datetime] = {}

POLL_INTERVAL_SECONDS = 60


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
    db: Session = SessionLocal()
    try:
        users = db.scalars(
            select(User).where(
                User.polling_enabled == True,  # noqa: E712
                User.google_id.isnot(None),
                User.access_token.isnot(None),
                User.refresh_token.isnot(None),
            )
        ).all()
        now = datetime.now(timezone.utc)

        for user in users:
            last_poll = _last_poll_per_user.get(user.id)
            interval = timedelta(minutes=user.polling_interval_minutes)
            if last_poll and (now - last_poll) < interval:
                continue

            _last_poll_per_user[user.id] = now
            try:
                _poll_user(user, db)
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 401:
                    user.polling_enabled = False
                    db.commit()
                    _last_poll_per_user.pop(user.id, None)
                    log.warning(
                        "Disabled polling after Gmail 401 for user=%s; reconnect Google and re-enable polling.",
                        user.email,
                    )
                else:
                    log.error("Poll failed for user=%s: %s", user.email, exc)
            except Exception as exc:
                log.error("Poll failed for user=%s: %s", user.email, exc)
    finally:
        db.close()


def _poll_user(user: User, db: Session) -> None:
    gmail = GmailService(db)

    # Initialize history_id if not set
    if not user.last_history_id:
        profile = gmail.get_profile(user)
        user.last_history_id = str(profile.get("historyId", ""))
        db.commit()
        log.info("Initialized history_id for user=%s", user.email)
        return

    # Get new messages since last history ID
    try:
        history_records: list[dict] = []
        next_page_token = None
        new_history_id = None
        while True:
            history = gmail.history_list(
                user,
                user.last_history_id,
                page_token=next_page_token,
            )
            page_history_id = history.get("historyId")
            if page_history_id:
                new_history_id = page_history_id
            history_records.extend(history.get("history", []))
            next_page_token = history.get("nextPageToken")
            if not next_page_token:
                break
    except Exception as exc:
        # 404 means history ID is too old, reset it
        if "404" in str(exc):
            profile = gmail.get_profile(user)
            user.last_history_id = str(profile.get("historyId", ""))
            db.commit()
            log.warning("History ID expired for user=%s, reset", user.email)
            return
        raise

    # Collect new message IDs
    new_msg_ids: set[str] = set()
    for record in history_records:
        for added in record.get("messagesAdded", []):
            msg = added.get("message", {})
            new_msg_ids.add(msg["id"])

    if new_msg_ids:
        log.info("Processing %d new messages for user=%s", len(new_msg_ids), user.email)

        # Load enabled rules ordered by priority
        rules = db.scalars(
            select(Rule)
            .where(Rule.user_id == user.id, Rule.enabled == True)  # noqa: E712
            .order_by(Rule.priority.asc(), Rule.created_at.asc())
        ).all()

        # Load user labels for AI
        user_labels = db.scalars(
            select(Label).where(Label.user_id == user.id, Label.label_type == "user")
        ).all()
        available_labels = [
            {"id": l.gmail_label_id, "name": l.name, "description": l.ai_description}
            for l in user_labels
        ]
        label_name_by_id = {l.gmail_label_id: l.name for l in user_labels}

        ai_service = None
        if user.ai_enabled and user.ai_api_key:
            ai_service = AIService(user.ai_api_key)

        for msg_id in new_msg_ids:
            try:
                raw_msg = gmail.get_message(user, msg_id)
                details = parse_message_details(raw_msg)

                # Never mark unread emails as read - skip action_mark_read for unread
                is_unread = details["is_unread"]

                # Try rules
                rule_matched = False
                for rule in rules:
                    if message_matches_rule(rule, details, db):
                        apply_rule_actions(
                            rule,
                            [msg_id],
                            gmail,
                            user,
                            db,
                            message_details_by_id={msg_id: details},
                            skip_mark_read=is_unread and rule.action_mark_read,
                        )
                        rule_matched = True
                        break

                # AI classification for Primary inbox messages only
                if not rule_matched and ai_service and available_labels:
                    label_ids = details["label_ids"]
                    is_primary = is_primary_inbox_message(label_ids)
                    if is_primary:
                        label_id = ai_service.classify_email(
                            details["from"], details["subject"], details["body"],
                            available_labels,
                        )
                        if label_id:
                            gmail.modify_message(user, msg_id, add_labels=[label_id])
                            log.info("AI classified msg=%s with label=%s", msg_id, label_id)

            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    log.debug("Message %s no longer exists, skipping", msg_id)
                else:
                    log.error("Failed to process msg=%s: %s", msg_id, exc)
            except Exception as exc:
                log.error("Failed to process msg=%s: %s", msg_id, exc)

    # Run inbox removal sweep for read, classified emails
    if user.auto_remove_inbox_labeled_read:
        _run_inbox_removal_sweep(user, gmail, db)

    # Run retention cleanup
    _run_retention_cleanup(user, gmail, db)

    # Update history ID
    if new_history_id:
        user.last_history_id = str(new_history_id)
        db.commit()


def _run_inbox_removal_sweep(user: User, gmail: GmailService, db: Session) -> None:
    """Remove INBOX label from read emails that have a user label (including Unclassified)."""
    user_labels = db.scalars(
        select(Label).where(Label.user_id == user.id, Label.label_type == "user")
    ).all()
    if not user_labels:
        return

    label_clauses = " OR ".join(
        f"label:{l.name.replace(' ', '-')}" for l in user_labels
    )
    query = (
        f"is:read in:inbox "
        f"-category:promotions -category:social -category:updates -category:forums "
        f"{{{label_clauses}}}"
    )

    try:
        page_token = None
        total_removed = 0
        while True:
            result = gmail.list_messages(user, query=query, max_results=100, page_token=page_token)
            messages = result.get("messages", [])
            if not messages:
                break
            msg_ids = [m["id"] for m in messages]
            gmail.batch_modify_messages(user, msg_ids, remove_labels=["INBOX"])
            total_removed += len(msg_ids)
            page_token = result.get("nextPageToken")
            if not page_token:
                break
        if total_removed:
            log.info(
                "Inbox removal sweep: removed INBOX from %d read messages for user=%s",
                total_removed, user.email,
            )
    except Exception as exc:
        log.error("Inbox removal sweep failed for user=%s: %s", user.email, exc)


def _run_retention_cleanup(user: User, gmail: GmailService, db: Session) -> None:
    retentions = db.scalars(
        select(SystemLabelRetention).where(
            SystemLabelRetention.user_id == user.id,
            SystemLabelRetention.enabled == True,  # noqa: E712
        )
    ).all()

    for retention in retentions:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention.retention_days)
        cutoff_str = cutoff.strftime("%Y/%m/%d")
        query = f"label:{retention.category} before:{cutoff_str}"

        try:
            page_token = None
            total_trashed = 0
            while True:
                result = gmail.list_messages(
                    user,
                    query=query,
                    max_results=100,
                    page_token=page_token,
                )
                messages = result.get("messages", [])
                if not messages:
                    break
                msg_ids = [m["id"] for m in messages]
                gmail.batch_trash_messages(user, msg_ids)
                total_trashed += len(msg_ids)
                page_token = result.get("nextPageToken")
                if not page_token:
                    break
            if total_trashed:
                log.info(
                    "Retention cleanup: trashed %d %s messages older than %d days for user=%s",
                    total_trashed, retention.category, retention.retention_days, user.email,
                )
        except Exception as exc:
            log.error("Retention cleanup failed for %s: %s", retention.category, exc)
