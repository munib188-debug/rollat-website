from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random  # only for deterministic-seeded mock generators below; never for winner selection
import secrets
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Set
import uuid
from datetime import datetime, timezone, timedelta

from auth import (
    NonceStore,
    NonceResponse,
    VerifyRequest,
    VerifyResponse,
    MeResponse,
    verify_solana_signature,
    issue_jwt,
    get_current_wallet,
    get_admin_wallet,
    is_admin_wallet,
    revoke_jti,
    verify_jwt,
    ADMIN_WALLETS,
)
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)
from dev_rolls import (
    create_dev_roll,
    update_dev_roll,
    cancel_dev_roll,
    fetch_current_dev_roll,
    list_dev_rolls,
    dev_scheduler_loop,
)
from guest_rolls import (
    create_guest_roll,
    update_guest_roll,
    cancel_guest_roll,
    fetch_current_guest_roll,
    list_guest_rolls,
    guest_scheduler_loop,
    submit_guest_application,
    list_guest_applications,
    update_guest_application,
    delete_guest_application,
)
from telegram_bot import (
    announce_daily_spin_started,
    announce_daily_spin_winner,
    announce_daily_spin_reminder,
    announce_rollover,
    announce_buy_cta,
)
from onchain import (
    fetch_token_market_data,
    fetch_holders_count,
    fetch_wallet_balance,
    fetch_pot_balance,
    is_configured as onchain_is_configured,
)
from snapshots import SnapshotStore
from qualification import (
    compute_qualified_wallets,
    compute_wallet_status,
    fetch_recent_snapshots,
    has_sufficient_history,
    REQUIRED_SNAPSHOTS,
    EXCLUDED_WALLETS,
)


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------- DB setup (MongoDB with in-memory fallback) ----------
mongo_url = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.environ.get('DB_NAME', 'rollat_database')

client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=2000)
db = client[db_name]
USE_MONGO = False  # Will be set True after successful ping in startup


# ---------- In-memory store (used when MongoDB unavailable) ----------
_store: dict = {"winners": [], "spin_state": None}


class _MemCollection:
    def __init__(self, name: str):
        self.name = name

    def _data(self):
        return _store.get(self.name, [])

    async def find_one(self, query=None, *args, **kwargs):
        if self.name == "spin_state":
            return _store.get("spin_state")
        data = self._data()
        if not query:
            return data[0] if data else None
        for doc in data:
            if all(doc.get(k) == v for k, v in query.items() if k != "_id"):
                return doc
        return None

    def find(self, query=None, projection=None):
        return _MemCursor(self._data(), query, projection)

    async def insert_one(self, doc):
        if self.name == "spin_state":
            _store["spin_state"] = doc
        else:
            _store.setdefault(self.name, []).append(doc)

    async def insert_many(self, docs):
        _store.setdefault(self.name, []).extend(docs)

    async def delete_many(self, query=None):
        if query == {}:
            _store[self.name] = []

    async def update_one(self, query, update, upsert=False):
        if self.name == "spin_state":
            current = _store.get("spin_state") or {}
            current.update(update.get("$set", {}))
            _store["spin_state"] = current
        else:
            data = self._data()
            for doc in data:
                if all(doc.get(k) == v for k, v in query.items() if k != "_id"):
                    doc.update(update.get("$set", {}))
                    return
            if upsert:
                new_doc = {**query, **update.get("$set", {})}
                _store.setdefault(self.name, []).append(new_doc)


class _MemCursor:
    def __init__(self, data, query=None, projection=None):
        self._data = list(data)
        self._query = query or {}
        self._sort_key = None
        self._sort_dir = 1
        self._limit_n = None

    def sort(self, key, direction):
        self._sort_key = key
        self._sort_dir = direction
        return self

    def limit(self, n):
        self._limit_n = n
        return self

    async def to_list(self, length=None):
        result = self._data
        if self._sort_key:
            result = sorted(result, key=lambda d: d.get(self._sort_key, 0), reverse=(self._sort_dir == -1))
        n = length or self._limit_n
        return result[:n] if n else result


def _get_col(name: str):
    if USE_MONGO and db is not None:
        return db[name]
    return _MemCollection(name)

app = FastAPI(title="$ROLLAT API")


def _client_ip(request: Request) -> str:
    """Resolve the real client IP behind a single trusted reverse proxy
    (Render, Vercel rewrites). Honors the leftmost X-Forwarded-For value.
    Falls back to the direct peer when no XFF header is present."""
    xff = request.headers.get("x-forwarded-for") if hasattr(request, "headers") else None
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return get_remote_address(request)


def _ip_plus_address_key(request: Request) -> str:
    """Composite key for /auth/nonce — limits per (ip, address) pair so flooding
    one address from many IPs (or many addresses from one IP) is each capped."""
    addr = ""
    try:
        addr = (request.query_params.get("address") or "").strip()[:48]
    except Exception:
        pass
    return f"{_client_ip(request)}|{addr}"


