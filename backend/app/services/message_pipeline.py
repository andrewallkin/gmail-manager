"""Shared rules → AI triage path for live poller and retroactive jobs."""

import logging
from dataclasses import dataclass
from typing import Literal, Sequence

from sqlalchemy.orm import Session

from app.models import Label, Rule, User
from app.services.ai_service import AIService
from app.services.gmail_service import GmailService
from app.services.rule_engine import apply_matching_rules

OutcomeKind = Literal[
    "rule_applied",
    "skipped_no_inbox",
    "triage_labels_missing",
    "ai_disabled",
    "retro_ai_skipped",
    "ai_triage",
]


@dataclass(frozen=True)
class MessagePipelineOutcome:
    kind: OutcomeKind
    matched_rule_ids: tuple[int, ...] = ()
    triage_chosen_gmail_label_id: str | None = None


def process_message_rules_and_triage(
    *,
    log: logging.Logger,
    gmail: GmailService,
    user: User,
    db: Session,
    msg_id: str,
    details: dict,
    rules: Sequence[Rule],
    triage_labels: tuple[Label, Label] | None,
    ai_service: AIService | None,
    user_ai_allowed: bool,
    retro_skip_ai: bool,
    cycle_id: str | None = None,
    job_id: int | None = None,
) -> MessagePipelineOutcome:
    """Rules first; mandatory triage for remaining inbox mail when AI is permitted.

    - `user_ai_allowed`: AI enabled + API key configured (AIService constructed).
    - `retro_skip_ai`: Retro job with ``use_ai=False`` skips triage classify.
    - `triage_labels`: Pre-resolved (trash, temporary) or None when missing from DB.

    Trash label should be tuple[0]; temporary/default tuple[1] per `get_triage_labels` order.
    """
    extras = ""
    if cycle_id:
        extras += f" cycle_id={cycle_id}"
    if job_id is not None:
        extras += f" job_id={job_id}"

    matched_rule_ids = apply_matching_rules(rules, msg_id, details, gmail, user, db)
    if matched_rule_ids:
        log.info(
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=rule_applied rule_ids=%s%s",
            user.email,
            user.id,
            msg_id,
            ",".join(str(rid) for rid in matched_rule_ids),
            extras,
        )
        return MessagePipelineOutcome("rule_applied", tuple(matched_rule_ids))

    label_ids = details.get("label_ids") or []
    if "INBOX" not in label_ids:
        log.info(
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=skipped_no_inbox%s",
            user.email,
            user.id,
            msg_id,
            extras,
        )
        return MessagePipelineOutcome("skipped_no_inbox")

    if triage_labels is None:
        log.warning(
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=triage_labels_missing%s",
            user.email,
            user.id,
            msg_id,
            extras,
        )
        return MessagePipelineOutcome("triage_labels_missing")

    trash_label, temporary_label = triage_labels

    if retro_skip_ai:
        log.info(
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=retro_ai_skipped%s",
            user.email,
            user.id,
            msg_id,
            extras,
        )
        return MessagePipelineOutcome("retro_ai_skipped")

    if not user_ai_allowed or ai_service is None:
        log.info(
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=ai_disabled%s",
            user.email,
            user.id,
            msg_id,
            extras,
        )
        return MessagePipelineOutcome("ai_disabled")

    triage_dicts: list[dict] = [
        {
            "id": trash_label.gmail_label_id,
            "name": trash_label.name,
            "description": trash_label.ai_description,
        },
        {
            "id": temporary_label.gmail_label_id,
            "name": temporary_label.name,
            "description": temporary_label.ai_description,
        },
    ]

    chosen = ai_service.classify_triage_email(
        details.get("from", ""),
        details.get("subject", ""),
        details.get("body", ""),
        triage_dicts,
        default_label_id=temporary_label.gmail_label_id,
    )
    remove_inbox = "INBOX" in label_ids
    gmail.modify_message(
        user,
        msg_id,
        add_labels=[chosen],
        remove_labels=["INBOX"] if remove_inbox else None,
    )

    log.info(
        (
            "event=message_processed user=%s user_id=%s msg_id=%s outcome=ai_triage "
            "label_id=%s removed_inbox=%s%s"
        ),
        user.email,
        user.id,
        msg_id,
        chosen,
        remove_inbox,
        extras,
    )
    return MessagePipelineOutcome("ai_triage", triage_chosen_gmail_label_id=chosen)
