from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    profile_picture_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expiry: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ai_provider: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ai_api_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    auto_remove_inbox_labeled_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_history_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    polling_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    polling_interval_minutes: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class Label(Base):
    __tablename__ = "labels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    gmail_label_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    label_type: Mapped[str] = mapped_column(String(32), default="user", nullable=False)
    color_bg: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color_text: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    unread_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    match_from: Mapped[str | None] = mapped_column(String(255), nullable=True)
    match_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    match_subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    match_has_words: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_doesnt_have: Mapped[str | None] = mapped_column(Text, nullable=True)
    match_label_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("labels.id"), nullable=True)
    action_label_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("labels.id"), nullable=True)
    action_archive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    action_delete: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    action_mark_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    action_delete_after_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    scope_promotions: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_social: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_updates: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_forums: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    scope_all_inbox: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    use_ai: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ai_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class CleanupJob(Base):
    __tablename__ = "cleanup_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    label_filter: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_from: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    date_to: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="pending", nullable=False)
    total_messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processed_messages: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SystemLabelRetention(Base):
    __tablename__ = "system_label_retention"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)  # promotions/social/updates/forums
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
