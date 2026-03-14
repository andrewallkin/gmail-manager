"""add_scope_all_inbox

Revision ID: 3c8d2f0e5b1a
Revises: 2b7c9e1d4f2a
Create Date: 2026-03-14 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "3c8d2f0e5b1a"
down_revision = "2b7c9e1d4f2a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "rules",
        sa.Column(
            "scope_all_inbox",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("rules", "scope_all_inbox", server_default=None)


def downgrade() -> None:
    op.drop_column("rules", "scope_all_inbox")
