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
    fetch_dev_roll,
    list_dev_rolls,
    dev_scheduler_loop,
    set_tournament_store as set_dev_rolls_tournament_store,
)
from tournaments import TournamentStore, _normalize_x_handle
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
    set_runtime_config_getter as set_tg_runtime_config_getter,
    list_events as tg_list_events,
    send_custom as tg_send_custom,
    EVENT_DEFAULTS,
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
    bonus_for_streak,
    REQUIRED_SNAPSHOTS,
    EXCLUDED_WALLETS,
    MIN_QUALIFYING_TOKENS,
)
from streaks import StreakStore


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------- DB setup (MongoDB with in-memory fallback) ----------
# Render deploy trigger.
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
    base_tickets: int = 0
    bonus_tickets: int = 0
    streak_days: int = 0
    days_to_next_bonus: Optional[int] = None
    next_bonus_amount: Optional[int] = None


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

# ── Runtime config (Mongo-backed, hot-reloadable) ──────────────────────────
# Operator-tweakable knobs live in the `runtime_config` singleton doc and are
# merged on top of the code defaults above. The cache below avoids per-request
# DB round-trips. PATCHing /api/admin/config invalidates it immediately.
_RUNTIME_CFG_TTL_SECONDS = 30.0
_runtime_cfg_cache: dict = {"data": None, "loaded_at": 0.0}


def _runtime_defaults() -> dict:
    return {
        "fixed_daily_prize_sol": float(FIXED_DAILY_PRIZE_SOL) if FIXED_DAILY_PRIZE_SOL is not None else None,
        "pot_threshold_sol": float(POT_THRESHOLD_SOL),
        "min_qualifying_tokens": int(MIN_QUALIFYING_TOKENS),
        "excluded_wallets": sorted(EXCLUDED_WALLETS),
        # Long-term holder bonus
        "streak_bonus_enabled": True,
        "streak_week_threshold": 7,
        "streak_month_threshold": 30,
        "streak_grace_days": 1,
        "max_bonus_tickets": 10,
        # Telegram bot — runtime-tunable announcement controls.
        # `tg_announcements_enabled` is the master kill switch.
        # `tg_event_disabled` is a list of event names (see telegram_bot.EVENT_DEFAULTS) to skip.
        # `tg_templates` overrides the default per-event Markdown template, keyed by event name.
        "tg_announcements_enabled": True,
        "tg_event_disabled": [],
        "tg_templates": {},
        # How long a resolved Dev Roll / Guest Roll lingers on the public site
        # after it finishes (seconds). Default 24h. Applies to both roll types.
        # 60s minimum, 7d maximum.
        "resolved_display_secs": 86400,
    }


