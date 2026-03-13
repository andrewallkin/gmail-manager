"""add_ai_label_context_and_inbox_toggle

Revision ID: 2b7c9e1d4f2a
Revises: f84b4fec0a8b
Create Date: 2026-03-13 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "2b7c9e1d4f2a"
down_revision = "f84b4fec0a8b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "auto_remove_inbox_labeled_read",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.alter_column("users", "auto_remove_inbox_labeled_read", server_default=None)
    op.add_column("labels", sa.Column("ai_description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("labels", "ai_description")
    op.drop_column("users", "auto_remove_inbox_labeled_read")
