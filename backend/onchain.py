"""On-chain data fetchers for $ROLLAT.

Pulls live data from:
  - pump.fun frontend API (price, market cap pre-graduation)
  - DexScreener (price/volume/24h change post-graduation, also fallback)
  - Helius DAS RPC (holders count via getTokenAccounts)
  - Solana RPC (per-wallet balance via getTokenAccountsByOwner)

Each fetcher has a small in-memory TTL cache so we don't hammer external APIs
when many users hit /stats simultaneously.
"""

from __future__ import annotations

import os
import time
import logging
from typing import Optional, Any

import httpx

logger = logging.getLogger(__name__)

TOKEN_MINT      = os.environ.get("TOKEN_MINT", "")
HELIUS_API_KEY  = os.environ.get("HELIUS_API_KEY", "")
SOLANA_RPC_URL  = os.environ.get("SOLANA_RPC_URL", "")
POT_WALLET      = os.environ.get("POT_WALLET", "")

PUMP_FUN_API    = "https://frontend-api.pump.fun"
DEXSCREENER_API = "https://api.dexscreener.com/latest/dex/tokens"

# pump.fun standard supply for new launches (1 billion, 6 decimals)
PUMP_TOTAL_SUPPLY = 1_000_000_000
TOKEN_DECIMALS = 6  # pump.fun standard

# -- tiny TTL cache --------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}

def _cache_get(key: str) -> Optional[Any]:
    entry = _cache.get(key)
    if not entry:
        return None
    expires, value = entry
    if time.time() > expires:
        return None
    return value

def _cache_set(key: str, value: Any, ttl: float) -> None:
    _cache[key] = (time.time() + ttl, value)


# -- public helpers --------------------------------------------------------

def is_configured() -> bool:
    """True iff TOKEN_MINT and SOLANA_RPC_URL env vars are set."""
    return bool(TOKEN_MINT and SOLANA_RPC_URL)


# -- pump.fun / dexscreener -----------------------------------------------

async def _fetch_pump_fun(client: httpx.AsyncClient, mint: str) -> Optional[dict]:
    try:
        r = await client.get(f"{PUMP_FUN_API}/coins/{mint}", timeout=8)
        if r.status_code == 200:
            return r.json()
        logger.info(f"pump.fun returned {r.status_code} for {mint}")
    except Exception as e:
        logger.warning(f"pump.fun fetch failed: {e}")
    return None


async def _fetch_dexscreener(client: httpx.AsyncClient, mint: str) -> Optional[dict]:
    try:
        r = await client.get(f"{DEXSCREENER_API}/{mint}", timeout=8)
        if r.status_code == 200:
            data = r.json()
            pairs = data.get("pairs") or []
            if pairs:
                return pairs[0]
    except Exception as e:
        logger.warning(f"dexscreener fetch failed: {e}")
    return None


async def fetch_token_market_data(mint: Optional[str] = None) -> dict:
    """Returns {price_usd, market_cap_usd, volume_24h, change_24h, source, graduated}.

    Tries pump.fun first (works pre- and post-graduation), falls back to DexScreener
    (richer post-graduation data: volume, 24h change). Cached 30s on success, 10s on failure.
    """
    mint = mint or TOKEN_MINT
    if not mint:
        return {"price_usd": 0, "market_cap_usd": 0, "volume_24h": 0, "change_24h": 0, "source": "none", "graduated": False}

    cached = _cache_get(f"market:{mint}")
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        # pump.fun first
        pump = await _fetch_pump_fun(client, mint)
        if pump and pump.get("usd_market_cap"):
            mcap = float(pump["usd_market_cap"])
            graduated = bool(pump.get("complete", False))
            # supply is 1B for pump.fun launches; price = mcap / supply
            price = mcap / PUMP_TOTAL_SUPPLY if mcap else 0
            result = {
                "price_usd": price,
                "market_cap_usd": mcap,
                "volume_24h": 0,
                "change_24h": 0,
                "source": "pump.fun",
                "graduated": graduated,
            }
            # If graduated, layer DexScreener on top for volume / 24h change
            if graduated:
                ds = await _fetch_dexscreener(client, mint)
                if ds:
                    result["price_usd"]   = float(ds.get("priceUsd") or price)
                    result["market_cap_usd"] = float(ds.get("fdv") or mcap)
                    result["volume_24h"]  = float((ds.get("volume") or {}).get("h24", 0))
                    result["change_24h"]  = float((ds.get("priceChange") or {}).get("h24", 0))
                    result["source"]      = "dexscreener+pump.fun"
            _cache_set(f"market:{mint}", result, 30)
            return result

        # pump.fun didn't have it: try DexScreener directly
        ds = await _fetch_dexscreener(client, mint)
        if ds:
            result = {
                "price_usd": float(ds.get("priceUsd") or 0),
                "market_cap_usd": float(ds.get("fdv") or 0),
                "volume_24h": float((ds.get("volume") or {}).get("h24", 0)),
                "change_24h": float((ds.get("priceChange") or {}).get("h24", 0)),
                "source": "dexscreener",
                "graduated": True,
            }
            _cache_set(f"market:{mint}", result, 30)
            return result

    fallback = {"price_usd": 0, "market_cap_usd": 0, "volume_24h": 0, "change_24h": 0, "source": "unavailable", "graduated": False}
    _cache_set(f"market:{mint}", fallback, 10)  # short TTL — retry sooner
    return fallback


# -- holders count via Helius ---------------------------------------------

