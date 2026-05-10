"""label_retention_scope_and_retro_job

Revision ID: b2c3d4e5f6a7
Revises: 9a7f5c2d1b4e
Create Date: 2026-05-08

"""
from alembic import op
import sqlalchemy as sa


revision = "b2c3d4e5f6a7"
down_revision = "9a7f5c2d1b4e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "labels",
        sa.Column("retention_scope", sa.String(length=16), server_default="all", nullable=False),
    )
    op.create_table(
        "retroactive_classification_jobs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("use_ai", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("page_token", sa.Text(), nullable=True),
        sa.Column("processed_count", sa.Integer(), nullable=False),
        sa.Column("rule_matched_count", sa.Integer(), nullable=False),
        sa.Column("ai_classified_count", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_retro_jobs_user_status",
        "retroactive_classification_jobs",
        ["user_id", "status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_retro_jobs_user_status", table_name="retroactive_classification_jobs")
    op.drop_table("retroactive_classification_jobs")
    op.drop_column("labels", "retention_scope")
