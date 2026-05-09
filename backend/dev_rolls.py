"""Dev Roll feature for $ROLLAT.

A parallel, admin-only spin mechanism. The admin schedules a roll by adding
entries (Solana wallets OR custom name+photo entries), picking a display pot
amount (NOT a real on-chain transfer), an exact UTC timestamp, and a mode:

  - single:      one winner picked uniformly at random when the time arrives
  - elimination: one entry eliminated per tick at a configured interval until
                 a single survivor remains

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
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

import base58
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from telegram_bot import (
    announce_dev_roll_scheduled,
    announce_dev_roll_spinning,
    announce_dev_roll_winner,
    announce_dev_roll_reminder,
    announce_buy_cta,
    announce_tournament_signups_open,
    announce_tournament_team_eliminated,
    announce_tournament_resolved,
)

logger = logging.getLogger(__name__)

# Animation duration the public widget renders for the spinning phase of a
# single-winner roll. Picked to roughly match the existing main-wheel reel
# feel; configurable via env so the admin can shorten/lengthen the suspense
# window without a deploy.
DEV_SPIN_ANIMATION_SECS = int(os.environ.get("DEV_SPIN_ANIMATION_SECS", "9"))

# Maximum pot value accepted on the form. Display-only — not enforced on-chain.
MAX_POT_SOL = 10_000.0

# How long the resolved winner card lingers on the public page after the spin
# finishes. After this window elapses, /dev/roll/current returns null again.
# 24h gives the community a full day to celebrate / share before the page
# clears for the next roll.
RESOLVED_DISPLAY_SECS = int(os.environ.get("DEV_ROLL_RESOLVED_DISPLAY_SECS", "86400"))

# Caps for elimination-mode interval (5 seconds .. 7 days).
MIN_ELIM_INTERVAL_SECS = 5
MAX_ELIM_INTERVAL_SECS = 7 * 24 * 3600

# Caps for entry counts and image payloads. Mongo's BSON document limit is
# 16 MB; we cap custom rolls comfortably under that with both a per-image
# cap AND a total-doc cap so a user can't stuff 40 max-size images and blow
# past 16 MB.
MAX_WALLET_ENTRIES = 500
MAX_CUSTOM_ENTRIES = 40
MAX_IMAGE_DATA_URL_LEN = 350_000   # ~260 KB decoded — plenty for a 512x512 JPEG
MAX_TOTAL_IMAGE_BYTES = 12_000_000 # leaves ~4 MB headroom under BSON 16 MB
MAX_NAME_LEN = 60

_DATA_URL_RE = re.compile(r"^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$")

# Last Team Standing: tournaments must have at least 3 and at most 20 teams.
MIN_TOURNAMENT_TEAMS = 3
MAX_TOURNAMENT_TEAMS = 20

# Optional injection of the TournamentStore from server.py (avoids an import
# cycle). Set via `set_tournament_store()` at app startup.
_tournament_store = None


def set_tournament_store(store) -> None:
    """server.py calls this at startup so the scheduler can bulk-eliminate
    supporters when a team falls. Stays None for unit tests / cold paths."""
    global _tournament_store
    _tournament_store = store


# ---------- model ----------

class RollEntry(BaseModel):
    """A single entry in a dev roll. Either a wallet (entry_type == 'wallet')
    or a custom name+image (entry_type == 'custom'). The `id` is stable across
    the roll's lifecycle so eliminations and the winner can reference it."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    wallet: Optional[str] = None
    name: Optional[str] = None
    image_data_url: Optional[str] = None


class EliminationEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    entry_id: str
    eliminated_at: datetime
    position: int  # 1 = first out, N-1 = runner-up