limiter = Limiter(key_func=_client_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
api_router = APIRouter(prefix="/api")


# ---------- Models ----------
class Winner(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    round_number: int
    wallet: str
    amount_sol: float
    tickets: int
    participants_count: int = 0
    won_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payout_tx: Optional[str] = None


class WinnerTxUpdate(BaseModel):
    tx: Optional[str] = None  # null/empty clears the tx


class WinnerRenumberRequest(BaseModel):
    new_round_number: int


class Stats(BaseModel):
    current_pot_sol: float
    next_spin_at: str  # ISO
    total_qualified_wallets: int
    total_distributed_sol: float
    biggest_win_sol: float
    spins_completed: int
    rollover_active: bool
    rollover_count: int
    pot_threshold_sol: float
    fixed_prize_sol: Optional[float] = None
    token_price_usd: float
    market_cap_usd: float
    holders: int
    spin_phase: str = "idle"
    last_winner: Optional[dict] = None


class WalletStatus(BaseModel):
    wallet: str
    is_qualified: bool
    holdings_tokens: float
    tickets: int
    hours_held: int
    snapshots: List[bool]  # 24 booleans
    is_recent_winner: bool
    next_qualification_in_hours: Optional[int] = None


class SpinState(BaseModel):
    phase: str = "idle"
    round_number: int = 0
    winner: Optional[dict] = None
    participants: List[dict] = []
    participants_count: int = 0
    spin_requested_at: Optional[str] = None
    resolved_at: Optional[str] = None


class QualifiedWalletsResponse(BaseModel):
    wallets: List[dict]
    total: int
    total_tickets: int
    page: int
    per_page: int
    qualification_active: bool = True   # False during the first 24h bootstrap window
    snapshots_captured: int = 24        # how many of the 24 hourly snapshots exist (saturates at 24)


# ---------- WebSocket broadcaster ----------
WS_MAX_CONNECTIONS_TOTAL = 500
WS_MAX_CONNECTIONS_PER_IP = 8


class SpinBroadcaster:
    def __init__(self):
        self.connections: Set[WebSocket] = set()
        self._per_ip: dict[str, int] = {}

    @staticmethod
    def _peer_ip(ws: WebSocket) -> str:
        try:
            xff = ws.headers.get("x-forwarded-for")
            if xff:
                return xff.split(",")[0].strip()
        except Exception:
            pass
        try:
            return ws.client.host if ws.client else "unknown"
        except Exception:
            return "unknown"

    async def connect(self, ws: WebSocket):
        ip = self._peer_ip(ws)
        if len(self.connections) >= WS_MAX_CONNECTIONS_TOTAL:
            await ws.close(code=1013)
            return False
        if self._per_ip.get(ip, 0) >= WS_MAX_CONNECTIONS_PER_IP:
            await ws.close(code=1013)
            return False
        await ws.accept()
        self.connections.add(ws)
        self._per_ip[ip] = self._per_ip.get(ip, 0) + 1
        ws.state.peer_ip = ip
        return True

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.discard(ws)
            ip = getattr(ws.state, "peer_ip", None)
            if ip and ip in self._per_ip:
                self._per_ip[ip] = max(0, self._per_ip[ip] - 1)
                if self._per_ip[ip] == 0:
                    self._per_ip.pop(ip, None)

    async def broadcast(self, data: dict):
        dead = set()
        for ws in list(self.connections):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.disconnect(ws)


broadcaster = SpinBroadcaster()


def tickets_for_holdings(tokens: float) -> int:
    """1M qualifies. 1M→1, 2M→2, 4M→3, 6M→4, 8M→5, 10M+→6 (cap)."""
    if tokens < 1_000_000:
        return 0
    if tokens < 2_000_000:
        return 1
    if tokens < 4_000_000:
        return 2
    if tokens < 6_000_000:
        return 3
    if tokens < 8_000_000:
        return 4
    if tokens < 10_000_000:
        return 5
    return 6


_SECURE_RANDOM = secrets.SystemRandom()


def select_weighted_winner(participants: List[dict]) -> dict:
    pool = [p for p in participants for _ in range(p["tickets"])]
    return _SECURE_RANDOM.choice(pool) if pool else participants[0]


# ---------- Mock data ----------
MOCK_WALLETS = [
    "5xq2HnPmK3rT2fG8aNc8nP", "9aBcDeFgHiJkLmNoPqRsTu", "DkLmNoPqRsTuVwXyZaB3Cd",
    "2vT9HwQ4XyZaBcDeFgHiJk", "Pn4eSz1kAbCdEfGhIjKlMn", "Hg7tUxP9QrStUvWxYzAbCd",
    "Mb3xKlP2EfGhIjKlMnOpQr", "Qa6rVwY7StUvWxYzAbCdEf", "Tn8jMfC5GhIjKlMnOpQrSt",
    "Cz2yBrX0IjKlMnOpQrStUv", "Lq9fNdH3KlMnOpQrStUvWx", "Vy5wGkA6MnOpQrStUvWxYz",
    "Bx1rFcT8OpQrStUvWxYzAb", "Kp6mJeY2QrStUvWxYzAbCd", "Ws4nLhZ7StUvWxYzAbCdEf",
    "Yr2oMiB9UvWxYzAbCdEfGh", "Xz8pNjD4WxYzAbCdEfGhIj", "Fq3sOkE1YzAbCdEfGhIjKl",
    "Gt5tPmF6AbCdEfGhIjKlMn", "Hp7uQnG3CdEfGhIjKlMnOp",
]


def generate_mock_qualified_wallets(count: int = 347) -> List[dict]:
    """Generate deterministic mock qualified wallets."""
    wallets = []
    for i in range(count):
        seed = i * 7919 + 42
        rng = random.Random(seed)
        wallet = MOCK_WALLETS[i % len(MOCK_WALLETS)]
        # Vary the address slightly for uniqueness
        suffix = f"{seed % 9999:04d}"
        wallet = wallet[:18] + suffix
        holdings = round(rng.uniform(1_000_000, 12_000_000), 0)
        tickets = tickets_for_holdings(holdings)
        if tickets == 0:
            tickets = 1
            holdings = 1_200_000
        wallets.append({
            "wallet": wallet,
            "tickets": tickets,
            "holdings_tokens": holdings,
        })
    # Sort by tickets descending
    wallets.sort(key=lambda w: w["tickets"], reverse=True)
    return wallets


POT_THRESHOLD_SOL = 1.0  # minimum pot required to run a real spin

# When set, the daily spin pays this fixed SOL amount and skips the threshold
# gate entirely. Set to None to restore the original "winner takes the whole
# pot, gated by POT_THRESHOLD_SOL" behavior.
FIXED_DAILY_PRIZE_SOL: Optional[float] = 0.1

nonce_store: Optional[NonceStore] = None
snapshot_store: Optional[SnapshotStore] = None


async def daily_reminder_loop() -> None:
    """Background task: sends a 10-minute heads-up before the 12:00 UTC daily spin.
    Tracks the last warned spin datetime so it fires exactly once per day."""
    warned_for: Optional[datetime] = None
    logger.info("[daily_reminder] loop started")
    while True:
        try:
            now = datetime.now(timezone.utc)
            next_spin = _next_daily_spin(now)
            seconds_left = (next_spin - now).total_seconds()
            # Fire when 9m30s–10m30s remain and we haven't warned for this spin yet.
            if 570 <= seconds_left <= 630 and warned_for != next_spin:
                pot = await fetch_pot_balance()
                pot_sol = round(float(pot or 0), 4)
                asyncio.create_task(announce_daily_spin_reminder(
                    pot_sol=pot_sol,
                    next_spin_at_iso=next_spin.isoformat(),
                ))
                warned_for = next_spin
                logger.info(f"[daily_reminder] 10-min warning sent for {next_spin.isoformat()}")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[daily_reminder] tick failed")
        await asyncio.sleep(30)


@app.on_event("startup")
async def on_startup():
    global USE_MONGO, nonce_store, snapshot_store

    # Fail fast if JWT_SECRET is missing or too short — auth cannot work safely without it.
    from auth import JWT_SECRET as _jwt_secret
    if not _jwt_secret or len(_jwt_secret) < 32:
        logger.error("FATAL: JWT_SECRET env var is missing or shorter than 32 chars. Set it before deploying.")
        raise RuntimeError("JWT_SECRET not configured")

    if ADMIN_WALLETS:
        logger.info(f"Admin wallets configured: {len(ADMIN_WALLETS)}")
    else:
        logger.warning("No ADMIN_WALLETS configured — admin endpoints are locked")

    # Production safety: refuse to boot in prod if MONGO_URL is missing or
    # falls back to localhost — silent in-memory mode in prod = lost winners.
    is_prod = os.environ.get("RENDER") or os.environ.get("ENV") == "production"
    raw_mongo = os.environ.get("MONGO_URL", "")
    if is_prod and (not raw_mongo or "localhost" in raw_mongo or "127.0.0.1" in raw_mongo):
        logger.error("FATAL: MONGO_URL missing or pointing at localhost in production")
        raise RuntimeError("MONGO_URL not configured for production")

    try:
        await db.command("ping")
        USE_MONGO = True
        logger.info("MongoDB connected")
    except Exception:
        if is_prod:
            logger.error("FATAL: MongoDB ping failed in production — refusing to start with in-memory store")
            raise
        USE_MONGO = False
        logger.info("MongoDB unavailable — using in-memory store (dev only)")

    nonce_store = NonceStore(_get_col("auth_nonces"))
    await nonce_store.ensure_indexes()

    snapshot_store = SnapshotStore(_get_col("holder_snapshots"))
    await snapshot_store.ensure_indexes()
    snapshot_store.start_loop()

    winners_col = _get_col("winners")
    spin_col = _get_col("spin_state")
    admin_col = _get_col("admin_state")

    # One-time purge of the legacy seed winners + spin_state. Marker doc means
    # we only run this once per Mongo cluster — real winners inserted by future
    # spins are NEVER touched on subsequent boots.
    try:
        purge_marker = await admin_col.find_one({"_id": "seed_purged_v1"})
    except Exception:
        purge_marker = None
    if not purge_marker:
        try:
            deleted = await winners_col.delete_many({})
            logger.info(f"one-time seed purge: removed {getattr(deleted, 'deleted_count', '?')} winners")
        except Exception:
            logger.exception("seed purge: winners delete failed")
        try:
            await spin_col.delete_one({"_id": "singleton"})
            logger.info("one-time seed purge: cleared spin_state singleton")
        except Exception:
            logger.exception("seed purge: spin_state delete failed")
        try:
            await admin_col.insert_one({
                "_id": "seed_purged_v1",
                "at": datetime.now(timezone.utc),
            })
        except Exception:
            logger.exception("seed purge: marker insert failed")

    # Initialize spin_state if missing. round_number starts at 0 so the first
    # trigger increments to 1 (trigger_spin reads `round_number + 1`).
    existing = await spin_col.find_one({"_id": "singleton"})
    if not existing:
        await spin_col.insert_one({
            "_id": "singleton",
            "phase": "idle",
            "round_number": 0,
            "winner": None,
            "participants": [],
            "participants_count": 0,
            "spin_requested_at": None,
            "resolved_at": None,
        })

    # Index for the dev_rolls scheduler (find scheduled rolls by time).
    try:
        await _get_col("dev_rolls").create_index([("scheduled_at", 1), ("phase", 1)])
    except Exception:
        # in-memory fallback collections don't support indexes
        pass
    try:
        await _get_col("guest_rolls").create_index([("scheduled_at", 1), ("phase", 1)])
    except Exception:
        pass

    # Background task: scan for due dev rolls every few seconds and run them.
    asyncio.create_task(dev_scheduler_loop(_get_col))
    # Background task: same for guest rolls (10-coin partner spins).
    asyncio.create_task(guest_scheduler_loop(_get_col))
    # Background task: 10-min daily spin reminder.
    asyncio.create_task(daily_reminder_loop())
    # Background task: auto-trigger the daily spin at 00:00 UTC.
    asyncio.create_task(daily_spin_loop())


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "$ROLLAT API live", "status": "spinning"}


# ---------- Sign-in-with-Solana ----------
@api_router.get("/auth/nonce", response_model=NonceResponse)
@limiter.limit("10/minute", key_func=_ip_plus_address_key)
async def auth_nonce(request: Request, address: str):
    """Issue a one-time nonce + SIWS message for the given wallet address."""
    if nonce_store is None:
        raise HTTPException(status_code=503, detail="auth not initialized")
    return await nonce_store.issue(address)


@api_router.post("/auth/verify", response_model=VerifyResponse)
@limiter.limit("10/minute")
async def auth_verify(request: Request, req: VerifyRequest):
    """Verify a signed SIWS message and return a short-lived JWT."""
    if nonce_store is None:
        raise HTTPException(status_code=503, detail="auth not initialized")

    doc = await nonce_store.consume(req.address, req.nonce)
    if not doc:
        raise HTTPException(status_code=400, detail="nonce missing, expired, or already used")

    message = doc.get("message")
    if not message or not verify_solana_signature(req.address, message, req.signature):
        raise HTTPException(status_code=401, detail="signature verification failed")

    token, exp = issue_jwt(req.address)
    return VerifyResponse(
        token=token,
        address=req.address,
        expires_at=exp.isoformat(),
        is_admin=is_admin_wallet(req.address),
    )


@api_router.post("/auth/logout")
async def auth_logout(creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer)):
    """Revoke the presented JWT for the remainder of its TTL."""
    if creds and creds.credentials:
        try:
            payload = verify_jwt(creds.credentials)
            jti = payload.get("jti")
            exp = payload.get("exp", 0)
            if jti:
                revoke_jti(jti, int(exp))
        except HTTPException:
            pass  # already invalid/expired — nothing to revoke
    return {"ok": True}


