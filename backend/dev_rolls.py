"""Dev Roll feature for $ROLLAT.

A parallel, admin-only spin mechanism. The admin schedules a roll by pasting
wallets, picking a display pot amount (NOT a real on-chain transfer), and an
exact UTC timestamp. A background scheduler picks one winner uniformly at
random when that time arrives. The roll's lifecycle is visible publicly on the
landing page so anyone can watch it run.

Storage is fully separate from the real `winners` collection so dev rolls
NEVER appear in Hall of Fame or affect `total_distributed_sol`,
`biggest_win_sol`, or `spins_completed` stats.

Phases: scheduled -> spinning -> resolved
        scheduled -> cancelled (admin action only)
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import base58
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)

# Animation duration the public widget renders for the spinning phase.
# Picked to roughly match the existing main-wheel reel feel; configurable via
# env so the admin can shorten/lengthen the suspense window without a deploy.
DEV_SPIN_ANIMATION_SECS = int(os.environ.get("DEV_SPIN_ANIMATION_SECS", "9"))

# Maximum pot value accepted on the form. Display-only — not enforced on-chain.
MAX_POT_SOL = 10_000.0

# How long the resolved winner card lingers on the public page after the spin
# finishes. After this window elapses, /dev/roll/current returns null again.
RESOLVED_DISPLAY_SECS = 60


# ---------- model ----------

class DevRoll(BaseModel):
    """A scheduled or completed dev roll. Stored in `dev_rolls` collection."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    wallets: List[str]
    pot_sol: float
    scheduled_at: datetime
    phase: str = "scheduled"            # scheduled | spinning | resolved | cancelled
    winner: Optional[str] = None
    spin_started_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str


# ---------- helpers ----------

def _is_valid_solana_address(addr: str) -> bool:
    if not isinstance(addr, str):
        return False
    if len(addr) < 32 or len(addr) > 44:
        return False
    try:
        raw = base58.b58decode(addr)
        return len(raw) == 32
    except Exception:
        return False


def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def validate_wallets(raw: List[str]) -> List[str]:
    """Strip whitespace, drop blanks, dedupe (preserving order), reject anything
    that isn't a valid base58 Solana pubkey. Raises HTTPException(400) with a
    message naming the offending input on any failure."""
    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="wallets list is required")

    seen: set[str] = set()
    cleaned: List[str] = []
    for entry in raw:
        if entry is None:
            continue
        addr = str(entry).strip()
        if not addr:
            continue
        if addr in seen:
            continue
        if not _is_valid_solana_address(addr):
            raise HTTPException(status_code=400, detail=f"invalid wallet: {addr[:24]}…")
        seen.add(addr)
        cleaned.append(addr)

    if not cleaned:
        raise HTTPException(status_code=400, detail="no valid wallets supplied")
    if len(cleaned) > 500:
        raise HTTPException(status_code=400, detail="too many wallets (max 500)")
    return cleaned


def _normalize_doc(doc: Optional[dict]) -> Optional[dict]:
    """Strip Mongo's `_id` and coerce datetimes to ISO strings for JSON output."""
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    for k in ("scheduled_at", "spin_started_at", "resolved_at", "cancelled_at", "created_at"):
        v = out.get(k)
        if isinstance(v, datetime):
            out[k] = _ensure_utc(v).isoformat()
    return out


# ---------- repository ----------

async def has_active_roll(col) -> bool:
    """True iff some roll is in scheduled or spinning phase."""
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    return bool(doc)


async def create_dev_roll(
    col,
    *,
    wallets: List[str],
    pot_sol: float,
    scheduled_at: datetime,
    created_by: str,
) -> dict:
    cleaned = validate_wallets(wallets)

    try:
        pot_value = float(pot_sol)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="pot_sol must be a number")
    if pot_value < 0 or pot_value > MAX_POT_SOL:
        raise HTTPException(status_code=400, detail=f"pot_sol must be between 0 and {MAX_POT_SOL}")

    sched = _ensure_utc(scheduled_at)
    now = datetime.now(timezone.utc)
    if sched <= now + timedelta(seconds=5):
        raise HTTPException(status_code=400, detail="scheduled_at must be at least 5 seconds in the future")

    if await has_active_roll(col):
        raise HTTPException(status_code=400, detail="another dev roll is already active — cancel it first")

    roll = DevRoll(
        wallets=cleaned,
        pot_sol=pot_value,
        scheduled_at=sched,
        created_by=created_by,
    )
    doc = roll.model_dump()
    # Mongo motor handles datetime natively; nothing to coerce.
    await col.insert_one(doc)
    return _normalize_doc(doc)


