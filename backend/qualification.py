"""Strict 24-snapshot qualification logic.

A wallet is qualified iff it appears with `MIN_QUALIFYING_TOKENS` in EVERY
one of the most-recent `REQUIRED_SNAPSHOTS` hourly snapshots. While we have
fewer than that many snapshots stored, qualification is inactive (returns
empty set) — we never bootstrap with mock or relaxed criteria.

Tickets are computed from the *minimum* balance across the qualifying window
because that's the amount the wallet actually held continuously.
"""

from __future__ import annotations
from typing import Optional

MIN_QUALIFYING_TOKENS = 1_000_000
REQUIRED_SNAPSHOTS = 24

# Wallets permanently excluded from qualification and spin pool (e.g. liquidity pool).
EXCLUDED_WALLETS: frozenset[str] = frozenset({
    "554wf8HbkcPJZn12kxDGUVgX75fA1btkpzuAcjrBDrRK",  # liquidity pool
})


def tickets_for_holdings(tokens: float) -> int:
    """Same tier table the website's TierRow display advertises."""
    if tokens < 1_000_000:   return 0
    if tokens < 2_000_000:   return 1
    if tokens < 4_000_000:   return 2
    if tokens < 6_000_000:   return 3
    if tokens < 8_000_000:   return 4
    if tokens < 10_000_000:  return 5
    return 6


def _balance_lookup(snapshot: dict) -> dict:
    """Build {wallet -> amount} dict from a snapshot doc."""
    out: dict = {}
    for h in snapshot.get("holders") or []:
        w = h.get("wallet")
        if w:
            try:
                out[w] = float(h.get("amount") or 0)
            except (TypeError, ValueError):
                continue
    return out


def has_sufficient_history(snapshots: list) -> bool:
    return len(snapshots) >= REQUIRED_SNAPSHOTS


def compute_qualified_wallets(
    snapshots: list,
    *,
    min_tokens: Optional[int] = None,
    excluded: Optional[frozenset[str]] = None,
) -> list[dict]:
    """Returns [{wallet, tickets, min_balance}] sorted by tickets desc.
    Empty list when we have fewer than REQUIRED_SNAPSHOTS snapshots.

    Optional overrides:
      min_tokens: defaults to MIN_QUALIFYING_TOKENS
      excluded:   defaults to EXCLUDED_WALLETS
    """
    min_tok = MIN_QUALIFYING_TOKENS if min_tokens is None else int(min_tokens)
    excl = EXCLUDED_WALLETS if excluded is None else excluded

    if not has_sufficient_history(snapshots):
        return []

    window = snapshots[:REQUIRED_SNAPSHOTS]  # newest-first
    balance_per_snap = [_balance_lookup(s) for s in window]

    # Only wallets present in the most-recent snapshot can possibly qualify.
    # Strip any permanently-excluded addresses (LP, team, etc.).
    candidates = [w for w in balance_per_snap[0].keys() if w not in excl]

    qualified: list[dict] = []
    for wallet in candidates:
        amounts: list[float] = []
        ok = True
        for bal in balance_per_snap:
            amt = bal.get(wallet, 0)
            if amt < min_tok:
                ok = False
                break
            amounts.append(amt)
        if ok and amounts:
            min_bal = min(amounts)
            qualified.append({
                "wallet": wallet,
                "tickets": tickets_for_holdings(min_bal),
                "min_balance": min_bal,
            })

    qualified.sort(key=lambda w: (w["tickets"], w["min_balance"]), reverse=True)
    return qualified


def compute_wallet_status(
    snapshots: list,
    wallet: str,
    *,
    min_tokens: Optional[int] = None,
    excluded: Optional[frozenset[str]] = None,
) -> dict:
    """Per-wallet qualification status.

    Returns:
      is_qualified : True iff ≥REQUIRED_SNAPSHOTS exist AND wallet held
                     ≥MIN_QUALIFYING_TOKENS in all of them.
      hours_held   : count of consecutive snapshots-from-most-recent where the
                     wallet had ≥MIN_QUALIFYING_TOKENS (saturates at REQUIRED_SNAPSHOTS).
      snapshots    : list[bool] of length REQUIRED_SNAPSHOTS, index 0 = most recent.
                     Padded with False when we have < REQUIRED_SNAPSHOTS captured.
      tickets      : computed from MIN balance across the qualifying window
                     (only > 0 when fully qualified).
      min_balance  : min token balance across the qualifying window.
    """
    min_tok = MIN_QUALIFYING_TOKENS if min_tokens is None else int(min_tokens)
    excl = EXCLUDED_WALLETS if excluded is None else excluded

    bal_lookup = [_balance_lookup(s) for s in snapshots[:REQUIRED_SNAPSHOTS]]
    n = len(bal_lookup)

    bools: list[bool] = []
    for i in range(REQUIRED_SNAPSHOTS):
        if i < n:
            amt = bal_lookup[i].get(wallet, 0)
            bools.append(amt >= min_tok)
        else:
            bools.append(False)

    hours_held = 0
    for b in bools:
        if b:
            hours_held += 1
        else:
            break

    is_qualified = (
        (hours_held == REQUIRED_SNAPSHOTS)
        and has_sufficient_history(snapshots)
        and (wallet not in excl)
    )

    if is_qualified:
        amounts = [bl.get(wallet, 0) for bl in bal_lookup[:REQUIRED_SNAPSHOTS]]
        min_balance = float(min(amounts))
        tickets = tickets_for_holdings(min_balance)
    else:
        min_balance = 0.0
        tickets = 0

    return {
        "is_qualified": is_qualified,
        "hours_held": hours_held,
        "snapshots": bools,
        "min_balance": min_balance,
        "tickets": tickets,
    }


async def fetch_recent_snapshots(coll) -> list:
    """Fetch the most-recent REQUIRED_SNAPSHOTS snapshots, newest first."""
    try:
        cursor = coll.find({}).sort("captured_at", -1).limit(REQUIRED_SNAPSHOTS)
        return await cursor.to_list(REQUIRED_SNAPSHOTS)
    except Exception:
        return []