@api_router.get("/auth/me", response_model=MeResponse)
async def auth_me(address: str = Depends(get_current_wallet)):
    """Returns the wallet bound to the current JWT. Useful for client to verify a token is still valid."""
    # exp isn't stored separately; client can decode jti/exp itself, but echoing the address proves authenticity
    return MeResponse(address=address, expires_at="", is_admin=is_admin_wallet(address))


@api_router.get("/snapshots/status")
async def snapshots_status():
    """Operational endpoint: confirms the hourly snapshot loop is running.
    Returns total snapshots stored, the most recent capture time, and the
    most-recent holder count. Public so the frontend can show 'system live' UX."""
    coll = _get_col("holder_snapshots")
    try:
        total = await coll.count_documents({}) if hasattr(coll, "count_documents") else 0
    except Exception:
        total = 0
    latest_at: Optional[str] = None
    latest_holders: Optional[int] = None
    try:
        latest = await coll.find_one({}, sort=[("captured_at", -1)])
        if latest:
            ts = latest.get("captured_at")
            latest_at = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
            latest_holders = latest.get("total_holders")
    except Exception:
        pass
    return {
        "total_snapshots": total,
        "latest_captured_at": latest_at,
        "latest_holder_count": latest_holders,
        "ttl_hours": 48,
    }


