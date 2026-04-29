from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import hashlib
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


# ---------- WebSocket broadcaster ----------
class SpinBroadcaster:
    def __init__(self):
        self.connections: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.add(ws)

    def disconnect(self, ws: WebSocket):
        self.connections.discard(ws)

    async def broadcast(self, data: dict):
        dead = set()
        for ws in list(self.connections):
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self.connections -= dead


broadcaster = SpinBroadcaster()


def tickets_for_holdings(tokens: float) -> int:
    """100k qualifies. ≤500k→1, 1M→2, 1.5M→3, 2M→4, 2.5M→5, 3M+→6 (cap)."""
    if tokens < 100_000:
        return 0
    if tokens < 1_000_000:
        return 1
    if tokens < 1_500_000:
        return 2
    if tokens < 2_000_000:
        return 3
    if tokens < 2_500_000:
        return 4
    if tokens < 3_000_000:
        return 5
    return 6


def select_weighted_winner(participants: List[dict]) -> dict:
    pool = [p for p in participants for _ in range(p["tickets"])]
    return random.choice(pool) if pool else participants[0]


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
        holdings = round(rng.uniform(100_000, 3_400_000), 0)
        tickets = tickets_for_holdings(holdings)
        if tickets == 0:
            tickets = 1
            holdings = 150_000
        wallets.append({
            "wallet": wallet,
            "tickets": tickets,
            "holdings_tokens": holdings,
        })
    # Sort by tickets descending
    wallets.sort(key=lambda w: w["tickets"], reverse=True)
    return wallets


nonce_store: Optional[NonceStore] = None


@api_router.on_event("startup")
async def on_startup():
    global USE_MONGO, nonce_store
    try:
        await db.command("ping")
        USE_MONGO = True
        logger.info("MongoDB connected")
    except Exception:
        USE_MONGO = False
        logger.info("MongoDB unavailable — using in-memory store")

    nonce_store = NonceStore(_get_col("auth_nonces"))
    await nonce_store.ensure_indexes()

    winners_col = _get_col("winners")
    spin_col = _get_col("spin_state")

    # Seed winners
    await winners_col.delete_many({})
    seed = []
    now = datetime.now(timezone.utc)
    for i in range(24):
        round_num = 24 - i
        amount_sol = round(random.uniform(8, 64), 2)
        seed.append({
            "id": str(uuid.uuid4()),
            "round_number": round_num,
            "wallet": random.choice(MOCK_WALLETS),
            "amount_sol": amount_sol,
            "tickets": random.choice([1, 2, 3, 4, 5, 6]),
            "participants_count": random.randint(200, 450),
            "won_at": (now - timedelta(hours=24 * i + random.randint(0, 6))).isoformat(),
        })
    if seed:
        await winners_col.insert_many(seed)

    # Initialize spin_state if missing
    existing = await spin_col.find_one({"_id": "singleton"})
    if not existing:
        await spin_col.insert_one({
            "_id": "singleton",
            "phase": "idle",
            "round_number": 25,
            "winner": None,
            "participants": [],
            "participants_count": 0,
            "spin_requested_at": None,
            "resolved_at": None,
        })


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"message": "$ROLLAT API live", "status": "spinning"}


# ---------- Sign-in-with-Solana ----------
@api_router.get("/auth/nonce", response_model=NonceResponse)
async def auth_nonce(address: str):
    """Issue a one-time nonce + SIWS message for the given wallet address."""
    if nonce_store is None:
        raise HTTPException(status_code=503, detail="auth not initialized")
    return await nonce_store.issue(address)


@api_router.post("/auth/verify", response_model=VerifyResponse)
async def auth_verify(req: VerifyRequest):
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
    return VerifyResponse(token=token, address=req.address, expires_at=exp.isoformat())


@api_router.get("/auth/me", response_model=MeResponse)
async def auth_me(address: str = Depends(get_current_wallet)):
    """Returns the wallet bound to the current JWT. Useful for client to verify a token is still valid."""
    # exp isn't stored separately; client can decode jti/exp itself, but echoing the address proves authenticity
    return MeResponse(address=address, expires_at="")