async def get_runtime_config(force_refresh: bool = False) -> dict:
    """Return the current runtime config (defaults merged with DB overrides).
    Falls back to defaults on any DB error so the spin never gets bricked by Mongo issues."""
    import time
    now = time.monotonic()
    cached = _runtime_cfg_cache.get("data")
    if (
        not force_refresh
        and cached is not None
        and (now - _runtime_cfg_cache.get("loaded_at", 0.0)) < _RUNTIME_CFG_TTL_SECONDS
    ):
        return cached

    cfg = _runtime_defaults()
    try:
        doc = await _get_col("runtime_config").find_one({"_id": "singleton"})
    except Exception:
        doc = None
    if doc:
        if "fixed_daily_prize_sol" in doc:
            v = doc["fixed_daily_prize_sol"]
            cfg["fixed_daily_prize_sol"] = float(v) if v is not None else None
        if "pot_threshold_sol" in doc and doc["pot_threshold_sol"] is not None:
            cfg["pot_threshold_sol"] = float(doc["pot_threshold_sol"])
        if "min_qualifying_tokens" in doc and doc["min_qualifying_tokens"] is not None:
            cfg["min_qualifying_tokens"] = int(doc["min_qualifying_tokens"])
        if "excluded_wallets" in doc and isinstance(doc["excluded_wallets"], list):
            cfg["excluded_wallets"] = [str(w) for w in doc["excluded_wallets"]]
        if "streak_bonus_enabled" in doc:
            cfg["streak_bonus_enabled"] = bool(doc["streak_bonus_enabled"])
        if "streak_week_threshold" in doc and doc["streak_week_threshold"] is not None:
            cfg["streak_week_threshold"] = int(doc["streak_week_threshold"])
        if "streak_month_threshold" in doc and doc["streak_month_threshold"] is not None:
            cfg["streak_month_threshold"] = int(doc["streak_month_threshold"])
        if "streak_grace_days" in doc and doc["streak_grace_days"] is not None:
            cfg["streak_grace_days"] = int(doc["streak_grace_days"])
        if "max_bonus_tickets" in doc and doc["max_bonus_tickets"] is not None:
            cfg["max_bonus_tickets"] = int(doc["max_bonus_tickets"])
        if "tg_announcements_enabled" in doc:
            cfg["tg_announcements_enabled"] = bool(doc["tg_announcements_enabled"])
        if "tg_event_disabled" in doc and isinstance(doc["tg_event_disabled"], list):
            cfg["tg_event_disabled"] = [str(s) for s in doc["tg_event_disabled"]]
        if "tg_templates" in doc and isinstance(doc["tg_templates"], dict):
            cfg["tg_templates"] = {
                str(k): str(v) for k, v in doc["tg_templates"].items() if isinstance(v, str)
            }
        if "resolved_display_secs" in doc and doc["resolved_display_secs"] is not None:
            try:
                cfg["resolved_display_secs"] = int(doc["resolved_display_secs"])
            except (TypeError, ValueError):
                pass
        cfg["updated_at"] = doc.get("updated_at")
        cfg["updated_by"] = doc.get("updated_by")

    _runtime_cfg_cache["data"] = cfg
    _runtime_cfg_cache["loaded_at"] = now
    return cfg


def _invalidate_runtime_cfg_cache() -> None:
    _runtime_cfg_cache["data"] = None
    _runtime_cfg_cache["loaded_at"] = 0.0