def _next_daily_spin(now: datetime) -> datetime:
    """Spin cadence is 24h, anchored at 12:00 UTC. Returns the next anchor strictly in the future."""
    today_anchor = now.replace(hour=12, minute=0, second=0, microsecond=0)
    if now < today_anchor:
        return today_anchor
    return today_anchor + timedelta(days=1)


@api_router.get("/stats", response_model=Stats)
async def get_stats():
    now = datetime.now(timezone.utc)
    next_spin = _next_daily_spin(now)
    winners = await _get_col("winners").find({}, {"_id": 0}).to_list(1000)
    total_distributed = sum(w.get("amount_sol", 0) for w in winners)
    biggest = max((w.get("amount_sol", 0) for w in winners), default=0)
    spins = len(winners)

    # Get spin state
    spin_doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    spin_phase = spin_doc.get("phase", "idle") if spin_doc else "idle"
    last_winner = spin_doc.get("winner") if spin_doc else None
    rollover_count = spin_doc.get("rollover_count", 0) if spin_doc else 0

    # Pull live on-chain numbers + snapshot history in parallel. All inputs
    # are cached or indexed so /stats stays fast under polling.
    market, holders, recent_snaps, pot_sol = await asyncio.gather(
        fetch_token_market_data(),
        fetch_holders_count(),
        fetch_recent_snapshots(_get_col("holder_snapshots")),
        fetch_pot_balance(),
    )

    # Strict qualification: only count wallets when ≥24 snapshots exist.
    qualified_count = len(compute_qualified_wallets(recent_snaps)) if has_sufficient_history(recent_snaps) else 0

    return Stats(
        current_pot_sol=round(float(pot_sol or 0), 4),
        next_spin_at=next_spin.isoformat(),
        total_qualified_wallets=qualified_count,
        total_distributed_sol=round(total_distributed, 2),
        biggest_win_sol=round(biggest, 2),
        spins_completed=spins,
        rollover_active=rollover_count > 0,
        rollover_count=rollover_count,
        pot_threshold_sol=POT_THRESHOLD_SOL,
        fixed_prize_sol=FIXED_DAILY_PRIZE_SOL,
        token_price_usd=float(market.get("price_usd") or 0),
        market_cap_usd=float(market.get("market_cap_usd") or 0),
        holders=int(holders or 0),
        spin_phase=spin_phase,
        last_winner=last_winner,
    )


