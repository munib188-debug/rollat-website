"""Guest Roll feature for $ROLLAT.

A roll where 10 partner coins/communities compete for a single prize
(typically a DexScreener boost). Each entry is a coin (name, ticker, logo,
link) — not a wallet — and the winner is one coin chosen uniformly at
random. Storage lives in `guest_rolls`, fully separate from `winners`,
`dev_rolls`, and the daily spin so it never pollutes the real prize stats.

Phases mirror dev_rolls: scheduled -> spinning -> resolved
                        scheduled -> cancelled
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from telegram_bot import (
    announce_guest_roll_scheduled,
    announce_guest_roll_spinning,
    announce_guest_roll_winner,
)

logger = logging.getLogger(__name__)

# Wheel animation duration (frontend matches this for the spin reveal).
GUEST_SPIN_ANIMATION_SECS = int(os.environ.get("GUEST_SPIN_ANIMATION_SECS", "10"))

# How long the winner card lingers on the public page after the spin lands.
RESOLVED_DISPLAY_SECS = 600

# Hard limits on entry count. Wheel UI is tuned for ~10 but accommodates 3–12.
MIN_ENTRIES = 3
MAX_ENTRIES = 12


# ---------- model ----------

class GuestEntry(BaseModel):
    """A single coin/community competing in the roll."""
    model_config = ConfigDict(extra="ignore")

    name: str
    ticker: str
    logo_url: Optional[str] = None
    link: Optional[str] = None


class GuestRoll(BaseModel):
    """A scheduled or completed guest roll. Stored in `guest_rolls`."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: Optional[str] = None              # e.g. "Cycle #1"
    prize_label: str = "DexScreener Boost"   # what the winner receives
    entries: List[GuestEntry]
    scheduled_at: datetime
    phase: str = "scheduled"                 # scheduled | spinning | resolved | cancelled
    winner_index: Optional[int] = None
    winner: Optional[GuestEntry] = None
    spin_started_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_by: str


# ---------- helpers ----------

def _ensure_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _clean_str(v, max_len: int) -> str:
    if v is None:
        return ""
    return str(v).strip()[:max_len]


def validate_entries(raw: List[dict]) -> List[GuestEntry]:
    """Normalize and validate entries. Each entry needs at least a name + ticker."""
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="entries must be a list")
    if len(raw) < MIN_ENTRIES:
        raise HTTPException(status_code=400, detail=f"need at least {MIN_ENTRIES} entries")
    if len(raw) > MAX_ENTRIES:
        raise HTTPException(status_code=400, detail=f"too many entries (max {MAX_ENTRIES})")

    cleaned: List[GuestEntry] = []
    seen_tickers: set[str] = set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail=f"entry {i+1} must be an object")
        name = _clean_str(item.get("name"), 40)
        ticker = _clean_str(item.get("ticker"), 16).upper().lstrip("$")
        # logo_url accepts http(s) URLs OR base64 data URLs from direct upload (compressed client-side, ~50KB typical).
        logo_url = _clean_str(item.get("logo_url"), 400_000) or None
        link = _clean_str(item.get("link"), 500) or None

        if not name:
            raise HTTPException(status_code=400, detail=f"entry {i+1}: name is required")
        if not ticker:
            raise HTTPException(status_code=400, detail=f"entry {i+1} ({name}): ticker is required")
        if ticker in seen_tickers:
            raise HTTPException(status_code=400, detail=f"duplicate ticker: ${ticker}")
        seen_tickers.add(ticker)

        # URL sanity (don't be too strict — admin entry, not user input).
        if logo_url and not (logo_url.startswith("http://") or logo_url.startswith("https://") or logo_url.startswith("data:image/")):
            raise HTTPException(status_code=400, detail=f"entry {i+1}: logo must be an image URL or uploaded image")
        if link and not (link.startswith("http://") or link.startswith("https://")):
            raise HTTPException(status_code=400, detail=f"entry {i+1}: link must start with http(s)://")

        cleaned.append(GuestEntry(name=name, ticker=ticker, logo_url=logo_url, link=link))
    return cleaned


def _normalize_doc(doc: Optional[dict]) -> Optional[dict]:
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
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    return bool(doc)


