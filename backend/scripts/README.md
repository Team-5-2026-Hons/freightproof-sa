# Scripts

This directory holds one-shot maintenance scripts that are not part of the application runtime. Examples: `seed.py` for populating a fresh dev database, data migration helpers that run once outside of Alembic, and manual backfill scripts.

Scripts here should be runnable standalone (`python scripts/seed.py`) and must never be imported by application code. Each script should include a docstring explaining what it does, what environment it targets, and whether it is safe to run more than once.