nonce_store: Optional[NonceStore] = None
snapshot_store: Optional[SnapshotStore] = None
streak_store: Optional[StreakStore] = None
tournament_store: Optional[TournamentStore] = None


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
    global USE_MONGO, nonce_store, snapshot_store, streak_store, tournament_store

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

    streak_store = StreakStore(_get_col("holder_streaks"))
    await streak_store.ensure_indexes()

    # Tournament (Last Team Standing) supporter store — injected into
    # dev_rolls.py via setter to avoid an import cycle.
    tournament_store = TournamentStore(_get_col("tournament_supporters"))
    await tournament_store.ensure_indexes()
    set_dev_rolls_tournament_store(tournament_store)

    # Let telegram_bot read the live runtime config (toggles + custom
    # templates) without creating an import cycle.
    set_tg_runtime_config_getter(get_runtime_config)

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
    # Secondary index for elimination ticks: scan only the rolls whose next
    # tick has arrived without sweeping the full collection.
    try:
        await _get_col("dev_rolls").create_index([("phase", 1), ("mode", 1), ("next_elimination_at", 1)])
    except Exception:
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
    cfg = await get_runtime_config()
    excl = frozenset(cfg.get("excluded_wallets") or [])
    market, holders, recent_snaps, pot_sol = await asyncio.gather(
        fetch_token_market_data(),
        fetch_holders_count(),
        fetch_recent_snapshots(_get_col("holder_snapshots")),
        fetch_pot_balance(),
    )

    # Strict qualification: only count wallets when ≥24 snapshots exist.
    qualified_count = (
        len(compute_qualified_wallets(
            recent_snaps,
            min_tokens=cfg.get("min_qualifying_tokens"),
            excluded=excl,
        ))
        if has_sufficient_history(recent_snaps) else 0
    )

    return Stats(
        current_pot_sol=round(float(pot_sol or 0), 4),
        next_spin_at=next_spin.isoformat(),
        total_qualified_wallets=qualified_count,
        total_distributed_sol=round(total_distributed, 2),
        biggest_win_sol=round(biggest, 2),
        spins_completed=spins,
        rollover_active=rollover_count > 0,
        rollover_count=rollover_count,
        pot_threshold_sol=float(cfg.get("pot_threshold_sol", POT_THRESHOLD_SOL)),
        fixed_prize_sol=cfg.get("fixed_daily_prize_sol"),
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


# ── Admin: runtime config + snapshot management ───────────────────────────

@api_router.get("/admin/config")
async def admin_get_config(admin: str = Depends(get_admin_wallet)):
    cfg = await get_runtime_config(force_refresh=True)
    return {
        "current": cfg,
        "defaults": _runtime_defaults(),
    }


@api_router.patch("/admin/config")
async def admin_patch_config(payload: dict, admin: str = Depends(get_admin_wallet)):
    update: dict = {}

    if "fixed_daily_prize_sol" in payload:
        v = payload["fixed_daily_prize_sol"]
        if v is None:
            update["fixed_daily_prize_sol"] = None
        else:
            try:
                f = float(v)
                if f < 0:
                    raise ValueError
                update["fixed_daily_prize_sol"] = f
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="fixed_daily_prize_sol must be a non-negative number or null")

    if "pot_threshold_sol" in payload:
        try:
            f = float(payload["pot_threshold_sol"])
            if f < 0:
                raise ValueError
            update["pot_threshold_sol"] = f
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="pot_threshold_sol must be a non-negative number")

    if "min_qualifying_tokens" in payload:
        try:
            n = int(payload["min_qualifying_tokens"])
            if n < 0:
                raise ValueError
            update["min_qualifying_tokens"] = n
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="min_qualifying_tokens must be a non-negative integer")

    if "excluded_wallets" in payload:
        raw = payload["excluded_wallets"]
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="excluded_wallets must be a list of strings")
        cleaned: list[str] = []
        seen: set[str] = set()
        for w in raw:
            if not isinstance(w, str):
                raise HTTPException(status_code=400, detail="excluded_wallets entries must be strings")
            ww = w.strip()
            if not ww or ww in seen:
                continue
            if not _is_valid_solana_address(ww):
                raise HTTPException(status_code=400, detail=f"Invalid Solana address: {ww}")
            seen.add(ww)
            cleaned.append(ww)
        if len(cleaned) > 500:
            raise HTTPException(status_code=400, detail="excluded_wallets cannot exceed 500 entries")
        update["excluded_wallets"] = cleaned

    if "streak_bonus_enabled" in payload:
        update["streak_bonus_enabled"] = bool(payload["streak_bonus_enabled"])

    for fld, lo in (
        ("streak_week_threshold", 1),
        ("streak_month_threshold", 1),
        ("max_bonus_tickets", 0),
    ):
        if fld in payload:
            try:
                n = int(payload[fld])
                if n < lo:
                    raise ValueError
                update[fld] = n
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{fld} must be an integer >= {lo}")

    if "streak_grace_days" in payload:
        try:
            n = int(payload["streak_grace_days"])
            if n not in (0, 1):
                raise ValueError
            update["streak_grace_days"] = n
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="streak_grace_days must be 0 or 1")

    # ---- Telegram bot controls ----
    if "tg_announcements_enabled" in payload:
        update["tg_announcements_enabled"] = bool(payload["tg_announcements_enabled"])

    if "tg_event_disabled" in payload:
        raw = payload["tg_event_disabled"]
        if not isinstance(raw, list):
            raise HTTPException(status_code=400, detail="tg_event_disabled must be a list of event names")
        valid_names = set(EVENT_DEFAULTS.keys())
        cleaned_events: list[str] = []
        seen_e: set[str] = set()
        for name in raw:
            if not isinstance(name, str):
                raise HTTPException(status_code=400, detail="tg_event_disabled entries must be strings")
            n = name.strip()
            if not n or n in seen_e:
                continue
            if n not in valid_names:
                raise HTTPException(status_code=400, detail=f"Unknown TG event: {n}")
            seen_e.add(n)
            cleaned_events.append(n)
        update["tg_event_disabled"] = cleaned_events

    if "resolved_display_secs" in payload:
        try:
            n = int(payload["resolved_display_secs"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="resolved_display_secs must be an integer (seconds)")
        # 60s floor, 7d ceiling — anything shorter feels broken; anything longer
        # is effectively "forever" on a daily-cadence project.
        if n < 60 or n > 7 * 24 * 3600:
            raise HTTPException(status_code=400, detail="resolved_display_secs must be between 60 and 604800")
        update["resolved_display_secs"] = n

    if "tg_templates" in payload:
        raw = payload["tg_templates"]
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="tg_templates must be an object")
        valid_names = set(EVENT_DEFAULTS.keys())
        cleaned_tpls: dict[str, str] = {}
        for k, v in raw.items():
            if not isinstance(k, str) or k not in valid_names:
                raise HTTPException(status_code=400, detail=f"Unknown TG event template: {k}")
            if v is None or (isinstance(v, str) and not v.strip()):
                # treat empty/null as "revert to default" — drop the override.
                continue
            if not isinstance(v, str):
                raise HTTPException(status_code=400, detail=f"Template for {k} must be a string")
            if len(v) > 4096:
                raise HTTPException(status_code=400, detail=f"Template for {k} too long (Telegram limit ~4096 chars)")
            # Validate the template by rendering with mock placeholders so a
            # missing/typo'd {var} fails at PATCH time rather than send time.
            mock = {var: f"<{var}>" for var in EVENT_DEFAULTS[k]["vars"]}
            try:
                v.format(**mock)
            except (KeyError, IndexError) as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Template for {k} references unknown placeholder: {exc}",
                )
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"Template for {k} is invalid: {exc}")
            cleaned_tpls[k] = v
        update["tg_templates"] = cleaned_tpls

    if not update:
        raise HTTPException(status_code=400, detail="No valid fields to update")

    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    update["updated_by"] = admin

    await _get_col("runtime_config").update_one(
        {"_id": "singleton"},
        {"$set": update},
        upsert=True,
    )
    _invalidate_runtime_cfg_cache()

    cfg = await get_runtime_config(force_refresh=True)
    return {"current": cfg, "defaults": _runtime_defaults()}


