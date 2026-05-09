"""Sign-in-with-Solana (SIWS) auth for $ROLLAT.

Flow:
  1. Client GETs /api/auth/nonce?address=<pubkey>  -> {nonce, message, expires_at}
  2. User signs `message` with their wallet (Ed25519)
  3. Client POSTs /api/auth/verify {address, signature, nonce}
     - server verifies signature, marks nonce consumed, returns JWT
  4. JWT goes in Authorization: Bearer <token> on protected requests
  5. get_current_wallet() FastAPI dependency parses + verifies the JWT

Security choices:
  - Nonces are random 32-byte hex, stored in Mongo with TTL (5 min)
  - Nonces are single-use (deleted on successful verify)
  - Messages bind {domain, address, nonce, issued_at, expiration} -> replay-resistant across domains
  - JWT is short-lived (1 h) and binds to the wallet address (sub claim)
  - HS256 signing with secret from env; never log or return the secret
"""

from __future__ import annotations

import os
import secrets
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import base58
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
from pydantic import BaseModel, Field

# -- config ---------------------------------------------------------------

JWT_SECRET = os.environ.get("JWT_SECRET")  # must be set in production
JWT_ALG = "HS256"
JWT_TTL_SECONDS = 3600                     # 1 hour
NONCE_TTL_SECONDS = 300                    # 5 min
APP_DOMAIN = os.environ.get("APP_DOMAIN", "rollat.vercel.app")
APP_URI = os.environ.get("APP_URI", "https://rollat.vercel.app")

# Comma-separated list of wallet addresses allowed to use admin-only endpoints
# (e.g. the Dev Roll feature). Empty by default — feature is locked until set.
ADMIN_WALLETS = {
    w.strip() for w in os.environ.get("ADMIN_WALLETS", "").split(",") if w.strip()
}


def is_admin_wallet(addr: str) -> bool:
    return bool(addr) and addr in ADMIN_WALLETS

# -- pydantic schemas -----------------------------------------------------

class NonceResponse(BaseModel):
    address: str
    nonce: str
    message: str
    expires_at: str  # ISO

class VerifyRequest(BaseModel):
    address: str = Field(..., min_length=32, max_length=44)
    signature: str = Field(..., min_length=64, max_length=128)  # base58 sig
    nonce: str = Field(..., min_length=32, max_length=128)

class VerifyResponse(BaseModel):
    token: str
    address: str
    expires_at: str
    is_admin: bool = False

class MeResponse(BaseModel):
    address: str
    expires_at: str
    is_admin: bool = False

# -- helpers --------------------------------------------------------------

def _require_secret() -> str:
    if not JWT_SECRET or len(JWT_SECRET) < 32:
        raise HTTPException(
            status_code=500,
            detail="Server auth not configured (JWT_SECRET missing/too short)",
        )
    return JWT_SECRET


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


def build_siws_message(address: str, nonce: str, issued_at: datetime, expires_at: datetime) -> str:
    """Builds an EIP-4361-inspired SIWS message. Both sides MUST agree on the exact format."""
    return (
        f"{APP_DOMAIN} wants you to sign in with your Solana account:\n"
        f"{address}\n\n"
        f"Sign in to verify wallet ownership for $ROLLAT. This will not trigger any transaction.\n\n"
        f"URI: {APP_URI}\n"
        f"Version: 1\n"
        f"Chain: solana:mainnet\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {issued_at.replace(microsecond=0).isoformat()}\n"
        f"Expiration Time: {expires_at.replace(microsecond=0).isoformat()}"
    )


# -- nonce store (mongo collection w/ TTL) --------------------------------

