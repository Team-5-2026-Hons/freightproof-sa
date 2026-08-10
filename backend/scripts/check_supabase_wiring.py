"""Verify Supabase/database wiring before running migrations against a new project.

Answers one question: "have I pointed everything at the same, correct project?"

Prints ONLY derived and masked values — never a password, key, or raw .env line. Safe to
run and safe to paste into a chat or a PR comment.

Usage:
    cd backend && .venv/bin/python scripts/check_supabase_wiring.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse, unquote

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings

OK = "  OK  "
BAD = " FAIL "
WARN = " WARN "

_failures: list[str] = []
_warnings: list[str] = []


def report(status: str, label: str, detail: str) -> None:
    print(f"[{status}] {label:34} {detail}")
    if status == BAD:
        _failures.append(label)
    elif status == WARN:
        _warnings.append(label)


def mask(secret: str) -> str:
    """Show only enough to tell two keys apart — never enough to use one."""
    if not secret:
        return "<empty>"
    if len(secret) <= 12:
        return f"{secret[:2]}…{secret[-2:]} (len {len(secret)})"
    return f"{secret[:6]}…{secret[-4:]} (len {len(secret)})"


def key_identity(key: str) -> tuple[str | None, str | None]:
    """Decode a legacy Supabase JWT key to (project_ref, role) without revealing the key.

    Legacy anon/service_role keys are unsigned-payload-readable JWTs carrying
    {"iss":"supabase","ref":"<project>","role":"anon"|"service_role"}. Newer
    sb_publishable_/sb_secret_ keys are opaque and return (None, None).
    """
    parts = key.split(".")
    if len(parts) != 3:
        return None, None
    try:
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("ref"), payload.get("role")
    except Exception:  # noqa: BLE001 — a malformed key is itself the finding
        return None, None


def project_ref_from_supabase_url(url: str) -> str | None:
    # https://<ref>.supabase.co
    m = re.match(r"https://([a-z0-9]+)\.supabase\.(co|in)", url.strip())
    return m.group(1) if m else None


def project_ref_from_database_url(url: str) -> str | None:
    """Pooler URLs carry the ref in the username: postgres.<ref>. Direct URLs use db.<ref>."""
    parsed = urlparse(url)
    user = unquote(parsed.username or "")
    if "." in user:
        return user.split(".", 1)[1]
    host = parsed.hostname or ""
    m = re.match(r"db\.([a-z0-9]+)\.supabase\.(co|in)", host)
    return m.group(1) if m else None


def check_database_url() -> tuple[str | None, bool]:
    """Returns (project_ref, is_connectable) — connectable is False if the driver is wrong."""
    raw = settings.DATABASE_URL
    if not raw:
        report(BAD, "DATABASE_URL set", "missing")
        return None, False

    parsed = urlparse(raw)
    host = parsed.hostname or "?"
    port = parsed.port
    ref = project_ref_from_database_url(raw)

    report(OK, "DATABASE_URL host", f"{host}:{port}")

    connectable = raw.startswith("postgresql+asyncpg://")
    if not connectable:
        report(
            BAD,
            "DATABASE_URL driver",
            f"scheme is '{parsed.scheme}' — must be 'postgresql+asyncpg' "
            "(change 'postgresql://' to 'postgresql+asyncpg://')",
        )
    else:
        report(OK, "DATABASE_URL driver", "postgresql+asyncpg")

    # Transaction-mode pooler (6543) disables prepared statements, which asyncpg relies on.
    if port == 6543:
        report(BAD, "DATABASE_URL pooler mode", "port 6543 = transaction mode — use session mode (5432)")
    elif port == 5432:
        report(OK, "DATABASE_URL pooler mode", "port 5432 (session mode / direct)")
    else:
        report(WARN, "DATABASE_URL pooler mode", f"unexpected port {port}")

    report(OK, "DATABASE_URL project ref", ref or "<could not parse>")
    return ref, connectable


async def check_db_connection() -> None:
    engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
    try:
        async with engine.connect() as conn:
            db_name = (await conn.execute(text("SELECT current_database()"))).scalar_one()
            report(OK, "database connection", f"connected to '{db_name}'")

            has_alembic = (
                await conn.execute(
                    text("SELECT to_regclass('public.alembic_version') IS NOT NULL")
                )
            ).scalar_one()
            if has_alembic:
                rev = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar()
                report(OK, "alembic_version", f"{rev} — migrations already applied")
            else:
                report(WARN, "alembic_version", "table absent — fresh DB, run 'alembic upgrade head'")

            n_tables = (
                await conn.execute(
                    text(
                        "SELECT count(*) FROM information_schema.tables "
                        "WHERE table_schema = 'public'"
                    )
                )
            ).scalar_one()
            report(OK, "public tables", f"{n_tables}")

            # auth.users must exist and is what migration 0002's FKs point at.
            n_auth = (
                await conn.execute(
                    text("SELECT count(*) FROM auth.users")
                )
            ).scalar_one()
            report(OK, "auth.users rows", f"{n_auth} (0 = seed will need real-auth provisioning)")
    except Exception as exc:  # noqa: BLE001 — surface the real reason, whatever it is
        report(BAD, "database connection", f"{type(exc).__name__}: {str(exc)[:140]}")
    finally:
        await engine.dispose()


def check_supabase_api(db_ref: str | None) -> None:
    url = settings.SUPABASE_URL
    if not url:
        report(BAD, "SUPABASE_URL set", "missing")
        return

    api_ref = project_ref_from_supabase_url(url)
    report(OK, "SUPABASE_URL", url)
    report(OK, "SUPABASE_URL project ref", api_ref or "<could not parse>")

    # The single most important check in this script.
    if db_ref and api_ref:
        if db_ref == api_ref:
            report(OK, "SAME PROJECT?", f"yes — both '{db_ref}'")
        else:
            report(
                BAD,
                "SAME PROJECT?",
                f"NO — DATABASE_URL='{db_ref}' but SUPABASE_URL='{api_ref}'. "
                "Migration 0002's auth FK is intra-database; this will fail confusingly.",
            )

    # Decoding each key's own `ref` claim is what turns an unexplained 401 into
    # "this key belongs to the other project".
    for label, value, unused in (
        ("SUPABASE_ANON_KEY", settings.SUPABASE_ANON_KEY, "  (declared-but-unused by the backend)"),
        ("SUPABASE_SERVICE_ROLE_KEY", settings.SUPABASE_SERVICE_ROLE_KEY, ""),
    ):
        if not value:
            report(BAD, label, "missing")
            continue
        key_ref, key_role = key_identity(value)
        if key_ref is None:
            report(OK, label, f"{mask(value)} — opaque (sb_publishable_/sb_secret_ format){unused}")
        elif api_ref and key_ref != api_ref:
            report(
                BAD,
                label,
                f"belongs to project '{key_ref}' (role={key_role}) but SUPABASE_URL is "
                f"'{api_ref}' — WRONG PROJECT'S KEY{unused}",
            )
        else:
            report(OK, label, f"{mask(value)} role={key_role} ref={key_ref}{unused}")

    # JWKS proves SUPABASE_URL is a live project — this exact endpoint verifies every JWT
    # (app/auth/dependencies.py:83), so if it 404s, all authentication is broken.
    try:
        resp = httpx.get(f"{url}/auth/v1/.well-known/jwks.json", timeout=10.0)
        keys = resp.json().get("keys", []) if resp.status_code == 200 else []
        if resp.status_code == 200 and keys:
            report(OK, "JWKS endpoint", f"{len(keys)} signing key(s) — token verification will work")
        else:
            report(BAD, "JWKS endpoint", f"HTTP {resp.status_code}, {len(keys)} keys")
    except Exception as exc:  # noqa: BLE001
        report(BAD, "JWKS endpoint", f"{type(exc).__name__}: {str(exc)[:100]}")

    # service_role is what the seeder uses to provision auth users.
    if settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            resp = httpx.get(
                f"{url}/auth/v1/admin/users?page=1&per_page=1",
                headers={
                    "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                    "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                },
                timeout=10.0,
            )
            if resp.status_code == 200:
                report(OK, "service_role admin API", "accepted — seeder can provision auth users")
            else:
                report(BAD, "service_role admin API", f"HTTP {resp.status_code} — wrong key for this project?")
        except Exception as exc:  # noqa: BLE001
            report(BAD, "service_role admin API", f"{type(exc).__name__}: {str(exc)[:100]}")


def check_frontend_env() -> None:
    """Confirm the two .env.local files define the names the code actually reads."""
    root = Path(__file__).resolve().parents[2] / "frontend"
    required = ("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY")

    for app in ("dispatcher", "driver-pwa"):
        path = root / app / ".env.local"
        if not path.exists():
            report(BAD, f"{app}/.env.local", "missing")
            continue
        # Read key NAMES only — values are never printed.
        names = {
            line.split("=", 1)[0].strip()
            for line in path.read_text().splitlines()
            if "=" in line and not line.strip().startswith("#")
        }
        missing = [k for k in required if k not in names]
        if missing:
            report(BAD, f"{app}/.env.local", f"missing {', '.join(missing)}")
            wrong = [n for n in names if "SUPABASE" in n and n not in required]
            if wrong:
                report(WARN, f"{app} — found instead", ", ".join(sorted(wrong)))
        else:
            report(OK, f"{app}/.env.local", "defines both names the code reads")


async def main() -> int:
    print("\n=== FreightProof — Supabase wiring check ===")
    print("(masked output: no password or key is ever printed)\n")

    print("-- backend/.env : database --")
    db_ref, connectable = check_database_url()
    if connectable:
        await check_db_connection()
    else:
        report(WARN, "database connection", "skipped — fix the driver scheme first")

    print("\n-- backend/.env : Supabase API --")
    check_supabase_api(db_ref)

    print("\n-- frontend .env.local --")
    check_frontend_env()

    print()
    if _failures:
        print(f"RESULT: {len(_failures)} FAILURE(S) — {', '.join(_failures)}")
        return 1
    if _warnings:
        print(f"RESULT: OK with {len(_warnings)} warning(s) — {', '.join(_warnings)}")
        return 0
    print("RESULT: all checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
