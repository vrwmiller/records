"""merge add_label and rename_collection_types heads

Revision ID: 09af90c563da
Revises: 4b7ab0a331c0, e3b7a91f2c84
Create Date: 2026-04-12 21:53:07.878443

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '09af90c563da'  # pragma: allowlist secret
down_revision: Union[str, None] = ('4b7ab0a331c0', 'e3b7a91f2c84')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