class DevRoll(BaseModel):
    """A scheduled or completed dev roll. Stored in `dev_rolls` collection."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: Optional[str] = None
    ten_min_warned: bool = False

    entry_type: Literal["wallet", "custom"] = "wallet"
    mode: Literal["single", "elimination"] = "single"
    elimination_interval_secs: Optional[int] = None  # required when mode == "elimination"

    # Last Team Standing flag — turns an elimination + custom roll into a
    # community tournament where supporters sign up to back a team and
    # share the pot when their team survives. See tournaments.py.
    is_tournament: bool = False
    # Populated on resolve when is_tournament=True. Frontend reads this for
    # the supporter list + per-wallet share. Never set on non-tournament rolls.
    tournament_payout: Optional[dict] = None

    entries: List[RollEntry] = Field(default_factory=list)
    survivors: List[str] = Field(default_factory=list)        # entry IDs still in
    eliminated: List[EliminationEvent] = Field(default_factory=list)
    next_elimination_at: Optional[datetime] = None

    pot_sol: float
    scheduled_at: datetime
    phase: str = "scheduled"  # scheduled | spinning | resolved | cancelled

    winner_entry_id: Optional[str] = None
    # Display-only mirror of the winner: wallet for wallet rolls, name for
    # custom rolls. Kept so old API consumers / Telegram code keep working.
    winner: Optional[str] = None

    spin_started_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy(cls, values):
        """Lazily migrate documents written by the pre-elimination version,
        which stored `wallets: [str]` instead of `entries: [RollEntry]`. We
        don't rewrite the Mongo doc — the migrated shape only lives in memory
        once it's read back."""
        if not isinstance(values, dict):
            return values
        if "entries" in values and values["entries"]:
            return values
        legacy_wallets = values.get("wallets")
        if isinstance(legacy_wallets, list) and legacy_wallets:
            values["entries"] = [
                {"id": str(uuid.uuid4()), "wallet": w} for w in legacy_wallets
            ]
            values.setdefault("entry_type", "wallet")
            values.setdefault("mode", "single")
            legacy_winner = values.get("winner")
            if legacy_winner and not values.get("winner_entry_id"):
                for e in values["entries"]:
                    if e["wallet"] == legacy_winner:
                        values["winner_entry_id"] = e["id"]
                        break
        return values


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


def validate_entries(raw_entries: List[dict], entry_type: str) -> List[RollEntry]:
    """Validate and normalize a list of entries. Each entry must match the
    declared `entry_type`. Returns RollEntry instances ready to embed into
    DevRoll. Raises HTTPException(400) on any failure."""
    if not isinstance(raw_entries, list) or not raw_entries:
        raise HTTPException(status_code=400, detail="entries list is required")

    cleaned: List[RollEntry] = []
    seen_wallets: set[str] = set()

    for raw in raw_entries:
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="each entry must be an object")

        if entry_type == "wallet":
            wallet = str(raw.get("wallet") or "").strip()
            if not wallet:
                raise HTTPException(status_code=400, detail="wallet entry missing 'wallet' field")
            if not _is_valid_solana_address(wallet):
                raise HTTPException(status_code=400, detail=f"invalid wallet: {wallet[:24]}…")
            if raw.get("name") or raw.get("image_data_url"):
                raise HTTPException(status_code=400, detail="wallet entries must not include name/image_data_url")
            if wallet in seen_wallets:
                continue  # silent dedupe matches the prior wallets-array behavior
            seen_wallets.add(wallet)
            cleaned.append(RollEntry(wallet=wallet))

        elif entry_type == "custom":
            name = str(raw.get("name") or "").strip()
            image = str(raw.get("image_data_url") or "")
            if not name:
                raise HTTPException(status_code=400, detail="custom entry missing 'name'")
            if len(name) > MAX_NAME_LEN:
                raise HTTPException(status_code=400, detail=f"name too long (max {MAX_NAME_LEN} chars)")
            if not image:
                raise HTTPException(status_code=400, detail=f"custom entry '{name}' missing image")
            if len(image) > MAX_IMAGE_DATA_URL_LEN:
                raise HTTPException(
                    status_code=400,
                    detail=f"image for '{name}' too large — resize/compress before upload",
                )
            if not _DATA_URL_RE.match(image):
                raise HTTPException(
                    status_code=400,
                    detail=f"image for '{name}' must be a data URL (image/png|jpeg|webp)",
                )
            if raw.get("wallet"):
                raise HTTPException(status_code=400, detail="custom entries must not include 'wallet'")
            cleaned.append(RollEntry(name=name, image_data_url=image))

        else:
            raise HTTPException(status_code=400, detail=f"unknown entry_type '{entry_type}'")

    if not cleaned:
        raise HTTPException(status_code=400, detail="no valid entries supplied")

    cap = MAX_WALLET_ENTRIES if entry_type == "wallet" else MAX_CUSTOM_ENTRIES
    if len(cleaned) > cap:
        raise HTTPException(status_code=400, detail=f"too many entries (max {cap} for {entry_type} rolls)")

    # Aggregate-size guard for custom rolls: even 40 max-size images (40 ×
    # 350 KB ≈ 14 MB) brushes against the 16 MB BSON ceiling. Reject early
    # so the admin gets a clear 400 instead of a silent Mongo write failure.
    if entry_type == "custom":
        total_image_bytes = sum(len(e.image_data_url or "") for e in cleaned)
        if total_image_bytes > MAX_TOTAL_IMAGE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=(
                    "images total too large — combined image data exceeds the "
                    "per-roll limit. Reduce the number of entries or compress further."
                ),
            )

    return cleaned


