from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_jwt_user
from app.models import User
from app.services.gmail_service import GmailService

router = APIRouter(prefix="/api/restore", tags=["restore"])

DEFAULT_QUERY = "in:trash is:read"
DEFAULT_BATCH_SIZE = 100
MAX_BATCH_SIZE = 1000
MAX_LIST_MANIFESTS = 100


def _manifests_dir() -> Path:
    path = Path("tmp/restore-manifests")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _safe_batch_modify(
    gmail: GmailService,
    user: User,
    msg_ids: list[str],
    add_labels: list[str] | None = None,
    remove_labels: list[str] | None = None,
) -> tuple[list[str], list[dict[str, str]]]:
    if not msg_ids:
        return [], []

    try:
        gmail.batch_modify_messages(user, msg_ids, add_labels=add_labels, remove_labels=remove_labels)
        return msg_ids, []
    except httpx.HTTPError as exc:
        errors: list[dict[str, str]] = [{"scope": "batch", "message": str(exc)}]
        succeeded: list[str] = []
        for msg_id in msg_ids:
            try:
                gmail.modify_message(
                    user,
                    msg_id,
                    add_labels=add_labels,
                    remove_labels=remove_labels,
                )
                succeeded.append(msg_id)
            except httpx.HTTPError as item_exc:
                errors.append({"scope": msg_id, "message": str(item_exc)})
        return succeeded, errors


def _manifest_metadata(manifest_path: Path) -> dict[str, Any]:
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return {
        "name": manifest_path.name,
        "created_at": payload.get("created_at"),
        "query": payload.get("query"),
        "messages_seen": payload.get("messages_seen", 0),
        "messages_restored": payload.get("messages_restored", 0),
        "errors": len(payload.get("errors", [])),
        "rolled_back": bool(payload.get("rolled_back")),
    }


def _load_manifest_for_user(manifest_name: str, user: User) -> tuple[Path, dict[str, Any]]:
    safe_name = Path(manifest_name).name
    if safe_name != manifest_name:
        raise HTTPException(status_code=400, detail="Invalid manifest name")
    if not safe_name.endswith(".json"):
        raise HTTPException(status_code=400, detail="Manifest must be a .json file")

    manifest_path = _manifests_dir() / safe_name
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")

    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("user_email") != user.email:
        raise HTTPException(status_code=403, detail="Manifest does not belong to current user")
    return manifest_path, payload


class RestorePreviewRequest(BaseModel):
    query: str = DEFAULT_QUERY


class RestoreRunRequest(BaseModel):
    query: str = DEFAULT_QUERY
    batch_size: int = Field(default=DEFAULT_BATCH_SIZE, ge=1, le=MAX_BATCH_SIZE)


class RestoreRollbackRequest(BaseModel):
    manifest_name: str
    batch_size: int = Field(default=DEFAULT_BATCH_SIZE, ge=1, le=MAX_BATCH_SIZE)


@router.post("/preview")
def preview_restore(
    body: RestorePreviewRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict[str, int | str]:
    gmail = GmailService(db)
    total = 0
    pages_scanned = 0
    page_token = None

    while True:
        result = gmail.list_messages(
            user,
            query=body.query,
            max_results=500,
            page_token=page_token,
        )
        pages_scanned += 1
        messages = result.get("messages", [])
        total += len(messages)
        page_token = result.get("nextPageToken")
        if not page_token or not messages:
            break

    return {
        "query": body.query,
        "estimated_count": total,
        "pages_scanned": pages_scanned,
    }


@router.post("/run")
def run_restore(
    body: RestoreRunRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict[str, Any]:
    gmail = GmailService(db)
    manifest: dict[str, Any] = {
        "version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "operation": "restore_trash_read_to_inbox",
        "query": body.query,
        "user_email": user.email,
        "batch_size": body.batch_size,
        "pages_scanned": 0,
        "messages_seen": 0,
        "messages_restored": 0,
        "restored_message_ids": [],
        "errors": [],
        "rolled_back": False,
    }

    page_token: str | None = None
    while True:
        result = gmail.list_messages(
            user,
            query=body.query,
            max_results=500,
            page_token=page_token,
        )
        manifest["pages_scanned"] += 1
        messages = result.get("messages", [])
        if not messages:
            break

        msg_ids = [m["id"] for m in messages if m.get("id")]
        manifest["messages_seen"] += len(msg_ids)

        for chunk in _chunked(msg_ids, body.batch_size):
            restored_ids, errors = _safe_batch_modify(
                gmail,
                user,
                chunk,
                add_labels=["INBOX"],
                remove_labels=["TRASH"],
            )
            manifest["restored_message_ids"].extend(restored_ids)
            manifest["messages_restored"] += len(restored_ids)
            manifest["errors"].extend(errors)

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    manifest_name = f"restore-trash-read-{_timestamp()}.json"
    manifest_path = _manifests_dir() / manifest_name
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return {
        "manifest_name": manifest_name,
        "query": body.query,
        "pages_scanned": manifest["pages_scanned"],
        "messages_seen": manifest["messages_seen"],
        "messages_restored": manifest["messages_restored"],
        "errors": len(manifest["errors"]),
    }


@router.post("/rollback")
def rollback_restore(
    body: RestoreRollbackRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict[str, Any]:
    manifest_path, manifest = _load_manifest_for_user(body.manifest_name, user)
    if manifest.get("rolled_back"):
        raise HTTPException(status_code=409, detail="Manifest already rolled back")

    ids = [msg_id for msg_id in manifest.get("restored_message_ids", []) if isinstance(msg_id, str)]
    if not ids:
        raise HTTPException(status_code=400, detail="No restored message IDs found in manifest")

    gmail = GmailService(db)
    rollback_errors: list[dict[str, str]] = []
    rolled_back_count = 0

    for chunk in _chunked(ids, body.batch_size):
        rolled_back_ids, errors = _safe_batch_modify(
            gmail,
            user,
            chunk,
            add_labels=["TRASH"],
            remove_labels=["INBOX"],
        )
        rolled_back_count += len(rolled_back_ids)
        rollback_errors.extend(errors)

    manifest["rolled_back"] = True
    manifest["rolled_back_at"] = datetime.now(timezone.utc).isoformat()
    manifest["rollback"] = {
        "rolled_back_count": rolled_back_count,
        "errors": rollback_errors,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    return {
        "manifest_name": body.manifest_name,
        "target_count": len(ids),
        "rolled_back_count": rolled_back_count,
        "errors": len(rollback_errors),
    }


@router.get("/manifests")
def list_manifests(
    db: Session = Depends(get_db),
    user: User = Depends(require_jwt_user),
) -> dict[str, list[dict[str, Any]]]:
    _ = db
    manifests = []
    for p in sorted(_manifests_dir().glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payload = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if payload.get("user_email") != user.email:
            continue
        manifests.append(_manifest_metadata(p))
        if len(manifests) >= MAX_LIST_MANIFESTS:
            break
    return {"items": manifests}