@api_router.get("/winners", response_model=List[Winner])
async def get_winners(limit: int = 20):
    limit = max(1, min(limit, 100))  # clamp: 1-100
    winners = await _get_col("winners").find({}, {"_id": 0}).sort("round_number", -1).to_list(limit)
    for w in winners:
        if isinstance(w.get("won_at"), str):
            w["won_at"] = datetime.fromisoformat(w["won_at"])
    return winners


def _is_valid_solana_tx_signature(sig: str) -> bool:
    """Solana tx signatures are 64-byte ed25519 signatures, base58-encoded
    (typically 87-88 chars, sometimes a hair shorter)."""
    if not isinstance(sig, str):
        return False
    s = sig.strip()
    if not (40 <= len(s) <= 100):
        return False
    try:
        import base58 as _b58
        raw = _b58.b58decode(s)
        return len(raw) == 64
    except Exception:
        return False


@api_router.patch("/admin/winners/{round_number}/tx", response_model=Winner)
async def admin_set_winner_tx(
    round_number: int,
    payload: WinnerTxUpdate,
    admin: str = Depends(get_admin_wallet),
):
    """Admin sets (or clears) the payout transaction signature for a past
    spin's winner. The signature is shown publicly as a Solscan link."""
    tx_value: Optional[str] = None
    if payload.tx is not None and payload.tx.strip():
        candidate = payload.tx.strip()
        if not _is_valid_solana_tx_signature(candidate):
            raise HTTPException(status_code=400, detail="Invalid Solana transaction signature")
        tx_value = candidate

    result = await _get_col("winners").find_one_and_update(
        {"round_number": round_number},
        {"$set": {"payout_tx": tx_value}},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(status_code=404, detail="Winner not found")
    if isinstance(result.get("won_at"), str):
        result["won_at"] = datetime.fromisoformat(result["won_at"])
    return result


@api_router.patch("/admin/winners/{round_number}/renumber", response_model=Winner)
async def admin_renumber_winner(
    round_number: int,
    payload: WinnerRenumberRequest,
    admin: str = Depends(get_admin_wallet),
):
    """Admin renames a winner's round number. Used to fix off-by-one mistakes
    from earlier deploys. Refuses to overwrite a different existing winner."""
    new_round = payload.new_round_number
    if new_round < 1:
        raise HTTPException(status_code=400, detail="new_round_number must be >= 1")
    if new_round == round_number:
        raise HTTPException(status_code=400, detail="new_round_number is the same as the current round")

    winners_col = _get_col("winners")
    target = await winners_col.find_one({"round_number": round_number})
    if not target:
        raise HTTPException(status_code=404, detail=f"No winner with round_number={round_number}")

    collision = await winners_col.find_one({"round_number": new_round})
    if collision:
        raise HTTPException(status_code=409, detail=f"Round #{new_round} is already taken by another winner")

    await winners_col.update_one(
        {"round_number": round_number},
        {"$set": {"round_number": new_round}},
    )

    # Keep spin_state's round_number in sync if it was pointing at the old number.
    spin_col = _get_col("spin_state")
    spin_doc = await spin_col.find_one({"_id": "singleton"})
    if spin_doc and spin_doc.get("round_number") == round_number:
        await spin_col.update_one(
            {"_id": "singleton"},
            {"$set": {"round_number": new_round}},
        )

    updated = await winners_col.find_one({"round_number": new_round}, {"_id": 0})
    if updated and isinstance(updated.get("won_at"), str):
        updated["won_at"] = datetime.fromisoformat(updated["won_at"])
    return updated


def _is_valid_solana_address(addr: str) -> bool:
    try:
        import base58 as _b58
        raw = _b58.b58decode(addr)
        return len(raw) == 32
    except Exception:
        return False


async def _wallet_check_core(wallet: str) -> "WalletStatus":
    if not wallet or not _is_valid_solana_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address")

    # Live current balance from RPC (what the user holds right now) + snapshot
    # history (what determines qualification). The two can disagree briefly
    # right after a buy/sell since snapshots are hourly.
    holdings, recent_snaps = await asyncio.gather(
        fetch_wallet_balance(wallet),
        fetch_recent_snapshots(_get_col("holder_snapshots")),
    )
    status = compute_wallet_status(recent_snaps, wallet)

    # Recent-winner lockout (last spin's winner can't qualify next round).
    last_winner_doc = await _get_col("winners").find_one(
        {}, {"_id": 0}, sort=[("round_number", -1)]
    )
    is_recent_winner = bool(last_winner_doc and last_winner_doc.get("wallet") == wallet)

    is_qualified = status["is_qualified"] and not is_recent_winner and wallet not in EXCLUDED_WALLETS
    next_in = None if is_qualified else max(1, REQUIRED_SNAPSHOTS - status["hours_held"])

    return WalletStatus(
        wallet=wallet,
        is_qualified=is_qualified,
        holdings_tokens=holdings,
        tickets=status["tickets"] if is_qualified else 0,
        hours_held=status["hours_held"],
        snapshots=status["snapshots"],
        is_recent_winner=is_recent_winner,
        next_qualification_in_hours=next_in,
    )


@api_router.get("/wallet-check/{wallet}", response_model=WalletStatus)
@limiter.limit("30/minute")
async def wallet_check(request: Request, wallet: str):
    return await _wallet_check_core(wallet)


@api_router.get("/dashboard/{wallet}")
@limiter.limit("30/minute")
async def dashboard(request: Request, wallet: str):
    status = await _wallet_check_core(wallet)
    history = await _get_col("winners").find(
        {"wallet": wallet}, {"_id": 0}
    ).sort("round_number", -1).to_list(20)
    for h in history:
        if isinstance(h.get("won_at"), str):
            h["won_at"] = datetime.fromisoformat(h["won_at"])
    participation = [
        {
            "round_number": h["round_number"],
            "qualified": True,
            "tickets": h["tickets"],
            "won": True,
        }
        for h in history[:5]
    ]
    return {
        "status": status.model_dump(),
        "win_history": history,
        "participation": participation,
    }


@api_router.get("/spin/state", response_model=SpinState)
async def get_spin_state():
    doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    if not doc:
        return SpinState()
    return SpinState(
        phase=doc.get("phase", "idle"),
        round_number=doc.get("round_number", 0),
        winner=doc.get("winner"),
        participants=doc.get("participants", []),
        participants_count=doc.get("participants_count", 0),
        spin_requested_at=doc.get("spin_requested_at"),
        resolved_at=doc.get("resolved_at"),
    )


async def _run_daily_spin_core() -> dict:
    """Core spin logic shared by the admin trigger and the auto scheduler.
    Raises HTTPException(409) if a spin is already in progress."""
    doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    if doc and doc.get("phase") == "spinning":
        raise HTTPException(status_code=409, detail="Spin already in progress")

    # Rollover check: if pot hasn't hit the threshold, skip the spin and announce.
    # In fixed-prize mode this gate is bypassed entirely — the spin always runs
    # and the winner gets FIXED_DAILY_PRIZE_SOL regardless of pot balance.
    pot_check = await fetch_pot_balance()
    pot_check_sol = round(float(pot_check or 0), 4)
    prize_required = float(FIXED_DAILY_PRIZE_SOL) if FIXED_DAILY_PRIZE_SOL is not None else POT_THRESHOLD_SOL
    if pot_check_sol < prize_required:
        rollover_count = (doc.get("rollover_count", 0) + 1) if doc else 1
        await _get_col("spin_state").update_one(
            {"_id": "singleton"},
            {"$set": {"rollover_count": rollover_count, "phase": "awaiting_funds"}},
            upsert=True,
        )
        asyncio.create_task(announce_rollover(
            pot_sol=pot_check_sol,
            threshold_sol=prize_required,
            rollover_count=rollover_count,
        ))
        logger.info(f"[spin] rollover #{rollover_count} — pot {pot_check_sol} SOL < required {prize_required} SOL")
        return {
            "status": "rollover",
            "pot_sol": pot_check_sol,
            "threshold_sol": prize_required,
            "rollover_count": rollover_count,
        }

    recent_snaps = await fetch_recent_snapshots(_get_col("holder_snapshots"))
    if has_sufficient_history(recent_snaps):
        participants = compute_qualified_wallets(recent_snaps)
    else:
        participants = generate_mock_qualified_wallets(50)

    now = datetime.now(timezone.utc).isoformat()
    round_number = (doc.get("round_number", 0) + 1) if doc else 1

    await _get_col("spin_state").update_one(
        {"_id": "singleton"},
        {"$set": {
            "phase": "spinning",
            "round_number": round_number,
            "winner": None,
            "participants": participants[:100],  # Store first 100 for animation
            "participants_count": len(participants),
            "spin_requested_at": now,
            "resolved_at": None,
        }},
        upsert=True,
    )

    await broadcaster.broadcast({
        "event": "spin_started",
        "round": round_number,
        "participants_count": len(participants),
    })

    pot_sol_now = await fetch_pot_balance()
    announced_prize = (
        float(FIXED_DAILY_PRIZE_SOL)
        if FIXED_DAILY_PRIZE_SOL is not None
        else round(float(pot_sol_now or 0), 4)
    )
    asyncio.create_task(announce_daily_spin_started(
        round_number=round_number,
        participants_count=len(participants),
        pot_sol=announced_prize,
    ))

    # Resolve after animation time (10s)
    asyncio.create_task(_resolve_after_delay(participants, round_number, 10))
    return {"status": "spinning", "round": round_number, "participants": len(participants)}


@api_router.post("/spin/trigger")
async def trigger_spin(admin: str = Depends(get_admin_wallet)):
    return await _run_daily_spin_core()


async def daily_spin_loop() -> None:
    """Background task: auto-triggers the daily spin at 12:00 UTC.
    Fires within a 5-minute grace window after the anchor; tracks the last
    anchor it ran for so it never double-fires."""
    ran_for: Optional[datetime] = None
    logger.info("[daily_spin] auto-trigger loop started")
    while True:
        try:
            now = datetime.now(timezone.utc)
            current_anchor = now.replace(hour=12, minute=0, second=0, microsecond=0)
            seconds_since_anchor = (now - current_anchor).total_seconds()
            if 0 <= seconds_since_anchor <= 300 and ran_for != current_anchor:
                doc = await _get_col("spin_state").find_one({"_id": "singleton"})
                phase = (doc or {}).get("phase", "idle")
                if phase == "spinning":
                    logger.info("[daily_spin] anchor reached but spin already in progress — skipping")
                    ran_for = current_anchor
                else:
                    try:
                        result = await _run_daily_spin_core()
                        logger.info(f"[daily_spin] auto-triggered at {current_anchor.isoformat()}: {result}")
                    except HTTPException as e:
                        logger.warning(f"[daily_spin] auto-trigger rejected: {e.detail}")
                    except Exception:
                        logger.exception("[daily_spin] auto-trigger failed")
                    ran_for = current_anchor
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[daily_spin] tick failed")
        await asyncio.sleep(2)


async def _resolve_after_delay(participants: List[dict], round_number: int, delay: int):
    await asyncio.sleep(delay)
    winner_entry = select_weighted_winner(participants)
    pot_sol = await fetch_pot_balance()
    if FIXED_DAILY_PRIZE_SOL is not None:
        amount_sol = float(FIXED_DAILY_PRIZE_SOL)
    else:
        amount_sol = round(float(pot_sol or 0), 4)
    now = datetime.now(timezone.utc)

    winner_data = {
        "wallet": winner_entry["wallet"],
        "tickets": winner_entry["tickets"],
        "amount_sol": amount_sol,
        "round_number": round_number,
    }

    # Save to winners collection
    await _get_col("winners").insert_one({
        "id": str(uuid.uuid4()),
        "round_number": round_number,
        "wallet": winner_entry["wallet"],
        "amount_sol": amount_sol,
        "tickets": winner_entry["tickets"],
        "participants_count": len(participants),
        "won_at": now.isoformat(),
    })

    # Update spin state to resolved
    await _get_col("spin_state").update_one(
        {"_id": "singleton"},
        {"$set": {
            "phase": "resolved",
            "winner": winner_data,
            "resolved_at": now.isoformat(),
        }},
    )

    await broadcaster.broadcast({
        "event": "spin_resolved",
        "round": round_number,
        "winner": winner_data,
    })

    asyncio.create_task(announce_daily_spin_winner(
        round_number=round_number,
        winner_wallet=winner_entry["wallet"],
        amount_sol=amount_sol,
        participants_count=len(participants),
    ))
    asyncio.create_task(announce_buy_cta())

    # Return to idle after 30s
    await asyncio.sleep(30)
    await _get_col("spin_state").update_one(
        {"_id": "singleton"},
        {"$set": {
            "phase": "idle",
            "round_number": round_number + 1,
        }},
    )
    await broadcaster.broadcast({"event": "spin_idle", "round": round_number + 1})


@api_router.get("/qualified-wallets", response_model=QualifiedWalletsResponse)
async def get_qualified_wallets(page: int = 1, per_page: int = 50, search: str = ""):
    page = max(1, page)
    per_page = max(1, min(per_page, 100))
    search = search[:50]  # prevent absurdly long search strings
    recent_snaps = await fetch_recent_snapshots(_get_col("holder_snapshots"))
    snapshots_captured = min(len(recent_snaps), REQUIRED_SNAPSHOTS)
    qualification_active = has_sufficient_history(recent_snaps)

    all_wallets = compute_qualified_wallets(recent_snaps) if qualification_active else []

    if search:
        s = search.lower()
        all_wallets = [w for w in all_wallets if s in w["wallet"].lower()]

    total = len(all_wallets)
    total_tickets = sum(w["tickets"] for w in all_wallets)
    start = max(0, (page - 1) * per_page)
    end = start + per_page
    page_wallets = all_wallets[start:end]

    # Add win probability + holdings (using min_balance, the actual qualifying amount)
    for w in page_wallets:
        w["win_probability"] = round((w["tickets"] / total_tickets * 100), 2) if total_tickets > 0 else 0
        w["holdings"] = w.get("min_balance", 0)

    return QualifiedWalletsResponse(
        wallets=page_wallets,
        total=total,
        total_tickets=total_tickets,
        page=page,
        per_page=per_page,
        qualification_active=qualification_active,
        snapshots_captured=snapshots_captured,
    )


# ---------- Dev Roll (admin-only setup, public live view) ----------

class DevRollCreateRequest(BaseModel):
    title: Optional[str] = None  # e.g. "Community Giveaway #3" (max 60 chars)
    wallets: List[str]
    pot_sol: float
    scheduled_at: str  # ISO 8601 with timezone


class DevRollUpdateRequest(BaseModel):
    wallets_to_add: Optional[List[str]] = None  # appended + deduped
    title: Optional[str] = None
    pot_sol: Optional[float] = None
    scheduled_at: Optional[str] = None  # ISO 8601 with timezone


def _parse_scheduled_at(raw: str) -> datetime:
    try:
        # Accept "...Z" suffix as UTC for browser <input type="datetime-local"> + manual UTC use.
        cleaned = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="scheduled_at must be a valid ISO 8601 datetime")
    if dt.tzinfo is None:
        # Assume UTC when caller didn't specify (matches the form's UTC-only label)
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@api_router.post("/dev/roll")
async def dev_roll_create(req: DevRollCreateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at)
    return await create_dev_roll(
        _get_col("dev_rolls"),
        title=req.title,
        wallets=req.wallets,
        pot_sol=req.pot_sol,
        scheduled_at=sched,
        created_by=admin,
    )