_DT_FIELDS = (
    "scheduled_at", "spin_started_at", "resolved_at",
    "cancelled_at", "created_at", "next_elimination_at",
)


def _patch_tz(doc: dict) -> dict:
    """Mongo (Motor without `tz_aware=True`) returns datetimes as tz-naive.
    Pydantic v2's `model_dump(mode="json")` then emits them as ISO strings
    WITHOUT a timezone marker — and JS `new Date(...)` parses tz-less ISO
    strings as **local time**, which makes the public countdown stick at
    00:00 for any user not in UTC.

    We pre-patch every datetime field on the doc to be tz-aware UTC so the
    serialized output carries `+00:00`."""
    out = dict(doc)
    for k in _DT_FIELDS:
        v = out.get(k)
        if isinstance(v, datetime) and v.tzinfo is None:
            out[k] = v.replace(tzinfo=timezone.utc)
    if isinstance(out.get("eliminated"), list):
        patched_events = []
        for ev in out["eliminated"]:
            if isinstance(ev, dict):
                ev = dict(ev)
                ts = ev.get("eliminated_at")
                if isinstance(ts, datetime) and ts.tzinfo is None:
                    ev["eliminated_at"] = ts.replace(tzinfo=timezone.utc)
            patched_events.append(ev)
        out["eliminated"] = patched_events
    return out


def _normalize_doc(doc: Optional[dict], *, strip_images: bool = False) -> Optional[dict]:
    """Strip Mongo's `_id`, run the legacy migrator, ensure all datetime
    fields are tz-aware UTC (so the JSON response emits a timezone marker),
    and coerce datetimes to ISO strings via Pydantic. When `strip_images=True`,
    drop heavy `image_data_url` fields from entries (used for history list
    responses)."""
    if not doc:
        return None
    patched = _patch_tz(doc)
    try:
        roll = DevRoll.model_validate(patched)
    except Exception:
        # Fall back to a raw dump if a doc somehow can't be migrated.
        out = {k: v for k, v in patched.items() if k != "_id"}
        for k in _DT_FIELDS:
            v = out.get(k)
            if isinstance(v, datetime):
                out[k] = _ensure_utc(v).isoformat()
        return out

    out = roll.model_dump(mode="json")  # converts datetimes to ISO strings
    if strip_images and out.get("entry_type") == "custom":
        for e in out.get("entries", []):
            if e.get("image_data_url"):
                e["image_data_url"] = None
    return out


def _entry_label(entry: RollEntry) -> str:
    """Human-readable label for an entry — used in Telegram messages."""
    if entry.wallet:
        return entry.wallet
    return entry.name or "(unnamed)"


def _validate_interval(secs: Optional[int]) -> int:
    if secs is None:
        raise HTTPException(status_code=400, detail="elimination_interval_secs is required for elimination mode")
    try:
        secs = int(secs)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="elimination_interval_secs must be an integer")
    if secs < MIN_ELIM_INTERVAL_SECS:
        raise HTTPException(status_code=400, detail=f"interval must be ≥ {MIN_ELIM_INTERVAL_SECS} seconds")
    if secs > MAX_ELIM_INTERVAL_SECS:
        raise HTTPException(status_code=400, detail="interval must be ≤ 7 days")
    return secs