@api_router.get("/stats", response_model=Stats)
async def get_stats():
    now = datetime.now(timezone.utc)
    next_spin = (now + timedelta(hours=6)).replace(minute=0, second=0, microsecond=0)
    winners = await _get_col("winners").find({}, {"_id": 0}).to_list(1000)
    total_distributed = sum(w.get("amount_sol", 0) for w in winners)
    biggest = max((w.get("amount_sol", 0) for w in winners), default=0)
    spins = len(winners)

    # Get spin state
    spin_doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    spin_phase = spin_doc.get("phase", "idle") if spin_doc else "idle"
    last_winner = spin_doc.get("winner") if spin_doc else None

    return Stats(
        current_pot_sol=round(46.5 + random.uniform(-1.5, 6.5), 2),
        next_spin_at=next_spin.isoformat(),
        total_qualified_wallets=347,
        total_distributed_sol=round(total_distributed, 2),
        biggest_win_sol=round(biggest, 2),
        spins_completed=spins,
        rollover_active=False,
        rollover_count=0,
        pot_threshold_sol=5.0,
        token_price_usd=0.00042,
        market_cap_usd=4_200_000.0,
        holders=2_847,
        spin_phase=spin_phase,
        last_winner=last_winner,
    )


@api_router.get("/winners", response_model=List[Winner])
async def get_winners(limit: int = 20):
    winners = await _get_col("winners").find({}, {"_id": 0}).sort("round_number", -1).to_list(limit)
    for w in winners:
        if isinstance(w.get("won_at"), str):
            w["won_at"] = datetime.fromisoformat(w["won_at"])
    return winners


@api_router.get("/wallet-check/{wallet}", response_model=WalletStatus)
async def wallet_check(wallet: str):
    if not wallet or len(wallet) < 4:
        raise HTTPException(status_code=400, detail="Invalid wallet")
    h = hashlib.sha256(wallet.encode()).hexdigest()
    seed = int(h[:8], 16)
    rng = random.Random(seed)

    holdings = round(rng.uniform(40_000, 3_400_000), 0)
    hours = rng.randint(8, 24)
    is_qualified = holdings >= 100_000 and hours == 24
    tickets = tickets_for_holdings(holdings) if is_qualified else 0
    snapshots = [True if i < hours else False for i in range(24)]
    is_recent_winner = (seed % 17) == 0
    return WalletStatus(
        wallet=wallet,
        is_qualified=is_qualified and not is_recent_winner,
        holdings_tokens=holdings,
        tickets=tickets,
        hours_held=hours,
        snapshots=snapshots,
        is_recent_winner=is_recent_winner,
        next_qualification_in_hours=None if is_qualified else max(1, 24 - hours),
    )


@api_router.get("/dashboard/{wallet}")
async def dashboard(wallet: str):
    status = await wallet_check(wallet)
    history = await _get_col("winners").find(
        {"wallet": wallet}, {"_id": 0}
    ).sort("round_number", -1).to_list(20)
    for h in history:
        if isinstance(h.get("won_at"), str):
            h["won_at"] = datetime.fromisoformat(h["won_at"])
    rng = random.Random(hashlib.sha256(wallet.encode()).hexdigest()[:8])
    participation = []
    for r in range(5):
        participation.append({
            "round_number": 100 - r,
            "qualified": rng.random() > 0.3,
            "tickets": rng.choice([1, 2, 3, 4, 5, 6]),
            "won": rng.random() > 0.92,
        })
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


@api_router.post("/spin/trigger")
async def trigger_spin():
    doc = await _get_col("spin_state").find_one({"_id": "singleton"})
    if doc and doc.get("phase") == "spinning":
        raise HTTPException(status_code=409, detail="Spin already in progress")

    participants = generate_mock_qualified_wallets(347)
    now = datetime.now(timezone.utc).isoformat()
    round_number = (doc.get("round_number", 24) + 1) if doc else 25

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

    # Resolve after animation time (10s)
    asyncio.create_task(_resolve_after_delay(participants, round_number, 10))
    return {"status": "spinning", "round": round_number, "participants": len(participants)}


async def _resolve_after_delay(participants: List[dict], round_number: int, delay: int):
    await asyncio.sleep(delay)
    winner_entry = select_weighted_winner(participants)
    amount_sol = round(random.uniform(8, 64), 2)
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
    all_wallets = generate_mock_qualified_wallets(347)

    if search:
        all_wallets = [w for w in all_wallets if search.lower() in w["wallet"].lower()]

    total = len(all_wallets)
    total_tickets = sum(w["tickets"] for w in all_wallets)
    start = (page - 1) * per_page
    end = start + per_page
    page_wallets = all_wallets[start:end]

    # Add win probability
    for w in page_wallets:
        w["win_probability"] = round((w["tickets"] / total_tickets * 100), 2) if total_tickets > 0 else 0

    return QualifiedWalletsResponse(
        wallets=page_wallets,
        total=total,
        total_tickets=total_tickets,
        page=page,
        per_page=per_page,
    )


# ---------- WebSocket ----------
@app.websocket("/ws/spin")
async def websocket_spin(websocket: WebSocket):
    await broadcaster.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep alive, ignore incoming
    except WebSocketDisconnect:
        broadcaster.disconnect(websocket)


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