@api_router.get("/dev/roll/current")
async def dev_roll_current():
    """Public — returns the active or recently-resolved dev roll, or null."""
    return await fetch_current_dev_roll(_get_col("dev_rolls"))


@api_router.patch("/dev/roll/{roll_id}")
async def dev_roll_update(roll_id: str, req: DevRollUpdateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at) if req.scheduled_at else None
    return await update_dev_roll(
        _get_col("dev_rolls"),
        roll_id,
        wallets_to_add=req.wallets_to_add,
        title=req.title,
        pot_sol=req.pot_sol,
        scheduled_at=sched,
    )


@api_router.delete("/dev/roll/{roll_id}")
async def dev_roll_cancel(roll_id: str, admin: str = Depends(get_admin_wallet)):
    return await cancel_dev_roll(_get_col("dev_rolls"), roll_id)


@api_router.get("/dev/rolls")
async def dev_rolls_history(admin: str = Depends(get_admin_wallet)):
    return await list_dev_rolls(_get_col("dev_rolls"), limit=50)


# ---------- Guest Roll routes ----------
class GuestEntryRequest(BaseModel):
    name: str
    ticker: str
    logo_url: Optional[str] = None
    link: Optional[str] = None


class GuestRollCreateRequest(BaseModel):
    title: Optional[str] = None
    prize_label: Optional[str] = "DexScreener Boost"
    entries: List[GuestEntryRequest]
    scheduled_at: str  # ISO 8601