# ---------- repository ----------

async def has_active_roll(col) -> bool:
    """True iff some roll is in scheduled or spinning phase."""
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    return bool(doc)


async def create_dev_roll(
    col,
    *,
    title: Optional[str] = None,
    entry_type: str = "wallet",
    mode: str = "single",
    elimination_interval_secs: Optional[int] = None,
    entries: List[dict],
    pot_sol: float,
    scheduled_at: datetime,
    created_by: str,
    is_tournament: bool = False,
) -> dict:
    if entry_type not in ("wallet", "custom"):
        raise HTTPException(status_code=400, detail="entry_type must be 'wallet' or 'custom'")
    if mode not in ("single", "elimination"):
        raise HTTPException(status_code=400, detail="mode must be 'single' or 'elimination'")

    if title is not None:
        title = str(title).strip()[:60] or None

    cleaned_entries = validate_entries(entries, entry_type)

    if mode == "elimination":
        if len(cleaned_entries) < 2:
            raise HTTPException(status_code=400, detail="elimination roll needs at least 2 entries")
        elimination_interval_secs = _validate_interval(elimination_interval_secs)
    else:
        elimination_interval_secs = None  # ignore for single-mode

    # Last Team Standing tournaments layer extra constraints on top of
    # elimination + custom rolls.
    if is_tournament:
        if mode != "elimination":
            raise HTTPException(status_code=400, detail="Last Team Standing requires elimination mode")
        if entry_type != "custom":
            raise HTTPException(status_code=400, detail="Last Team Standing requires custom (name+photo) entries")
        if not (MIN_TOURNAMENT_TEAMS <= len(cleaned_entries) <= MAX_TOURNAMENT_TEAMS):
            raise HTTPException(
                status_code=400,
                detail=f"Last Team Standing needs {MIN_TOURNAMENT_TEAMS}–{MAX_TOURNAMENT_TEAMS} teams",
            )
        # Team names must be unique (case-insensitive) so supporters can
        # identify their pick unambiguously.
        seen_names: set[str] = set()
        for e in cleaned_entries:
            n = (e.name or "").strip().lower()
            if n in seen_names:
                raise HTTPException(status_code=400, detail=f"duplicate team name: {e.name}")
            seen_names.add(n)

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
        title=title,
        entry_type=entry_type,
        mode=mode,
        elimination_interval_secs=elimination_interval_secs,
        is_tournament=bool(is_tournament),
        entries=cleaned_entries,
        pot_sol=pot_value,
        scheduled_at=sched,
        created_by=created_by,
    )
    doc = roll.model_dump()
    await col.insert_one(doc)
    normalized = _normalize_doc(doc)
    asyncio.create_task(announce_dev_roll_scheduled(
        title=title,
        pot_sol=pot_value,
        wallet_count=len(cleaned_entries),
        scheduled_at_iso=normalized.get("scheduled_at", ""),
    ))
    if is_tournament:
        asyncio.create_task(announce_tournament_signups_open(
            title=title,
            pot_sol=pot_value,
            team_count=len(cleaned_entries),
            scheduled_at_iso=normalized.get("scheduled_at", ""),
            roll_id=normalized.get("id", ""),
        ))
    return normalized


