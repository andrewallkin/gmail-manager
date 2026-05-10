"""retro_job_triage_bucket_counts

Revision ID: a1f2e3d4c5b6
Revises: b2c3d4e5f6a7
Create Date: 2026-05-10

"""
from alembic import op
import sqlalchemy as sa


revision = "a1f2e3d4c5b6"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "retroactive_classification_jobs",
        sa.Column(
            "ai_trash_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "retroactive_classification_jobs",
        sa.Column(
            "ai_temporary_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )


def downgrade() -> None:
    op.drop_column("retroactive_classification_jobs", "ai_temporary_count")
    op.drop_column("retroactive_classification_jobs", "ai_trash_count")