async def cancel_dev_roll(col, roll_id: str) -> dict:
    doc = await col.find_one({"id": roll_id})
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    if doc.get("phase") != "scheduled":
        raise HTTPException(status_code=400, detail=f"cannot cancel a roll in phase '{doc.get('phase')}'")
    await col.update_one(
        {"id": roll_id},
        {"$set": {"phase": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    updated = await col.find_one({"id": roll_id})
    return _normalize_doc(updated)


async def fetch_current_dev_roll(col) -> Optional[dict]:
    """Returns the roll the public page should display, or None if there's
    nothing to show. Includes resolved rolls for a brief lingering window so
    the winner card stays visible after the spin lands."""
    # Active first.
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    if doc:
        return _normalize_doc(doc)

    # Recently resolved? Linger for RESOLVED_DISPLAY_SECS.
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=RESOLVED_DISPLAY_SECS)
    cur = col.find({"phase": "resolved", "resolved_at": {"$gte": cutoff}}).sort("resolved_at", -1).limit(1)
    docs = await cur.to_list(1)
    return _normalize_doc(docs[0]) if docs else None


async def list_dev_rolls(col, limit: int = 50) -> List[dict]:
    cur = col.find({}).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [_normalize_doc(d) for d in docs]


# ---------- scheduler ----------

async def _resolve_one_roll(col, roll: dict) -> None:
    """Transition scheduled -> spinning, sleep for the animation window, pick
    a winner uniformly at random, transition to resolved.

    The transition to spinning is recorded immediately so multiple workers (or
    tabs polling /dev/roll/current) can see the wheel turning before the
    winner is committed."""
    roll_id = roll["id"]
    now = datetime.now(timezone.utc)

    # Race-safe: only flip the phase if it's still 'scheduled'. Motor's
    # update_one returns a result with matched_count we could check, but the
    # in-memory fallback collection used in dev doesn't support that — so we
    # re-read the doc instead. The scheduler runs single-instance anyway.
    await col.update_one(
        {"id": roll_id, "phase": "scheduled"},
        {"$set": {"phase": "spinning", "spin_started_at": now}},
    )
    refreshed = await col.find_one({"id": roll_id})
    if not refreshed or refreshed.get("phase") != "spinning":
        # Something else moved it (cancelled? already running?). Skip.
        return

    logger.info(f"[dev_roll] spinning roll {roll_id} ({len(refreshed['wallets'])} wallets, pot={refreshed['pot_sol']})")

    # Suspense window matches the public widget's animation duration.
    await asyncio.sleep(DEV_SPIN_ANIMATION_SECS)

    winner = random.choice(refreshed["wallets"])
    resolved_at = datetime.now(timezone.utc)
    await col.update_one(
        {"id": roll_id},
        {"$set": {"phase": "resolved", "winner": winner, "resolved_at": resolved_at}},
    )
    logger.info(f"[dev_roll] resolved roll {roll_id} -> {winner}")


async def run_due_rolls(col) -> int:
    """Find every scheduled roll whose time has arrived and resolve it.
    Returns the number of rolls fired this tick (typically 0 or 1)."""
    now = datetime.now(timezone.utc)
    cur = col.find({"phase": "scheduled", "scheduled_at": {"$lte": now}}).limit(5)
    due = await cur.to_list(5)
    if not due:
        return 0
    # Run them sequentially — there should rarely be more than one and the
    # animation sleep would overlap awkwardly otherwise.
    for roll in due:
        try:
            await _resolve_one_roll(col, roll)
        except Exception:
            logger.exception(f"[dev_roll] failed to resolve roll {roll.get('id')}")
    return len(due)


async def dev_scheduler_loop(get_col) -> None:
    """Background asyncio task. Polls every 3 seconds for due rolls."""
    logger.info("[dev_roll] scheduler started")
    while True:
        try:
            col = get_col("dev_rolls")
            await run_due_rolls(col)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[dev_roll] scheduler tick failed")
        await asyncio.sleep(3)