async def update_dev_roll(
    col,
    roll_id: str,
    *,
    entries_to_add: Optional[List[dict]] = None,
    title: Optional[str] = None,
    pot_sol: Optional[float] = None,
    scheduled_at: Optional[datetime] = None,
) -> dict:
    """Edit a still-scheduled roll. Entries are appended (deduped on wallet
    for wallet rolls)."""
    doc = await col.find_one({"id": roll_id})
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    if doc.get("phase") != "scheduled":
        raise HTTPException(status_code=400, detail=f"cannot edit a roll in phase '{doc.get('phase')}'")

    existing_roll = DevRoll.model_validate(doc)
    updates: dict = {}

    if entries_to_add is not None:
        new_validated = validate_entries(entries_to_add, existing_roll.entry_type)
        merged = list(existing_roll.entries)
        if existing_roll.entry_type == "wallet":
            seen = {e.wallet for e in merged}
            for e in new_validated:
                if e.wallet not in seen:
                    merged.append(e)
                    seen.add(e.wallet)
        else:
            merged.extend(new_validated)
        cap = MAX_WALLET_ENTRIES if existing_roll.entry_type == "wallet" else MAX_CUSTOM_ENTRIES
        if len(merged) > cap:
            raise HTTPException(status_code=400, detail=f"too many entries (max {cap})")
        if existing_roll.entry_type == "custom":
            total_image_bytes = sum(len(e.image_data_url or "") for e in merged)
            if total_image_bytes > MAX_TOTAL_IMAGE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="adding these entries would exceed the combined image-size limit",
                )
        updates["entries"] = [e.model_dump() for e in merged]

    if title is not None:
        updates["title"] = str(title).strip()[:60] or None

    if pot_sol is not None:
        try:
            pot_value = float(pot_sol)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="pot_sol must be a number")
        if pot_value < 0 or pot_value > MAX_POT_SOL:
            raise HTTPException(status_code=400, detail=f"pot_sol must be 0–{MAX_POT_SOL}")
        updates["pot_sol"] = pot_value

    if scheduled_at is not None:
        sched = _ensure_utc(scheduled_at)
        if sched <= datetime.now(timezone.utc) + timedelta(seconds=5):
            raise HTTPException(status_code=400, detail="scheduled_at must be at least 5 seconds in the future")
        updates["scheduled_at"] = sched
        updates["ten_min_warned"] = False

    if not updates:
        return _normalize_doc(doc)

    await col.update_one({"id": roll_id}, {"$set": updates})
    updated = await col.find_one({"id": roll_id})
    return _normalize_doc(updated)


async def cancel_dev_roll(col, roll_id: str) -> dict:
    doc = await col.find_one({"id": roll_id})
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    phase = doc.get("phase")
    if phase not in ("scheduled", "spinning"):
        raise HTTPException(status_code=400, detail=f"cannot cancel a roll in phase '{phase}'")
    await col.update_one(
        {"id": roll_id},
        {"$set": {
            "phase": "cancelled",
            "cancelled_at": datetime.now(timezone.utc),
            "next_elimination_at": None,
        }},
    )
    updated = await col.find_one({"id": roll_id})
    return _normalize_doc(updated)


async def fetch_current_dev_roll(col, *, linger_secs: Optional[int] = None) -> Optional[dict]:
    """Returns the roll the public page should display, or None if there's
    nothing to show. Includes resolved rolls for a lingering window so the
    winner card stays visible after the spin lands.

    `linger_secs` overrides the module default (used by server.py to thread
    the runtime-config value through). Falls back to RESOLVED_DISPLAY_SECS
    when not provided."""
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    if doc:
        return _normalize_doc(doc)

    secs = int(linger_secs) if linger_secs is not None else RESOLVED_DISPLAY_SECS
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=secs)
    cur = col.find({"phase": "resolved", "resolved_at": {"$gte": cutoff}}).sort("resolved_at", -1).limit(1)
    docs = await cur.to_list(1)
    return _normalize_doc(docs[0]) if docs else None


async def list_dev_rolls(col, limit: int = 50) -> List[dict]:
    """History list. Heavy `image_data_url` fields are stripped to keep the
    response payload small — admin can fetch a single roll for the full data."""
    cur = col.find({}).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [_normalize_doc(d, strip_images=True) for d in docs]


async def fetch_dev_roll(col, roll_id: str) -> Optional[dict]:
    doc = await col.find_one({"id": roll_id})
    return _normalize_doc(doc)


# ---------- scheduler ----------

