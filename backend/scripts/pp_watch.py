"""DEVELOPER TOOL — observe which Parcel Perfect fields move as a waybill progresses.

Targets the LIVE Parcel Perfect demo environment using the credentials already in
backend/.env. Touches no database and imports nothing from app/ except settings, so it is
safe to run any number of times and against any environment. It is read-only: the only PP
call it makes is Waybill.getSingleWaybill.

WHY THIS EXISTS
PP's ecomService exposes no status, event, or tracking endpoint — verified against the v28
and v32 SOAP WSDLs, which carry an identical 13 operations, and against the 12-sheet v28
workbook. `getSingleWaybill` is the only read in the entire API. So the only way to learn
where a waybill sits in PP's process is empirical: poll it, snapshot every field, and diff.

WHAT TO WATCH
  editstate.allowedit  PP locks a waybill from editing once it is committed to the
                       operational process, so 1 -> 0 is the strongest status proxy
                       available. Not documented anywhere.
  details.collect      populates when a collection is booked
  details.manifest     populates when the waybill is manifested onto a vehicle
  details.poddate      populates on delivery
  details.failtype     populates on delivery failure
  details.invoice      populates on invoicing

Note that a Mode: Customer PP account cannot manifest, dispatch or deliver — those are
depot functions. From a customer account the only triggerable transition is
"Collect this waybill". See docs/parcel-perfect-integration-spec.md §B2a.

USAGE (run from backend/ as a module — plain `python scripts/pp_watch.py` puts scripts/ on
sys.path rather than backend/, so the `app` import fails)
    python -m scripts.pp_watch GPC10592609
    python -m scripts.pp_watch GPC10592609 --interval 10 --minutes 20

Snapshots and a change log are written to ./pp_watch_out/ in the working directory.
Those payloads contain personal data (names, addresses, cell numbers) and this is a public
repository — pp_watch_out/ must not be committed.
"""

import argparse
import asyncio
import hashlib
import json
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.core.config import settings

# PP publishes no SLA; 20s is a generous cap for a single read on the demo host.
_TIMEOUT_SECONDS = 20.0

# Printed on the baseline poll so the operator can see lifecycle position at a glance.
_LIFECYCLE_KEYS = (
    "details.collect",
    "details.manifest",
    "details.invoice",
    "details.poddate",
    "details.failtype",
    "editstate.allowedit",
    "editstate.message",
)


async def _call(
    client: httpx.AsyncClient,
    url: str,
    class_name: str,
    method: str,
    params: dict[str, object],
    token: str | None = None,
) -> dict:
    """One PP JSON GET. token is omitted only for the Auth methods."""
    query: dict[str, str] = {
        "params": json.dumps(params),
        "method": method,
        "class": class_name,
    }
    if token is not None:
        query["token_id"] = token
    response = await client.get(f"{url}?{urllib.parse.urlencode(query)}")
    response.raise_for_status()
    return response.json()


async def _get_token(client: httpx.AsyncClient, url: str) -> str:
    """Pre-issued token if configured, else the v28 salt/MD5 handshake."""
    if settings.PP_API_TOKEN:
        return settings.PP_API_TOKEN

    salt_body = await _call(client, url, "Auth", "getSalt", {"email": settings.PP_API_KEY})
    salt = salt_body["results"][0]["salt"]
    encrypted = hashlib.md5(f"{settings.PP_API_PASSWORD}{salt}".encode()).hexdigest()
    token_body = await _call(
        client, url, "Auth", "getSecureToken",
        {"email": settings.PP_API_KEY, "encrypted_password": encrypted},
    )
    return token_body["results"][0]["token_id"]


def _flatten(result: dict) -> dict[str, object]:
    """Flatten one getSingleWaybill result into comparable scalar keys.

    Covers every section PP returns, not just `details` — editstate and accountInfo are
    undocumented and editstate carries the lock flag, so omitting them would miss the most
    informative signal in the payload.
    """
    flat: dict[str, object] = {}

    for key, value in (result.get("details") or {}).items():
        flat[f"details.{key}"] = value

    for section in ("contents", "tracks"):
        for index, row in enumerate(result.get(section) or []):
            for key, value in row.items():
                flat[f"{section}[{index}].{key}"] = value

    # PP's spec calls this array `wayref`; the live JSON returns `wayrefs`. Accept both.
    for index, row in enumerate(result.get("wayrefs") or result.get("wayref") or []):
        for key, value in row.items():
            flat[f"wayrefs[{index}].{key}"] = value

    for section in ("editstate", "accountInfo"):
        for key, value in (result.get(section) or {}).items():
            flat[f"{section}.{key}"] = value

    # Cardinality changes matter independently of per-row values: a parcel appearing or
    # disappearing is a different event from a parcel's field being edited.
    flat["_counts.contents"] = len(result.get("contents") or [])
    flat["_counts.tracks"] = len(result.get("tracks") or [])
    flat["_counts.wayrefs"] = len(result.get("wayrefs") or result.get("wayref") or [])
    return flat


