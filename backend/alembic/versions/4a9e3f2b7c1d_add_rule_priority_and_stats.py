"""add_rule_priority_and_stats

Revision ID: 4a9e3f2b7c1d
Revises: 3c8d2f0e5b1a
Create Date: 2026-03-14 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "4a9e3f2b7c1d"
down_revision = "3c8d2f0e5b1a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rules",
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("rules", "priority", server_default=None)

    op.add_column(
        "rules",
        sa.Column("total_matched", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("rules", "total_matched", server_default=None)

    op.add_column(
        "rules",
        sa.Column("last_matched_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("rules", "last_matched_at")
    op.drop_column("rules", "total_matched")
    op.drop_column("rules", "priority")