class NonceStore:
    """Persists nonces in a mongo collection (with TTL index) so they survive restarts.

    Collection: auth_nonces
    Doc shape: { address, nonce, message, issued_at, expires_at }
    """

    def __init__(self, collection):
        self.coll = collection

    async def ensure_indexes(self):
        try:
            # TTL index: auto-delete docs after expires_at
            await self.coll.create_index("expires_at", expireAfterSeconds=0)
            await self.coll.create_index([("address", 1), ("nonce", 1)], unique=True)
        except Exception:
            # in-memory fallback collections may not support indexes; safe to ignore
            pass

    async def issue(self, address: str) -> NonceResponse:
        if not _is_valid_solana_address(address):
            raise HTTPException(status_code=400, detail="invalid address")

        nonce = secrets.token_hex(32)
        now = datetime.now(timezone.utc)
        exp = now + timedelta(seconds=NONCE_TTL_SECONDS)
        message = build_siws_message(address, nonce, now, exp)

        await self.coll.insert_one({
            "address": address,
            "nonce": nonce,
            "message": message,
            "issued_at": now,
            "expires_at": exp,
        })
        return NonceResponse(
            address=address,
            nonce=nonce,
            message=message,
            expires_at=exp.isoformat(),
        )

    async def consume(self, address: str, nonce: str) -> Optional[dict]:
        """Atomically delete + return the nonce doc if valid; None if missing/expired.

        Uses Mongo's findAndModify (find_one_and_delete) so two concurrent
        verify requests can't both pull the same nonce — at most one wins
        the document, the other gets None and fails verification."""
        try:
            doc = await self.coll.find_one_and_delete({"address": address, "nonce": nonce})
        except Exception:
            # In-memory fallbacks may not support find_one_and_delete; degrade
            # gracefully but still avoid the obvious double-read window.
            doc = await self.coll.find_one({"address": address, "nonce": nonce})
            if doc:
                await self.coll.delete_one({"_id": doc.get("_id")})
        if not doc:
            return None
        # Verify not expired (TTL sweeper runs ~once/min so we re-check here).
        exp = doc.get("expires_at")
        if isinstance(exp, datetime):
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp < datetime.now(timezone.utc):
                return None
        return doc


# -- signature verification -----------------------------------------------

def verify_solana_signature(address: str, message: str, signature_b58: str) -> bool:
    """Returns True iff `signature_b58` is a valid Ed25519 sig over UTF-8 `message` for `address`."""
    if not _is_valid_solana_address(address):
        return False
    try:
        pubkey_bytes = base58.b58decode(address)
        sig_bytes = base58.b58decode(signature_b58)
        if len(pubkey_bytes) != 32 or len(sig_bytes) != 64:
            return False
        VerifyKey(pubkey_bytes).verify(message.encode("utf-8"), sig_bytes)
        return True
    except (BadSignatureError, ValueError, Exception):
        return False


# -- jwt ------------------------------------------------------------------

def issue_jwt(address: str) -> tuple[str, datetime]:
    secret = _require_secret()
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=JWT_TTL_SECONDS)
    payload = {
        "sub": address,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": secrets.token_hex(16),
    }
    token = jwt.encode(payload, secret, algorithm=JWT_ALG)
    return token, exp


# In-memory revoked-JWT store. {jti -> exp_unix}. Trimmed lazily on each check;
# entries naturally expire alongside the token TTL (1h), so the set stays bounded.
_REVOKED_JTI: dict[str, int] = {}


def revoke_jti(jti: str, exp_unix: int) -> None:
    """Mark a JWT id as revoked until its natural expiration."""
    if jti:
        _REVOKED_JTI[jti] = exp_unix


def _gc_revoked(now_unix: int) -> None:
    if not _REVOKED_JTI:
        return
    expired = [k for k, exp in _REVOKED_JTI.items() if exp <= now_unix]
    for k in expired:
        _REVOKED_JTI.pop(k, None)


def verify_jwt(token: str) -> dict:
    secret = _require_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid token")
    now_unix = int(time.time())
    _gc_revoked(now_unix)
    jti = payload.get("jti")
    if jti and jti in _REVOKED_JTI:
        raise HTTPException(status_code=401, detail="token revoked")
    return payload


# -- FastAPI dependency for protected routes -------------------------------

bearer_scheme = HTTPBearer(auto_error=False)

async def get_current_wallet(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    """Returns the authenticated wallet address. Raises 401 if missing/invalid token."""
    if creds is None or not creds.credentials:
        raise HTTPException(status_code=401, detail="missing bearer token")
    payload = verify_jwt(creds.credentials)
    addr = payload.get("sub")
    if not addr or not _is_valid_solana_address(addr):
        raise HTTPException(status_code=401, detail="malformed token subject")
    return addr


async def get_admin_wallet(addr: str = Depends(get_current_wallet)) -> str:
    """Like get_current_wallet but additionally requires the wallet be in the
    ADMIN_WALLETS allowlist. Raises 403 otherwise."""
    if not is_admin_wallet(addr):
        raise HTTPException(status_code=403, detail="Admin only")
    return addr