async def _resolve_single_roll(col, roll_doc: dict) -> None:
    """Single-winner path: flip to spinning, sleep through the animation
    window, pick a winner uniformly at random, transition to resolved."""
    roll_id = roll_doc["id"]
    now = datetime.now(timezone.utc)

    try:
        result = await col.update_one(
            {"id": roll_id, "phase": "scheduled"},
            {"$set": {"phase": "spinning", "spin_started_at": now}},
        )
        matched = getattr(result, "matched_count", None)
        if matched == 0:
            return
    except Exception:
        logger.exception(f"[dev_roll] phase flip failed for {roll_id}")
        return

    refreshed = await col.find_one({"id": roll_id})
    if not refreshed or refreshed.get("phase") != "spinning":
        return

    try:
        roll = DevRoll.model_validate(refreshed)
    except Exception:
        logger.exception(f"[dev_roll] could not parse roll {roll_id}")
        return

    logger.info(
        f"[dev_roll] spinning roll {roll_id} "
        f"({len(roll.entries)} {roll.entry_type} entries, pot={roll.pot_sol})"
    )
    asyncio.create_task(announce_dev_roll_spinning(
        title=roll.title,
        pot_sol=roll.pot_sol,
        wallet_count=len(roll.entries),
    ))

    await asyncio.sleep(DEV_SPIN_ANIMATION_SECS)

    rng = secrets.SystemRandom()
    winner_entry = rng.choice(roll.entries)
    resolved_at = datetime.now(timezone.utc)
    # Guard against mid-animation cancellation: only commit if still spinning.
    result = await col.update_one(
        {"id": roll_id, "phase": "spinning"},
        {"$set": {
            "phase": "resolved",
            "winner_entry_id": winner_entry.id,
            "winner": _entry_label(winner_entry),
            "resolved_at": resolved_at,
        }},
    )
    if getattr(result, "matched_count", 0) == 0:
        logger.info(f"[dev_roll] roll {roll_id} cancelled mid-spin; skipping winner")
        return
    logger.info(f"[dev_roll] resolved roll {roll_id} -> {_entry_label(winner_entry)}")
    asyncio.create_task(announce_dev_roll_winner(
        title=roll.title,
        winner_wallet=winner_entry.wallet or _entry_label(winner_entry),
        pot_sol=roll.pot_sol,
        is_wallet=bool(winner_entry.wallet),
    ))
    asyncio.create_task(announce_buy_cta())


async def _start_elimination_roll(col, roll_doc: dict) -> None:
    """Flip a scheduled elimination roll to 'spinning' and prime its
    elimination clock. Idempotent: a second worker that loses the race is
    a no-op."""
    roll_id = roll_doc["id"]
    now = datetime.now(timezone.utc)

    try:
        roll = DevRoll.model_validate(roll_doc)
    except Exception:
        logger.exception(f"[dev_roll] could not parse roll {roll_id}")
        return

    interval = roll.elimination_interval_secs or MIN_ELIM_INTERVAL_SECS
    survivors = [e.id for e in roll.entries]
    next_at = now + timedelta(seconds=interval)

    result = await col.update_one(
        {"id": roll_id, "phase": "scheduled"},
        {"$set": {
            "phase": "spinning",
            "spin_started_at": now,
            "survivors": survivors,
            "eliminated": [],
            "next_elimination_at": next_at,
        }},
    )
    if getattr(result, "matched_count", 0) == 0:
        return  # lost the race

    logger.info(
        f"[dev_roll] elimination started for {roll_id} "
        f"({len(survivors)} entries, interval={interval}s)"
    )
    asyncio.create_task(announce_dev_roll_spinning(
        title=roll.title,
        pot_sol=roll.pot_sol,
        wallet_count=len(survivors),
    ))