async def fetch_holders_count(mint: Optional[str] = None) -> int:
    """Returns the number of unique wallets currently holding the token (via Helius
    `getTokenAccounts`). Paginates up to 50 pages (50k accounts) which covers
    everything except megacap launches."""
    mint = mint or TOKEN_MINT
    if not mint or not SOLANA_RPC_URL:
        return 0

    cached = _cache_get(f"holders:{mint}")
    if cached is not None:
        return cached

    unique_owners: set[str] = set()
    cursor: Optional[str] = None
    pages = 0
    max_pages = 50

    async with httpx.AsyncClient() as client:
        while pages < max_pages:
            params: dict = {"mint": mint, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            try:
                r = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": str(pages),
                        "method": "getTokenAccounts",
                        "params": params,
                    },
                    timeout=15,
                )
                data = r.json()
                result = data.get("result") or {}
                accounts = result.get("token_accounts") or result.get("tokenAccounts") or []
                for acc in accounts:
                    owner = acc.get("owner")
                    if owner:
                        unique_owners.add(owner)
                cursor = result.get("cursor")
                pages += 1
                if not cursor or not accounts:
                    break
            except Exception as e:
                logger.warning(f"holder count fetch failed (page {pages}): {e}")
                break

    count = len(unique_owners)
    _cache_set(f"holders:{mint}", count, 60)
    return count


async def fetch_holder_snapshot(mint: Optional[str] = None) -> list[dict]:
    """Returns [{wallet, amount}] for every current holder, with multiple ATAs
    aggregated per owner. Amount is human-readable (raw / 10^decimals).

    This is what the hourly snapshot job persists to Mongo. Not cached — the
    snapshot task is the only caller and it explicitly wants a fresh read.
    Capped at 50 pages = 50k accounts (one Helius page = 1000 accounts)."""
    mint = mint or TOKEN_MINT
    if not mint or not SOLANA_RPC_URL:
        return []

    owner_amounts: dict[str, float] = {}
    cursor: Optional[str] = None
    pages = 0
    max_pages = 50

    async with httpx.AsyncClient() as client:
        while pages < max_pages:
            params: dict = {"mint": mint, "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            try:
                r = await client.post(
                    SOLANA_RPC_URL,
                    json={
                        "jsonrpc": "2.0",
                        "id": str(pages),
                        "method": "getTokenAccounts",
                        "params": params,
                    },
                    timeout=20,
                )
                data = r.json()
                result = data.get("result") or {}
                accounts = result.get("token_accounts") or result.get("tokenAccounts") or []
                for acc in accounts:
                    owner = acc.get("owner")
                    raw = acc.get("amount", 0)
                    if owner and raw:
                        try:
                            raw_int = int(raw)
                        except (TypeError, ValueError):
                            continue
                        if raw_int > 0:
                            owner_amounts[owner] = owner_amounts.get(owner, 0) + (raw_int / 10 ** TOKEN_DECIMALS)
                cursor = result.get("cursor")
                pages += 1
                if not cursor or not accounts:
                    break
            except Exception as e:
                logger.warning(f"snapshot page {pages} failed: {e}")
                break

    return [{"wallet": w, "amount": a} for w, a in owner_amounts.items()]


# -- per-wallet balance via standard Solana RPC ---------------------------

async def fetch_wallet_balance(wallet: str, mint: Optional[str] = None) -> float:
    """Returns the human-readable token balance (uiAmount) for the wallet.
    Sums across multiple ATAs if the wallet has more than one (rare). 0 on error."""
    mint = mint or TOKEN_MINT
    if not mint or not SOLANA_RPC_URL or not wallet:
        return 0.0

    cache_key = f"balance:{wallet}:{mint}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                SOLANA_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "getTokenAccountsByOwner",
                    "params": [
                        wallet,
                        {"mint": mint},
                        {"encoding": "jsonParsed"},
                    ],
                },
                timeout=10,
            )
            data = r.json()
            accounts = (data.get("result") or {}).get("value") or []
            total = 0.0
            for acc in accounts:
                ui = (
                    acc.get("account", {})
                       .get("data", {})
                       .get("parsed", {})
                       .get("info", {})
                       .get("tokenAmount", {})
                       .get("uiAmount")
                )
                if ui is not None:
                    total += float(ui)
            _cache_set(cache_key, total, 30)
            return total
        except Exception as e:
            logger.warning(f"wallet balance fetch failed for {wallet}: {e}")
            return 0.0


# -- pot SOL balance ------------------------------------------------------

async def fetch_pot_balance() -> float:
    """Returns the pot wallet's live SOL balance. 0 if POT_WALLET unset.

    The pot is just the live on-chain SOL balance of the configured pot
    wallet — spins debit it, deposits/fees credit it. No bookkeeping needed
    on our side; on-chain is the source of truth.
    """
    if not POT_WALLET:
        return 0.0
    return await fetch_sol_balance(POT_WALLET)


# -- generic SOL balance fetcher ------------------------------------------

async def fetch_sol_balance(wallet: str) -> float:
    """Returns SOL balance (in SOL, not lamports). 0 on error."""
    if not SOLANA_RPC_URL or not wallet:
        return 0.0

    cache_key = f"sol:{wallet}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    async with httpx.AsyncClient() as client:
        try:
            r = await client.post(
                SOLANA_RPC_URL,
                json={
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "getBalance",
                    "params": [wallet],
                },
                timeout=10,
            )
            data = r.json()
            lamports = (data.get("result") or {}).get("value") or 0
            sol = lamports / 1_000_000_000
            _cache_set(cache_key, sol, 30)
            return sol
        except Exception as e:
            logger.warning(f"SOL balance fetch failed for {wallet}: {e}")
            return 0.0
