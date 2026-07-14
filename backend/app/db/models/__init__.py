# FreightProof SA — SQLAlchemy declarative base.
# Every model file in this package must import Base from here and subclass it.
# Alembic's env.py imports Base.metadata to detect schema changes for migrations.

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