async def _tick_elimination_roll(col, roll_doc: dict) -> None:
    """Elimination tick: pick one survivor uniformly at random and remove
    them. If a single survivor remains afterward, transition to resolved.
    Race-safe via a $set guarded by the prior next_elimination_at value."""
    roll_id = roll_doc["id"]
    now = datetime.now(timezone.utc)

    try:
        roll = DevRoll.model_validate(roll_doc)
    except Exception:
        logger.exception(f"[dev_roll] could not parse roll {roll_id}")
        return

    if not roll.survivors or len(roll.survivors) < 2:
        # Nothing to eliminate — or already down to 1.  Defensive recovery:
        #   1 survivor → finalize as the winner (shouldn't normally hit; the
        #     final-elimination branch below handles the regular path).
        #   0 survivors → roll is corrupt; force-resolve with no winner so
        #     the scheduler stops re-querying it forever.
        if roll.survivors and len(roll.survivors) == 1 and not roll.winner_entry_id:
            await _finalize_winner(col, roll, roll.survivors[0], now)
        elif not roll.survivors and not roll.winner_entry_id:
            logger.warning(f"[dev_roll] {roll_id} has empty survivors — force-resolving with no winner")
            await col.update_one(
                {"id": roll_id, "phase": "spinning"},
                {"$set": {
                    "phase": "resolved",
                    "winner": None,
                    "winner_entry_id": None,
                    "resolved_at": now,
                    "next_elimination_at": None,
                }},
            )
        return

    rng = secrets.SystemRandom()
    loser_id = rng.choice(roll.survivors)
    new_survivors = [s for s in roll.survivors if s != loser_id]
    interval = roll.elimination_interval_secs or MIN_ELIM_INTERVAL_SECS
    elim_event = EliminationEvent(
        entry_id=loser_id,
        eliminated_at=now,
        position=len(roll.eliminated) + 1,
    ).model_dump()

    if len(new_survivors) == 1:
        # Final elimination — winner emerges.
        winner_id = new_survivors[0]
        winner_entry = next((e for e in roll.entries if e.id == winner_id), None)

        # Tournament payout: pre-compute supporter shares so the public
        # reveal page can render without a second round-trip.
        tournament_payout: Optional[dict] = None
        if roll.is_tournament and _tournament_store is not None:
            try:
                # Mark the final loser's supporters too (consistent with the
                # per-tick path below).
                await _tournament_store.eliminate_team_supporters(
                    roll_id=roll_id, team_entry_id=loser_id, when=now,
                )
                survivors_docs = await _tournament_store.list_supporters(
                    roll_id, only_alive=True,
                )
                # Sanity: only count supporters who actually backed the
                # winning team.
                winners = [
                    s for s in survivors_docs
                    if s.get("team_entry_id") == winner_id
                ]
                count = len(winners)
                share = (float(roll.pot_sol) / count) if count > 0 else 0.0
                tournament_payout = {
                    "winning_team_entry_id": winner_id,
                    "supporter_count": count,
                    "share_sol": round(share, 6),
                    "total_share_sol": round(share * count, 6),
                    "supporters": [
                        {
                            "wallet": s["wallet"],
                            "x_handle": s.get("x_handle", ""),
                            "share_sol": round(share, 6),
                        }
                        for s in winners
                    ],
                }
            except Exception:
                logger.exception(f"[dev_roll] tournament payout calc failed for {roll_id}")

        update_set = {
            "survivors": new_survivors,
            "phase": "resolved",
            "winner_entry_id": winner_id,
            "winner": _entry_label(winner_entry) if winner_entry else None,
            "resolved_at": now,
            "next_elimination_at": None,
        }
        if tournament_payout is not None:
            update_set["tournament_payout"] = tournament_payout

        update = {"$set": update_set, "$push": {"eliminated": elim_event}}
        result = await col.update_one(
            {"id": roll_id, "phase": "spinning", "mode": "elimination",
             "next_elimination_at": roll.next_elimination_at},
            update,
        )
        if getattr(result, "matched_count", 0) == 0:
            return
        logger.info(
            f"[dev_roll] elimination resolved {roll_id} -> "
            f"{_entry_label(winner_entry) if winner_entry else winner_id}"
        )
        if winner_entry:
            if roll.is_tournament:
                asyncio.create_task(announce_tournament_resolved(
                    title=roll.title,
                    team_name=winner_entry.name or _entry_label(winner_entry),
                    pot_sol=roll.pot_sol,
                    supporter_count=(tournament_payout or {}).get("supporter_count", 0),
                    share_sol=(tournament_payout or {}).get("share_sol", 0.0),
                ))
            else:
                asyncio.create_task(announce_dev_roll_winner(
                    title=roll.title,
                    winner_wallet=winner_entry.wallet or _entry_label(winner_entry),
                    pot_sol=roll.pot_sol,
                    is_wallet=bool(winner_entry.wallet),
                ))
            asyncio.create_task(announce_buy_cta())
    else:
        update = {
            "$set": {
                "survivors": new_survivors,
                "next_elimination_at": now + timedelta(seconds=interval),
            },
            "$push": {"eliminated": elim_event},
        }
        result = await col.update_one(
            {"id": roll_id, "phase": "spinning", "mode": "elimination",
             "next_elimination_at": roll.next_elimination_at},
            update,
        )
        if getattr(result, "matched_count", 0) == 0:
            return
        logger.info(
            f"[dev_roll] elimination tick {roll_id}: "
            f"{len(roll.survivors)} -> {len(new_survivors)} (out: {loser_id[:8]})"
        )

        # Tournament: bulk-eliminate the supporters of the team that just fell
        # and announce on Telegram. Best-effort — failures don't stall the
        # scheduler.
        if roll.is_tournament:
            loser_entry = next((e for e in roll.entries if e.id == loser_id), None)
            loser_name = (loser_entry.name if loser_entry else "(unknown)") or "(unknown)"
            if _tournament_store is not None:
                try:
                    await _tournament_store.eliminate_team_supporters(
                        roll_id=roll_id, team_entry_id=loser_id, when=now,
                    )
                except Exception:
                    logger.exception(f"[dev_roll] supporter elim failed for {roll_id}")
            asyncio.create_task(announce_tournament_team_eliminated(
                title=roll.title,
                team_name=loser_name,
                position=elim_event["position"],
                remaining=len(new_survivors),
                pot_sol=roll.pot_sol,
            ))


