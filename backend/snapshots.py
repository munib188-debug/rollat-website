"""Hourly $ROLLAT holder snapshots.

A single asyncio background task captures `getTokenAccounts` data once per hour
(aligned to the top of the hour), stores it in the `holder_snapshots` Mongo
collection, and lets a Mongo TTL index automatically prune anything older
than ~48 h. Step 5 will read these snapshots to compute "wallets present in
24 consecutive hourly snapshots" -> real qualified-wallet set.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from onchain import fetch_holder_snapshot, TOKEN_MINT

logger = logging.getLogger(__name__)

# 48 h rolling window. We only need the last 24 for qualification, but keep
# a buffer in case of brief downtime / clock drift.
SNAPSHOT_TTL_SECONDS = 48 * 3600


class SnapshotStore:
    def __init__(self, collection):
        self.coll = collection
        self._task: Optional[asyncio.Task] = None

    async def ensure_indexes(self) -> None:
        # TTL index purges old snapshots automatically.
        try:
            await self.coll.create_index("captured_at", expireAfterSeconds=SNAPSHOT_TTL_SECONDS)
        except Exception:
            # In-memory fallback collection doesn't support indexes. Safe to ignore.
            pass

    async def capture(self) -> Optional[dict]:
        """Take one snapshot and persist it. Returns the inserted doc shape (without _id)."""
        if not TOKEN_MINT:
            logger.info("snapshot skipped: TOKEN_MINT not set")
            return None
        try:
            holders = await fetch_holder_snapshot()
        except Exception:
            logger.exception("fetch_holder_snapshot raised")
            return None

        doc = {
            "captured_at": datetime.now(timezone.utc),
            "mint": TOKEN_MINT,
            "total_holders": len(holders),
            "holders": holders,
        }
        try:
            await self.coll.insert_one(doc)
        except Exception:
            logger.exception("snapshot insert_one failed")
            return None

        logger.info(f"snapshot captured: {len(holders)} holders @ {doc['captured_at'].isoformat()}")
        return doc

    async def list_recent(self, limit: int = 48) -> list[dict]:
        """List recent snapshots (compact: id + captured_at + total_holders, no holders[])."""
        try:
            cursor = self.coll.find(
                {},
                projection={"_id": 1, "captured_at": 1, "total_holders": 1, "mint": 1},
            ).sort("captured_at", -1).limit(int(limit))
            docs = await cursor.to_list(int(limit))
            for d in docs:
                d["id"] = str(d.pop("_id"))
                ts = d.get("captured_at")
                if isinstance(ts, datetime):
                    d["captured_at"] = ts.replace(tzinfo=timezone.utc).isoformat() if ts.tzinfo is None else ts.isoformat()
            return docs
        except Exception:
            logger.exception("list_recent failed")
            return []

    async def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete one snapshot by its string ObjectId. Returns True iff a doc was removed."""
        try:
            from bson import ObjectId
            oid = ObjectId(snapshot_id)
        except Exception:
            return False
        try:
            res = await self.coll.delete_one({"_id": oid})
            return bool(getattr(res, "deleted_count", 0))
        except Exception:
            logger.exception("delete_snapshot failed")
            return False

    def start_loop(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._loop(), name="rollat-snapshot-loop")

    def stop_loop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _loop(self) -> None:
        # First snapshot fires immediately on boot, then aligns to top-of-hour.
        try:
            while True:
                try:
                    await self.capture()
                except Exception:
                    logger.exception("snapshot capture raised")

                # Sleep until next hh:00:00 UTC.
                now = datetime.now(timezone.utc)
                next_hour = (now + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
                delay = max(60.0, (next_hour - now).total_seconds())
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            logger.info("snapshot loop cancelled")
            raise