class GuestRollUpdateRequest(BaseModel):
    title: Optional[str] = None
    prize_label: Optional[str] = None
    entries: Optional[List[GuestEntryRequest]] = None  # replaces the list
    scheduled_at: Optional[str] = None


@api_router.post("/guest/roll")
async def guest_roll_create(req: GuestRollCreateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at)
    return await create_guest_roll(
        _get_col("guest_rolls"),
        title=req.title,
        prize_label=req.prize_label,
        entries=[e.model_dump() for e in req.entries],
        scheduled_at=sched,
        created_by=admin,
    )


@api_router.get("/guest/roll/current")
async def guest_roll_current():
    return await fetch_current_guest_roll(_get_col("guest_rolls"))


@api_router.patch("/guest/roll/{roll_id}")
async def guest_roll_update(roll_id: str, req: GuestRollUpdateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at) if req.scheduled_at else None
    entries = [e.model_dump() for e in req.entries] if req.entries is not None else None
    return await update_guest_roll(
        _get_col("guest_rolls"),
        roll_id,
        title=req.title,
        prize_label=req.prize_label,
        entries=entries,
        scheduled_at=sched,
    )


@api_router.delete("/guest/roll/{roll_id}")
async def guest_roll_cancel(roll_id: str, admin: str = Depends(get_admin_wallet)):
    return await cancel_guest_roll(_get_col("guest_rolls"), roll_id)