async def _run(waybill: str, interval: int, minutes: int) -> int:
    url = settings.PP_API_URL
    if not url:
        print("ABORT: PP_API_URL is not configured in backend/.env")
        return 2
    if not settings.PP_API_TOKEN and not (settings.PP_API_KEY and settings.PP_API_PASSWORD):
        print("ABORT: no PP credentials. Need PP_API_TOKEN, or PP_API_KEY + PP_API_PASSWORD.")
        return 2
    if url.startswith("http://"):
        # POPIA: waybill payloads carry names, addresses and cell numbers.
        print("NOTE: PP_API_URL is http://. Upgrading to https:// for this run.")
        url = "https://" + url[len("http://"):]

    outdir = Path.cwd() / "pp_watch_out"
    outdir.mkdir(exist_ok=True)
    change_log = outdir / f"changes_{waybill}.log"

    print("=" * 72)
    print(f"PP WATCH — {waybill}")
    print(f"every {interval}s for {minutes}min  ->  {outdir}")
    print("=" * 72)
    print("Perform ONE portal action at a time. Note the wall-clock time of each.\n")

    previous: dict[str, object] | None = None
    changes: list[str] = []
    polls = max(1, (minutes * 60) // interval)

    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS, follow_redirects=True) as client:
        token = await _get_token(client, url)

        for poll in range(polls):
            stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
            try:
                body = await _call(
                    client, url, "Waybill", "getSingleWaybill",
                    {"waybillno": waybill}, token=token,
                )
                results = body.get("results") or []
                if not results:
                    print(f"[{stamp}] poll {poll}: EMPTY RESULTS — PP does not know {waybill}")
                    await asyncio.sleep(interval)
                    continue

                current = _flatten(results[0])
                (outdir / f"snap_{waybill}_{poll:04d}.json").write_text(json.dumps(body, indent=2))

                if previous is None:
                    print(f"[{stamp}] poll {poll}: BASELINE ({len(current)} fields)")
                    for key in _LIFECYCLE_KEYS:
                        print(f"          {key} = {current.get(key)!r}")
                    print()
                else:
                    diff = {
                        key: (previous.get(key), current.get(key))
                        for key in set(previous) | set(current)
                        if previous.get(key) != current.get(key)
                    }
                    if diff:
                        print(f"\n[{stamp}] poll {poll}: *** {len(diff)} FIELD(S) CHANGED ***")
                        for key, (old, new) in sorted(diff.items()):
                            entry = f"{key}: {old!r} -> {new!r}"
                            print(f"    {entry}")
                            changes.append(f"{stamp} {entry}")
                        print()
                        with change_log.open("a") as handle:
                            for entry in changes[-len(diff):]:
                                handle.write(entry + "\n")
                    else:
                        print(f"[{stamp}] poll {poll}: no change", end="\r", flush=True)

                previous = current
            except Exception as exc:
                # Never abort the run on one bad poll — a transient PP error must not
                # cost the whole observation window, which may be hard to reschedule.
                print(f"[{stamp}] poll {poll}: ERROR {exc!r}")

            await asyncio.sleep(interval)

    print("\n" + "=" * 72)
    print(f"RUN COMPLETE — {len(changes)} field change(s) observed")
    print("=" * 72)
    for entry in changes:
        print("  " + entry)
    if not changes:
        print("  NOTHING MOVED. If portal actions were performed during this window,")
        print("  PP does not surface them through getSingleWaybill.")
    print(f"\nSnapshots: {outdir}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Observe PP waybill field changes over time.")
    parser.add_argument("waybill", help="PP waybill number, e.g. GPC10592609")
    parser.add_argument("--interval", type=int, default=15, help="seconds between polls (default 15)")
    parser.add_argument("--minutes", type=int, default=45, help="total run time (default 45)")
    args = parser.parse_args()
    return asyncio.run(_run(args.waybill, args.interval, args.minutes))


if __name__ == "__main__":
    raise SystemExit(main())
