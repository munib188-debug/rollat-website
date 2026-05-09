"""Per-wallet qualification streaks for the long-term-holder bonus.

A streak is the count of consecutive rounds (each round = one daily spin) where
a wallet was qualified. We allow a configurable grace of one missed round so
that brief Helius / RPC blips don't reset everyone. The collection is *not*
TTL-purged — this is the only persistent record of tenure across rounds, since
holder_snapshots themselves expire after 48h.

Doc shape (one per wallet):
{
  _id: "<wallet>",
  current_streak_days: int,
  max_streak_days: int,
  last_qualified_round: int,
  last_qualified_at: datetime,
  first_qualified_at: datetime,
  total_rounds_qualified: int,
  grace_used_for_round: Optional[int],   // None when grace not yet spent in current run
}
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)


class StreakStore:
    def __init__(self, collection):
        self.coll = collection

    async def ensure_indexes(self) -> None:
        # Most reads are by _id (wallet), no extra indexes needed today.
        return None

    async def bulk_get_streaks(self, wallets: Iterable[str]) -> dict[str, dict]:
        """Return {wallet -> doc} for the given wallets. Missing wallets are absent from the map."""
        addrs = [w for w in wallets if w]
        if not addrs:
            return {}
        try:
            cursor = self.coll.find({"_id": {"$in": addrs}})
            docs = await cursor.to_list(length=len(addrs))
            return {d["_id"]: d for d in docs}
        except Exception:
            logger.exception("bulk_get_streaks failed")
            return {}

    async def get_streak(self, wallet: str) -> Optional[dict]:
        if not wallet:
            return None
        try:
            return await self.coll.find_one({"_id": wallet})
        except Exception:
            logger.exception("get_streak failed")
            return None

    async def update_streaks_for_round(
        self,
        qualified_wallets: list[str],
        round_number: int,
        *,
        grace_days: int = 1,
    ) -> dict[str, dict]:
        """Advance/reset streaks for every currently-qualified wallet for this round.

        Wallets that were qualified previously but are not in `qualified_wallets`
        keep their last doc untouched — read paths treat anything where
        last_qualified_round < (current_round - 1 - grace_days) as a dead streak
        with bonus = 0.

        Returns the post-update {wallet -> doc} map for the qualified set.
        """
        if not qualified_wallets:
            return {}

        existing = await self.bulk_get_streaks(qualified_wallets)
        now = datetime.now(timezone.utc)
        updated: dict[str, dict] = {}

        # Build per-wallet ops. Motor's bulk_write isn't strictly required here
        # since the qualified set is small (≤ a few thousand) and Mongo can keep
        # up — using update_one with upsert keeps things simple and atomic.
        for wallet in qualified_wallets:
            doc = existing.get(wallet)
            if doc is None:
                new_doc = {
                    "_id": wallet,
                    "current_streak_days": 1,
                    "max_streak_days": 1,
                    "last_qualified_round": round_number,
                    "last_qualified_at": now,
                    "first_qualified_at": now,
                    "total_rounds_qualified": 1,
                    "grace_used_for_round": None,
                }
                try:
                    await self.coll.update_one(
                        {"_id": wallet},
                        {"$set": new_doc},
                        upsert=True,
                    )
                except Exception:
                    logger.exception(f"insert streak failed for {wallet}")
                    continue
                updated[wallet] = new_doc
                continue

            last_round = int(doc.get("last_qualified_round") or 0)
            current_streak = int(doc.get("current_streak_days") or 0)
            max_streak = int(doc.get("max_streak_days") or 0)
            total = int(doc.get("total_rounds_qualified") or 0)
            grace_used = doc.get("grace_used_for_round")
            first_at = doc.get("first_qualified_at") or now

            gap = round_number - last_round

            if gap <= 0:
                # Defensive: same round counted twice. Skip.
                updated[wallet] = doc
                continue

            if gap == 1:
                # Consecutive round. Re-earn the grace allowance: as long as
                # the wallet keeps qualifying without missing, we treat each
                # uninterrupted run after the last grace event as fresh —
                # so a miss two months from now can still be bridged. This
                # matches how players read the rule ("one missed round is
                # forgiven") rather than "one miss ever in this streak".
                current_streak += 1
                grace_used = None
            elif gap == 2 and grace_days >= 1 and grace_used is None:
                # Bridge a single missed round using the grace allowance.
                current_streak += 1
                grace_used = round_number
            else:
                # Streak broke (gap > 1 with no grace, or gap > 2).
                current_streak = 1
                grace_used = None

            max_streak = max(max_streak, current_streak)
            total += 1

            patch = {
                "current_streak_days": current_streak,
                "max_streak_days": max_streak,
                "last_qualified_round": round_number,
                "last_qualified_at": now,
                "first_qualified_at": first_at,
                "total_rounds_qualified": total,
                "grace_used_for_round": grace_used,
            }
            try:
                await self.coll.update_one({"_id": wallet}, {"$set": patch})
            except Exception:
                logger.exception(f"update streak failed for {wallet}")
                continue

            patch["_id"] = wallet
            updated[wallet] = patch

        return updated

    async def effective_streak_days(
        self,
        wallet_doc: Optional[dict],
        current_round: int,
        *,
        grace_days: int = 1,
    ) -> int:
        """Return the streak that should be considered 'alive' right now.

        A streak goes stale when the wallet stops qualifying. If
        last_qualified_round + 1 + grace_days < current_round the streak is dead.
        """
        if not wallet_doc:
            return 0
        last_round = int(wallet_doc.get("last_qualified_round") or 0)
        if current_round - last_round > 1 + max(0, int(grace_days)):
            return 0
        return int(wallet_doc.get("current_streak_days") or 0)