async def create_guest_roll(
    col,
    *,
    title: Optional[str],
    prize_label: Optional[str],
    entries: List[dict],
    scheduled_at: datetime,
    created_by: str,
) -> dict:
    title = _clean_str(title, 60) or None
    prize = _clean_str(prize_label, 60) or "DexScreener Boost"
    cleaned = validate_entries(entries)

    sched = _ensure_utc(scheduled_at)
    if sched <= datetime.now(timezone.utc) + timedelta(seconds=5):
        raise HTTPException(status_code=400, detail="scheduled_at must be at least 5 seconds in the future")

    if await has_active_roll(col):
        raise HTTPException(status_code=400, detail="another guest roll is already active — cancel it first")

    roll = GuestRoll(
        title=title,
        prize_label=prize,
        entries=cleaned,
        scheduled_at=sched,
        created_by=created_by,
    )
    doc = roll.model_dump()
    await col.insert_one(doc)
    normalized = _normalize_doc(doc)
    asyncio.create_task(announce_guest_roll_scheduled(
        title=title,
        prize_label=prize,
        entry_count=len(cleaned),
        scheduled_at_iso=normalized.get("scheduled_at", ""),
    ))
    return normalized


async def update_guest_roll(
    col,
    roll_id: str,
    *,
    title: Optional[str] = None,
    prize_label: Optional[str] = None,
    entries: Optional[List[dict]] = None,
    scheduled_at: Optional[datetime] = None,
) -> dict:
    """Edit a still-scheduled roll. `entries` REPLACES the list (unlike dev_rolls which appends)."""
    doc = await col.find_one({"id": roll_id})
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    if doc.get("phase") != "scheduled":
        raise HTTPException(status_code=400, detail=f"cannot edit a roll in phase '{doc.get('phase')}'")

    updates: dict = {}
    if title is not None:
        updates["title"] = _clean_str(title, 60) or None
    if prize_label is not None:
        updates["prize_label"] = _clean_str(prize_label, 60) or "DexScreener Boost"
    if entries is not None:
        updates["entries"] = [e.model_dump() for e in validate_entries(entries)]
    if scheduled_at is not None:
        sched = _ensure_utc(scheduled_at)
        if sched <= datetime.now(timezone.utc) + timedelta(seconds=5):
            raise HTTPException(status_code=400, detail="scheduled_at must be at least 5 seconds in the future")
        updates["scheduled_at"] = sched

    if not updates:
        return _normalize_doc(doc)

    await col.update_one({"id": roll_id}, {"$set": updates})
    return _normalize_doc(await col.find_one({"id": roll_id}))


async def cancel_guest_roll(col, roll_id: str) -> dict:
    doc = await col.find_one({"id": roll_id})
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    if doc.get("phase") != "scheduled":
        raise HTTPException(status_code=400, detail=f"cannot cancel a roll in phase '{doc.get('phase')}'")
    await col.update_one(
        {"id": roll_id},
        {"$set": {"phase": "cancelled", "cancelled_at": datetime.now(timezone.utc)}},
    )
    return _normalize_doc(await col.find_one({"id": roll_id}))


async def fetch_current_guest_roll(col) -> Optional[dict]:
    doc = await col.find_one({"phase": {"$in": ["scheduled", "spinning"]}})
    if doc:
        return _normalize_doc(doc)
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=RESOLVED_DISPLAY_SECS)
    cur = col.find({"phase": "resolved", "resolved_at": {"$gte": cutoff}}).sort("resolved_at", -1).limit(1)
    docs = await cur.to_list(1)
    return _normalize_doc(docs[0]) if docs else None


async def list_guest_rolls(col, limit: int = 50) -> List[dict]:
    cur = col.find({}).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [_normalize_doc(d) for d in docs]


# ---------- scheduler ----------

async def _resolve_one_roll(col, roll: dict) -> None:
    roll_id = roll["id"]
    now = datetime.now(timezone.utc)

    # Atomic phase flip — one worker wins, others bail.
    try:
        result = await col.update_one(
            {"id": roll_id, "phase": "scheduled"},
            {"$set": {"phase": "spinning", "spin_started_at": now}},
        )
        matched = getattr(result, "matched_count", None)
        if matched == 0:
            return
    except Exception:
        logger.exception(f"[guest_roll] phase flip failed for {roll_id}")
        return

    refreshed = await col.find_one({"id": roll_id})
    if not refreshed or refreshed.get("phase") != "spinning":
        return

    entries = refreshed.get("entries") or []
    if not entries:
        logger.warning(f"[guest_roll] {roll_id} has no entries — marking cancelled")
        await col.update_one({"id": roll_id}, {"$set": {"phase": "cancelled", "cancelled_at": now}})
        return

    logger.info(f"[guest_roll] spinning {roll_id} ({len(entries)} entries, prize='{refreshed.get('prize_label')}')")
    asyncio.create_task(announce_guest_roll_spinning(
        title=refreshed.get("title"),
        prize_label=refreshed.get("prize_label", "DexScreener Boost"),
        entry_count=len(entries),
    ))

    await asyncio.sleep(GUEST_SPIN_ANIMATION_SECS)

    winner_index = random.randrange(len(entries))
    winner_entry = entries[winner_index]
    resolved_at = datetime.now(timezone.utc)
    await col.update_one(
        {"id": roll_id},
        {"$set": {
            "phase": "resolved",
            "winner_index": winner_index,
            "winner": winner_entry,
            "resolved_at": resolved_at,
        }},
    )
    logger.info(f"[guest_roll] resolved {roll_id} -> ${winner_entry.get('ticker')}")
    asyncio.create_task(announce_guest_roll_winner(
        title=refreshed.get("title"),
        prize_label=refreshed.get("prize_label", "DexScreener Boost"),
        winner_name=winner_entry.get("name", ""),
        winner_ticker=winner_entry.get("ticker", ""),
        winner_link=winner_entry.get("link"),
    ))