async def _finalize_winner(col, roll: DevRoll, winner_id: str, now: datetime) -> None:
    """Defensive helper for the edge case where survivors collapses to 1
    without a final elimination tick (e.g., bad data). Idempotent."""
    winner_entry = next((e for e in roll.entries if e.id == winner_id), None)
    await col.update_one(
        {"id": roll.id, "phase": "spinning"},
        {"$set": {
            "phase": "resolved",
            "winner_entry_id": winner_id,
            "winner": _entry_label(winner_entry) if winner_entry else None,
            "resolved_at": now,
            "next_elimination_at": None,
        }},
    )


async def run_due_rolls(col) -> int:
    """Scheduler tick. Fires due single rolls, starts due elimination rolls,
    advances elimination rolls whose next tick has arrived, and sends the
    10-minute reminder for upcoming rolls. Returns approximate work done."""
    now = datetime.now(timezone.utc)

    # 10-minute reminder window.
    reminder_lo = now + timedelta(seconds=570)
    reminder_hi = now + timedelta(seconds=630)
    unwarneds = col.find({
        "phase": "scheduled",
        "ten_min_warned": False,
        "scheduled_at": {"$gte": reminder_lo, "$lte": reminder_hi},
    }).limit(5)
    for doc in await unwarneds.to_list(5):
        await col.update_one({"id": doc["id"]}, {"$set": {"ten_min_warned": True}})
        try:
            count = len(doc.get("entries") or doc.get("wallets") or [])
        except Exception:
            count = 0
        asyncio.create_task(announce_dev_roll_reminder(
            title=doc.get("title"),
            pot_sol=doc.get("pot_sol", 0.0),
            wallet_count=count,
        ))

    work = 0

    # 1) Newly-due scheduled rolls — fire by mode.
    due_cur = col.find({
        "phase": "scheduled",
        "scheduled_at": {"$lte": now},
    }).limit(5)
    for doc in await due_cur.to_list(5):
        try:
            mode = doc.get("mode", "single")
            if mode == "elimination":
                await _start_elimination_roll(col, doc)
            else:
                await _resolve_single_roll(col, doc)
            work += 1
        except Exception:
            logger.exception(f"[dev_roll] failed to start roll {doc.get('id')}")

    # 2) Elimination rolls that have ticked.
    tick_cur = col.find({
        "phase": "spinning",
        "mode": "elimination",
        "next_elimination_at": {"$ne": None, "$lte": now},
    }).limit(5)
    for doc in await tick_cur.to_list(5):
        try:
            await _tick_elimination_roll(col, doc)
            work += 1
        except Exception:
            logger.exception(f"[dev_roll] failed to tick roll {doc.get('id')}")

    return work


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