@api_router.get("/guest/rolls")
async def guest_rolls_history(admin: str = Depends(get_admin_wallet)):
    return await list_guest_rolls(_get_col("guest_rolls"), limit=50)


# ---------- Guest Roll public applications ----------
class GuestApplyRequest(BaseModel):
    name: str
    ticker: str
    logo_url: Optional[str] = None
    community_link: str
    contact: str
    contract_address: Optional[str] = None
    notes: Optional[str] = None


@api_router.post("/guest/apply")
@limiter.limit("3/minute")
async def guest_apply(request: Request, req: GuestApplyRequest):
    """Public — projects submit themselves to be in a future Guest Roll."""
    return await submit_guest_application(
        _get_col("guest_applications"),
        req.model_dump(),
        submitter_ip=_client_ip(request),
    )


@api_router.get("/guest/applications")
async def guest_applications_list(admin: str = Depends(get_admin_wallet)):
    return await list_guest_applications(_get_col("guest_applications"), limit=200)


class GuestApplicationStatusRequest(BaseModel):
    status: str  # pending | approved | rejected


@api_router.patch("/guest/applications/{app_id}")
async def guest_application_update(app_id: str, req: GuestApplicationStatusRequest, admin: str = Depends(get_admin_wallet)):
    return await update_guest_application(_get_col("guest_applications"), app_id, status=req.status)


@api_router.delete("/guest/applications/{app_id}")
async def guest_application_delete(app_id: str, admin: str = Depends(get_admin_wallet)):
    return await delete_guest_application(_get_col("guest_applications"), app_id)


# ---------- WebSocket ----------
@app.websocket("/ws/spin")
async def websocket_spin(websocket: WebSocket):
    accepted = await broadcaster.connect(websocket)
    if not accepted:
        return
    try:
        while True:
            await websocket.receive_text()  # Keep alive, ignore incoming
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)
    except Exception:
        broadcaster.disconnect(websocket)


app.include_router(api_router)

# CORS: we authenticate via Authorization: Bearer in axios (token in localStorage),
# never via cookies. allow_credentials=True with allow_origins=* is a spec
# violation that returns 400 on preflight, so we explicitly set credentials=False
# and provide a sensible default origin list for when CORS_ORIGINS is unset.
DEFAULT_CORS_ORIGINS = "https://rollat.vercel.app,https://rollat.xyz,http://localhost:3000"
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', DEFAULT_CORS_ORIGINS).split(',') if o.strip()],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

@app.on_event("shutdown")
async def shutdown_db_client():
    if snapshot_store is not None:
        snapshot_store.stop_loop()
    client.close()