async def run_due_rolls(col) -> int:
    now = datetime.now(timezone.utc)
    cur = col.find({"phase": "scheduled", "scheduled_at": {"$lte": now}}).limit(5)
    due = await cur.to_list(5)
    if not due:
        return 0
    for roll in due:
        try:
            await _resolve_one_roll(col, roll)
        except Exception:
            logger.exception(f"[guest_roll] failed to resolve {roll.get('id')}")
    return len(due)


# ---------- public applications ----------

class GuestApplication(BaseModel):
    """A public submission from a project that wants to be in the next Guest Roll."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    ticker: str
    logo_url: Optional[str] = None
    community_link: str
    contact: str                     # @handle on X/TG/Discord
    contract_address: Optional[str] = None
    notes: Optional[str] = None
    status: str = "pending"          # pending | approved | rejected
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


async def submit_guest_application(col, payload: dict) -> dict:
    """Public endpoint helper. Validates and stores a new application."""
    name = _clean_str(payload.get("name"), 40)
    ticker = _clean_str(payload.get("ticker"), 16).upper().lstrip("$")
    # logo_url accepts http(s) URLs OR base64 data URLs from direct upload.
    logo_url = _clean_str(payload.get("logo_url"), 400_000) or None
    community_link = _clean_str(payload.get("community_link"), 500)
    contact = _clean_str(payload.get("contact"), 80)
    contract_address = _clean_str(payload.get("contract_address"), 80) or None
    notes = _clean_str(payload.get("notes"), 500) or None

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker is required")
    if not community_link:
        raise HTTPException(status_code=400, detail="community link is required")
    if not contact:
        raise HTTPException(status_code=400, detail="contact (X / TG handle) is required")
    if logo_url and not (logo_url.startswith("http://") or logo_url.startswith("https://") or logo_url.startswith("data:image/")):
        raise HTTPException(status_code=400, detail="logo must be an image URL or uploaded image")
    if not (community_link.startswith("http://") or community_link.startswith("https://")):
        raise HTTPException(status_code=400, detail="community_link must start with http(s)://")

    # Soft duplicate guard — same ticker submitted within last 24h.
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    existing = await col.find_one({"ticker": ticker, "status": "pending", "created_at": {"$gte": cutoff}})
    if existing:
        raise HTTPException(status_code=409, detail=f"${ticker} already has a pending application — we'll get back to you")

    app = GuestApplication(
        name=name,
        ticker=ticker,
        logo_url=logo_url,
        community_link=community_link,
        contact=contact,
        contract_address=contract_address,
        notes=notes,
    )
    doc = app.model_dump()
    await col.insert_one(doc)
    return _normalize_app_doc(doc)


def _normalize_app_doc(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    v = out.get("created_at")
    if isinstance(v, datetime):
        out["created_at"] = _ensure_utc(v).isoformat()
    return out


async def list_guest_applications(col, limit: int = 100) -> List[dict]:
    cur = col.find({}).sort("created_at", -1).limit(limit)
    docs = await cur.to_list(limit)
    return [_normalize_app_doc(d) for d in docs]


async def update_guest_application(col, app_id: str, *, status: str) -> dict:
    if status not in ("pending", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="invalid status")
    result = await col.update_one({"id": app_id}, {"$set": {"status": status}})
    matched = getattr(result, "matched_count", None)
    if matched == 0:
        raise HTTPException(status_code=404, detail="application not found")
    return _normalize_app_doc(await col.find_one({"id": app_id}))


async def delete_guest_application(col, app_id: str) -> dict:
    result = await col.delete_one({"id": app_id})
    deleted = getattr(result, "deleted_count", None)
    if deleted == 0:
        raise HTTPException(status_code=404, detail="application not found")
    return {"ok": True}


async def guest_scheduler_loop(get_col) -> None:
    """Background asyncio task. Polls every 3s for due rolls."""
    logger.info("[guest_roll] scheduler started")
    while True:
        try:
            col = get_col("guest_rolls")
            await run_due_rolls(col)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[guest_roll] scheduler tick failed")
        await asyncio.sleep(3)
