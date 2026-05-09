"""Last Team Standing tournament store.

Layered on top of dev_rolls' elimination mode: when a roll is created with
`is_tournament=True`, public users sign up to back one of the teams. When
the elimination wheel removes a team, every supporter of that team is
flagged eliminated. The final surviving team's supporters split the pot.

Storage:
- Collection `tournament_supporters` with `_id = "{roll_id}:{wallet}"` so
  one wallet can sign up at most once per roll (uniqueness enforced by the
  Mongo `_id` index for free).
- Documents are persistent (no TTL) — they're the historical record of
  who backed whom in each tournament.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Twitter handle rules: 1–15 chars of [A-Za-z0-9_].
_X_HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")


def _normalize_x_handle(raw: str) -> str:
    """Strip leading `@`, validate, return lowercased canonical handle."""
    if not raw or not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="x_handle required")
    h = raw.strip().lstrip("@").strip()
    if not _X_HANDLE_RE.match(h):
        raise HTTPException(
            status_code=400,
            detail="x_handle must be 1–15 chars (letters, digits, underscore)",
        )
    return h.lower()


def _supporter_id(roll_id: str, wallet: str) -> str:
    return f"{roll_id}:{wallet}"


class TournamentStore:
    def __init__(self, coll):
        self.coll = coll

    async def ensure_indexes(self) -> None:
        try:
            # Fast supporter-count + bulk-eliminate by team.
            await self.coll.create_index([("roll_id", 1), ("team_entry_id", 1)])
            # Fast survivor list when the tournament resolves.
            await self.coll.create_index([("roll_id", 1), ("eliminated", 1)])
            # Wallet lookup ("did I sign up for any roll").
            await self.coll.create_index([("wallet", 1)])
        except Exception:
            # in-memory fallback collections may not support indexes
            pass

    async def add_supporter(
        self,
        *,
        roll_id: str,
        team_entry_id: str,
        wallet: str,
        x_handle: str,
    ) -> dict:
        """Insert a new supporter doc. Raises 409 if the wallet already
        signed up for this roll. Wallet/x_handle/team_entry_id are assumed
        validated by the caller (the route handler does the heavy checks)."""
        now = datetime.now(timezone.utc)
        doc = {
            "_id": _supporter_id(roll_id, wallet),
            "roll_id": roll_id,
            "team_entry_id": team_entry_id,
            "wallet": wallet,
            "x_handle": x_handle,
            "signed_up_at": now,
            "eliminated": False,
            "eliminated_at": None,
        }
        try:
            await self.coll.insert_one(doc)
        except Exception as exc:
            # Motor's DuplicateKeyError shows up as a generic Exception under
            # in-memory fallbacks; do a follow-up lookup to disambiguate.
            existing = await self.coll.find_one({"_id": doc["_id"]})
            if existing:
                raise HTTPException(status_code=409, detail="wallet already signed up for this roll")
            logger.exception(f"[tournament] add_supporter insert failed: {exc}")
            raise HTTPException(status_code=500, detail="signup failed")
        return doc

    async def remove_supporter(self, *, roll_id: str, wallet: str) -> bool:
        result = await self.coll.delete_one({"_id": _supporter_id(roll_id, wallet)})
        return getattr(result, "deleted_count", 0) > 0

    async def supporters_by_team(self, roll_id: str) -> dict[str, int]:
        """Aggregate supporter count per team_entry_id for a roll."""
        try:
            cur = self.coll.aggregate([
                {"$match": {"roll_id": roll_id}},
                {"$group": {"_id": "$team_entry_id", "count": {"$sum": 1}}},
            ])
            counts: dict[str, int] = {}
            async for row in cur:
                counts[row["_id"]] = int(row.get("count") or 0)
            return counts
        except Exception:
            # In-memory fallback: brute-force count.
            counts: dict[str, int] = {}
            cur = self.coll.find({"roll_id": roll_id})
            async for d in cur:
                tid = d.get("team_entry_id")
                if tid:
                    counts[tid] = counts.get(tid, 0) + 1
            return counts

    async def supporter_for_wallet(
        self,
        *,
        roll_id: str,
        wallet: str,
    ) -> Optional[dict]:
        return await self.coll.find_one({"_id": _supporter_id(roll_id, wallet)})

    async def eliminate_team_supporters(
        self,
        *,
        roll_id: str,
        team_entry_id: str,
        when: Optional[datetime] = None,
    ) -> int:
        """Bulk-flag every supporter of a team as eliminated. Returns the
        number of docs updated. Idempotent — re-running on an already-
        eliminated team is a no-op."""
        when = when or datetime.now(timezone.utc)
        try:
            result = await self.coll.update_many(
                {"roll_id": roll_id, "team_entry_id": team_entry_id, "eliminated": False},
                {"$set": {"eliminated": True, "eliminated_at": when}},
            )
            return int(getattr(result, "modified_count", 0) or 0)
        except Exception:
            logger.exception("[tournament] eliminate_team_supporters failed")
            return 0

    async def list_supporters(
        self,
        roll_id: str,
        *,
        only_alive: bool = False,
    ) -> list[dict]:
        q: dict = {"roll_id": roll_id}
        if only_alive:
            q["eliminated"] = False
        cur = self.coll.find(q).sort("signed_up_at", 1)
        out: list[dict] = []
        async for d in cur:
            d = dict(d)
            d.pop("_id", None)
            for k in ("signed_up_at", "eliminated_at"):
                v = d.get(k)
                if isinstance(v, datetime):
                    if v.tzinfo is None:
                        v = v.replace(tzinfo=timezone.utc)
                    d[k] = v.isoformat()
            out.append(d)
        return out