@api_router.get("/admin/snapshots")
async def admin_list_snapshots(limit: int = 48, admin: str = Depends(get_admin_wallet)):
    if snapshot_store is None:
        raise HTTPException(status_code=503, detail="Snapshot store not initialized")
    limit = max(1, min(int(limit), 200))
    return await snapshot_store.list_recent(limit=limit)


@api_router.delete("/admin/snapshots/{snapshot_id}")
async def admin_delete_snapshot(snapshot_id: str, admin: str = Depends(get_admin_wallet)):
    if snapshot_store is None:
        raise HTTPException(status_code=503, detail="Snapshot store not initialized")
    ok = await snapshot_store.delete_snapshot(snapshot_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return {"deleted": True, "id": snapshot_id}


@api_router.post("/admin/snapshots/capture")
async def admin_capture_snapshot(admin: str = Depends(get_admin_wallet)):
    if snapshot_store is None:
        raise HTTPException(status_code=503, detail="Snapshot store not initialized")
    doc = await snapshot_store.capture()
    if doc is None:
        raise HTTPException(status_code=502, detail="Snapshot capture failed (see server logs)")
    return {
        "captured_at": doc["captured_at"].isoformat(),
        "total_holders": doc["total_holders"],
        "mint": doc.get("mint"),
    }


# ---------- Telegram bot admin controls ----------

@api_router.get("/admin/telegram/events")
async def admin_tg_events(admin: str = Depends(get_admin_wallet)):
    """List every announceable event (name, default template, placeholders).
    Used by the SystemAdmin page to render the toggle list and template editor."""
    return {"events": tg_list_events()}


class TelegramSendRequest(BaseModel):
    message: str
    parse_mode: Optional[str] = "Markdown"  # set to None / "" to send plain text


@api_router.post("/admin/telegram/send")
async def admin_tg_send(req: TelegramSendRequest, admin: str = Depends(get_admin_wallet)):
    """Admin-only: send a free-text message to the configured TG chat now.
    Bypasses the auto-announcement toggles — this is a manual broadcast.
    Returns the underlying send result so the UI can surface failures."""
    parse_mode = req.parse_mode if (req.parse_mode and req.parse_mode.strip()) else None
    if parse_mode and parse_mode not in ("Markdown", "MarkdownV2", "HTML"):
        raise HTTPException(status_code=400, detail="parse_mode must be Markdown, MarkdownV2, HTML, or empty")
    result = await tg_send_custom(req.message, parse_mode=parse_mode or "")
    if not result.get("ok"):
        raise HTTPException(
            status_code=502,
            detail=result.get("error") or "Telegram send failed (see server logs)",
        )
    return result


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
    cfg = await get_runtime_config()
    excl = frozenset(cfg.get("excluded_wallets") or [])
    holdings, recent_snaps = await asyncio.gather(
        fetch_wallet_balance(wallet),
        fetch_recent_snapshots(_get_col("holder_snapshots")),
    )
    status = compute_wallet_status(
        recent_snaps,
        wallet,
        min_tokens=cfg.get("min_qualifying_tokens"),
        excluded=excl,
    )

    # Recent-winner lockout (last spin's winner can't qualify next round).
    last_winner_doc = await _get_col("winners").find_one(
        {}, {"_id": 0}, sort=[("round_number", -1)]
    )
    is_recent_winner = bool(last_winner_doc and last_winner_doc.get("wallet") == wallet)

    is_qualified = status["is_qualified"] and not is_recent_winner and wallet not in excl
    next_in = None if is_qualified else max(1, REQUIRED_SNAPSHOTS - status["hours_held"])

    base_tickets = int(status["tickets"] if is_qualified else 0)
    streak_days = 0
    bonus_tickets = 0
    days_to_next = None
    next_bonus_amount = None

    if streak_store is not None:
        try:
            spin_doc = await _get_col("spin_state").find_one({"_id": "singleton"})
            current_round = int((spin_doc or {}).get("round_number") or 0)
            grace_days = int(cfg.get("streak_grace_days", 1))
            sd_doc = await streak_store.get_streak(wallet)
            if sd_doc:
                last_round = int(sd_doc.get("last_qualified_round") or 0)
                if last_round and (current_round == 0 or current_round - last_round <= 1 + grace_days):
                    streak_days = int(sd_doc.get("current_streak_days") or 0)
            bonus_tickets = bonus_for_streak(streak_days, cfg) if is_qualified else 0
            # Compute days until the next bonus tier kicks in.
            if cfg.get("streak_bonus_enabled", True):
                week = max(1, int(cfg.get("streak_week_threshold", 7)))
                month = max(1, int(cfg.get("streak_month_threshold", 30)))
                cap = max(0, int(cfg.get("max_bonus_tickets", 10)))
                if bonus_tickets < cap:
                    if streak_days < week:
                        days_to_next = week - streak_days
                        next_bonus_amount = 1
                    else:
                        # next +1 happens at the next multiple of `month` from 0
                        next_threshold = ((streak_days // month) + 1) * month
                        days_to_next = next_threshold - streak_days
                        next_bonus_amount = bonus_tickets + 1
        except Exception:
            logger.exception("wallet-check streak lookup failed")

    return WalletStatus(
        wallet=wallet,
        is_qualified=is_qualified,
        holdings_tokens=holdings,
        tickets=base_tickets + bonus_tickets,
        hours_held=status["hours_held"],
        snapshots=status["snapshots"],
        is_recent_winner=is_recent_winner,
        next_qualification_in_hours=next_in,
        base_tickets=base_tickets,
        bonus_tickets=bonus_tickets,
        streak_days=streak_days,
        days_to_next_bonus=days_to_next,
        next_bonus_amount=next_bonus_amount,
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
    # and the winner gets fixed_daily_prize_sol regardless of pot balance.
    cfg = await get_runtime_config()
    fixed_prize = cfg.get("fixed_daily_prize_sol")
    pot_threshold = float(cfg.get("pot_threshold_sol", POT_THRESHOLD_SOL))
    pot_check = await fetch_pot_balance()
    pot_check_sol = round(float(pot_check or 0), 4)
    prize_required = float(fixed_prize) if fixed_prize is not None else pot_threshold
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
    excl = frozenset(cfg.get("excluded_wallets") or [])
    if has_sufficient_history(recent_snaps):
        participants = compute_qualified_wallets(
            recent_snaps,
            min_tokens=cfg.get("min_qualifying_tokens"),
            excluded=excl,
        )
    else:
        participants = generate_mock_qualified_wallets(50)

    now = datetime.now(timezone.utc).isoformat()
    round_number = (doc.get("round_number", 0) + 1) if doc else 1

    # Long-term holder bonus: advance streaks for everyone qualified this round,
    # then decorate each participant with base/bonus/total tickets.
    if streak_store is not None and participants:
        try:
            wallets = [p["wallet"] for p in participants]
            streak_docs = await streak_store.update_streaks_for_round(
                wallets,
                round_number,
                grace_days=int(cfg.get("streak_grace_days", 1)),
            )
            for p in participants:
                streak_doc = streak_docs.get(p["wallet"])
                streak_days = int((streak_doc or {}).get("current_streak_days") or 0)
                bonus = bonus_for_streak(streak_days, cfg)
                p["base_tickets"] = int(p.get("tickets") or 0)
                p["streak_days"] = streak_days
                p["bonus_tickets"] = bonus
                p["tickets"] = p["base_tickets"] + bonus
        except Exception:
            logger.exception("streak update/decoration failed — continuing with base tickets only")
            for p in participants:
                p.setdefault("base_tickets", int(p.get("tickets") or 0))
                p.setdefault("streak_days", 0)
                p.setdefault("bonus_tickets", 0)

    # Atomically claim the spin slot. If another invocation flipped the
    # singleton to 'spinning' between our initial read at the top of this
    # function and now, we lose the race and abort — preventing duplicate
    # winners committed for the same round.
    claim = await _get_col("spin_state").update_one(
        {"_id": "singleton", "phase": {"$ne": "spinning"}},
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
    won_claim = (
        getattr(claim, "matched_count", 0) > 0
        or getattr(claim, "upserted_id", None) is not None
    )
    if not won_claim:
        logger.info("[spin] lost race to another concurrent trigger; aborting")
        raise HTTPException(status_code=409, detail="Spin already in progress")

    await broadcaster.broadcast({
        "event": "spin_started",
        "round": round_number,
        "participants_count": len(participants),
    })

    pot_sol_now = await fetch_pot_balance()
    announced_prize = (
        float(fixed_prize)
        if fixed_prize is not None
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
    cfg = await get_runtime_config()
    fixed_prize = cfg.get("fixed_daily_prize_sol")
    if fixed_prize is not None:
        amount_sol = float(fixed_prize)
    else:
        amount_sol = round(float(pot_sol or 0), 4)
    now = datetime.now(timezone.utc)

    winner_data = {
        "wallet": winner_entry["wallet"],
        "tickets": winner_entry["tickets"],
        "base_tickets": int(winner_entry.get("base_tickets") or winner_entry.get("tickets") or 0),
        "bonus_tickets": int(winner_entry.get("bonus_tickets") or 0),
        "streak_days": int(winner_entry.get("streak_days") or 0),
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
        "base_tickets": winner_data["base_tickets"],
        "bonus_tickets": winner_data["bonus_tickets"],
        "streak_days": winner_data["streak_days"],
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
    cfg = await get_runtime_config()
    excl = frozenset(cfg.get("excluded_wallets") or [])
    recent_snaps = await fetch_recent_snapshots(_get_col("holder_snapshots"))
    snapshots_captured = min(len(recent_snaps), REQUIRED_SNAPSHOTS)
    qualification_active = has_sufficient_history(recent_snaps)

    all_wallets = compute_qualified_wallets(
        recent_snaps,
        min_tokens=cfg.get("min_qualifying_tokens"),
        excluded=excl,
    ) if qualification_active else []

    if search:
        s = search.lower()
        all_wallets = [w for w in all_wallets if s in w["wallet"].lower()]

    # Look up the *current* round so we can tell live streaks from dead ones.
    spin_doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    current_round = int((spin_doc or {}).get("round_number") or 0)
    grace_days = int(cfg.get("streak_grace_days", 1))

    # Decorate the page wallets with their current streak + bonus tickets.
    streak_docs: dict = {}
    if streak_store is not None and all_wallets:
        try:
            streak_docs = await streak_store.bulk_get_streaks([w["wallet"] for w in all_wallets])
        except Exception:
            logger.exception("bulk_get_streaks failed in /qualified-wallets")
            streak_docs = {}
    for w in all_wallets:
        sd = streak_docs.get(w["wallet"]) or {}
        last_round = int(sd.get("last_qualified_round") or 0)
        # Treat the streak as alive only if the wallet was qualified within the last (1+grace) rounds.
        if last_round and (current_round == 0 or current_round - last_round <= 1 + grace_days):
            streak_days = int(sd.get("current_streak_days") or 0)
        else:
            streak_days = 0
        bonus = bonus_for_streak(streak_days, cfg)
        base = int(w.get("tickets") or 0)
        w["base_tickets"] = base
        w["streak_days"] = streak_days
        w["bonus_tickets"] = bonus
        w["tickets"] = base + bonus

    total = len(all_wallets)
    total_tickets = sum(w["tickets"] for w in all_wallets)
    # Re-sort so wallets with bonus tickets float up the leaderboard.
    all_wallets.sort(key=lambda w: (w["tickets"], w.get("min_balance", 0)), reverse=True)
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

class DevRollEntryPayload(BaseModel):
    # Either { wallet: "..." } for entry_type "wallet" rolls,
    # or { name: "...", image_data_url: "data:image/jpeg;base64,..." } for "custom" rolls.
    wallet: Optional[str] = None
    name: Optional[str] = None
    image_data_url: Optional[str] = None


class DevRollCreateRequest(BaseModel):
    title: Optional[str] = None  # e.g. "Community Giveaway #3" (max 60 chars)
    entry_type: str = "wallet"   # "wallet" | "custom"
    mode: str = "single"         # "single" | "elimination"
    elimination_interval_secs: Optional[int] = None
    entries: Optional[List[DevRollEntryPayload]] = None
    # Backward-compat: old clients still post { wallets: ["..."] }. We unify
    # this into `entries` server-side.
    wallets: Optional[List[str]] = None
    pot_sol: float
    scheduled_at: str            # ISO 8601 with timezone
    # Last Team Standing tournament: requires entry_type=custom + mode=elimination.
    # When True, public users can sign up to back a team.
    is_tournament: bool = False


class DevRollUpdateRequest(BaseModel):
    entries_to_add: Optional[List[DevRollEntryPayload]] = None
    # Legacy alias for wallet-only rolls.
    wallets_to_add: Optional[List[str]] = None
    title: Optional[str] = None
    pot_sol: Optional[float] = None
    scheduled_at: Optional[str] = None


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


def _resolve_entries_payload(
    req_entries: Optional[List[DevRollEntryPayload]],
    legacy_wallets: Optional[List[str]],
) -> List[dict]:
    """Unify the new `entries` shape with legacy `wallets: [str]` payloads."""
    if req_entries:
        return [e.model_dump(exclude_none=True) for e in req_entries]
    if legacy_wallets:
        return [{"wallet": w} for w in legacy_wallets]
    raise HTTPException(status_code=400, detail="entries (or wallets) is required")


@api_router.post("/dev/roll")
async def dev_roll_create(req: DevRollCreateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at)
    entries = _resolve_entries_payload(req.entries, req.wallets)
    return await create_dev_roll(
        _get_col("dev_rolls"),
        title=req.title,
        entry_type=req.entry_type,
        mode=req.mode,
        elimination_interval_secs=req.elimination_interval_secs,
        entries=entries,
        pot_sol=req.pot_sol,
        scheduled_at=sched,
        created_by=admin,
        is_tournament=req.is_tournament,
    )


@api_router.get("/dev/roll/current")
async def dev_roll_current():
    """Public — returns the active or recently-resolved dev roll, or null."""
    cfg = await get_runtime_config()
    return await fetch_current_dev_roll(
        _get_col("dev_rolls"),
        linger_secs=cfg.get("resolved_display_secs"),
    )


@api_router.get("/dev/roll/{roll_id}")
async def dev_roll_get(roll_id: str, admin: str = Depends(get_admin_wallet)):
    """Admin-only — full roll record including image data URLs."""
    doc = await fetch_dev_roll(_get_col("dev_rolls"), roll_id)
    if not doc:
        raise HTTPException(status_code=404, detail="roll not found")
    return doc


@api_router.patch("/dev/roll/{roll_id}")
async def dev_roll_update(roll_id: str, req: DevRollUpdateRequest, admin: str = Depends(get_admin_wallet)):
    sched = _parse_scheduled_at(req.scheduled_at) if req.scheduled_at else None
    entries_to_add: Optional[List[dict]] = None
    if req.entries_to_add:
        entries_to_add = [e.model_dump(exclude_none=True) for e in req.entries_to_add]
    elif req.wallets_to_add:
        entries_to_add = [{"wallet": w} for w in req.wallets_to_add]
    return await update_dev_roll(
        _get_col("dev_rolls"),
        roll_id,
        entries_to_add=entries_to_add,
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


# ---------- Last Team Standing tournament sign-ups (public) ----------

class TournamentSignupRequest(BaseModel):
    team_entry_id: str
    wallet: str
    x_handle: str


@api_router.post("/dev/roll/{roll_id}/support")
async def tournament_signup(roll_id: str, req: TournamentSignupRequest):
    """Public — back a team in a Last Team Standing tournament. One sign-up
    per wallet per roll. Sign-ups close once the wheel starts (phase != 'scheduled')."""
    if tournament_store is None:
        raise HTTPException(status_code=503, detail="tournament store not initialized")

    roll_doc = await fetch_dev_roll(_get_col("dev_rolls"), roll_id)
    if not roll_doc:
        raise HTTPException(status_code=404, detail="roll not found")
    if not roll_doc.get("is_tournament"):
        raise HTTPException(status_code=400, detail="this roll is not a tournament")
    if roll_doc.get("phase") != "scheduled":
        raise HTTPException(status_code=410, detail="sign-ups are closed for this tournament")

    wallet = (req.wallet or "").strip()
    if not _is_valid_solana_address(wallet):
        raise HTTPException(status_code=400, detail="invalid Solana wallet address")
    handle = _normalize_x_handle(req.x_handle)

    team_ids = {e.get("id") for e in (roll_doc.get("entries") or [])}
    if req.team_entry_id not in team_ids:
        raise HTTPException(status_code=400, detail="team_entry_id is not a team in this roll")

    await tournament_store.add_supporter(
        roll_id=roll_id,
        team_entry_id=req.team_entry_id,
        wallet=wallet,
        x_handle=handle,
    )
    counts = await tournament_store.supporters_by_team(roll_id)
    return {
        "team_entry_id": req.team_entry_id,
        "supporter_count": counts.get(req.team_entry_id, 0),
        "x_handle": handle,
    }


@api_router.get("/dev/roll/{roll_id}/supporters")
async def tournament_supporters(roll_id: str, wallet: Optional[str] = None):
    """Public — supporter counts per team + the caller's own sign-up record
    (resolved by ?wallet=... query). No auth — counts are public marketing.
    Wallets/x_handles are NOT included in the counts payload."""
    if tournament_store is None:
        raise HTTPException(status_code=503, detail="tournament store not initialized")
    roll_doc = await fetch_dev_roll(_get_col("dev_rolls"), roll_id)
    if not roll_doc:
        raise HTTPException(status_code=404, detail="roll not found")

    counts = await tournament_store.supporters_by_team(roll_id)
    teams = [
        {"team_entry_id": eid, "supporter_count": int(counts.get(eid, 0))}
        for eid in (e.get("id") for e in (roll_doc.get("entries") or []))
    ]
    my = None
    if wallet:
        w = wallet.strip()
        if _is_valid_solana_address(w):
            doc = await tournament_store.supporter_for_wallet(roll_id=roll_id, wallet=w)
            if doc:
                my = {
                    "team_entry_id": doc.get("team_entry_id"),
                    "x_handle": doc.get("x_handle"),
                    "eliminated": bool(doc.get("eliminated")),
                }
    return {"teams": teams, "my": my, "total": sum(t["supporter_count"] for t in teams)}


@api_router.delete("/dev/roll/{roll_id}/support/{wallet}")
async def tournament_remove_supporter(
    roll_id: str, wallet: str, admin: str = Depends(get_admin_wallet)
):
    if tournament_store is None:
        raise HTTPException(status_code=503, detail="tournament store not initialized")
    ok = await tournament_store.remove_supporter(roll_id=roll_id, wallet=wallet)
    if not ok:
        raise HTTPException(status_code=404, detail="supporter not found")
    return {"removed": True}


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
    cfg = await get_runtime_config()
    return await fetch_current_guest_roll(
        _get_col("guest_rolls"),
        linger_secs=cfg.get("resolved_display_secs"),
    )


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
