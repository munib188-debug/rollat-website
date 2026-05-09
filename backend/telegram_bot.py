"""Telegram announcement bot for $ROLLAT.

Sends notifications to a Telegram channel/group on key spin events:
  - Dev Roll scheduled / spinning / winner / reminder
  - Daily 24h spin started / winner / reminder / rollover
  - Guest Roll scheduled / spinning / winner
  - Buy CTA after winner reveals

Configure via env vars (set in Render dashboard):
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — channel username (@rollat_announcements) or numeric ID

If either var is missing, all functions silently no-op so the main spin
flow is never blocked by a missing Telegram config.

## Runtime control (admin)

The /admin/system page lets the admin:
  - master-disable all auto-announcements (`tg_announcements_enabled`)
  - selectively disable individual events (`tg_event_disabled`)
  - override the message template per event (`tg_templates`)
  - send a custom one-off message via `send_custom`

Templates are Python `str.format`-style with named placeholders. Each
event documents its variables in `EVENT_DEFAULTS` below.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Awaitable, Callable, Optional

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID: str = os.environ.get("TELEGRAM_CHAT_ID", "")

SITE = "rollat.vercel.app"


def _configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


# ---------------------------------------------------------------------------
# Runtime config injection
#
# server.py wires `set_runtime_config_getter(get_runtime_config)` at startup
# so this module can read the live admin toggles/templates without importing
# server.py back (which would create a cycle).
# ---------------------------------------------------------------------------

_runtime_config_getter: Optional[Callable[[], Awaitable[dict]]] = None


def set_runtime_config_getter(fn: Callable[[], Awaitable[dict]]) -> None:
    """Inject the runtime-config accessor. Call once at server startup."""
    global _runtime_config_getter
    _runtime_config_getter = fn


async def _runtime_config() -> dict:
    if _runtime_config_getter is None:
        return {}
    try:
        cfg = await _runtime_config_getter()
        return cfg if isinstance(cfg, dict) else {}
    except Exception:
        logger.exception("[telegram] failed to fetch runtime config")
        return {}


# ---------------------------------------------------------------------------
# Event registry
#
# Each event has a default template (Markdown) and a documented placeholder
# set. Admin can override templates via runtime_config["tg_templates"] keyed
# by event name. If a custom template is malformed (missing placeholder),
# we fall back to the default and log.
# ---------------------------------------------------------------------------

EVENT_DEFAULTS: dict[str, dict[str, Any]] = {
    "dev_roll_scheduled": {
        "label": "Dev Roll Scheduled",
        "vars": ["label", "pot_sol", "wallet_count", "time_str", "site"],
        "template": (
            "🎁 *{label} — Scheduled*\n"
            "💰 Pot: `{pot_sol} SOL`\n"
            "👥 {wallet_count} wallets in the pool\n"
            "⏰ Spins at: `{time_str}`\n\n"
            "Watch live → {site}/#dev-roll"
        ),
    },
    "dev_roll_spinning": {
        "label": "Dev Roll Spinning",
        "vars": ["label", "pot_sol", "wallet_count", "site"],
        "template": (
            "🎰 *{label} — Spinning Now\\!*\n"
            "💰 `{pot_sol} SOL` · {wallet_count} wallets competing\n\n"
            "{site}/#dev-roll"
        ),
    },
    "dev_roll_winner": {
        "label": "Dev Roll Winner (wallet)",
        "vars": ["label", "winner_wallet", "pot_sol", "explorer_url", "site"],
        "template": (
            "🏆 *{label} — Winner\\!*\n"
            "🎯 `{winner_wallet}`\n"
            "💰 `{pot_sol} SOL`\n"
            "[View on Solscan]({explorer_url})\n\n"
            "{site}"
        ),
    },
    "dev_roll_winner_custom": {
        "label": "Dev Roll Winner (name+photo)",
        "vars": ["label", "winner_wallet", "pot_sol", "site"],
        "template": (
            "🏆 *{label} — Winner\\!*\n"
            "🎯 `{winner_wallet}`\n"
            "💰 `{pot_sol} SOL`\n\n"
            "{site}/#dev-roll"
        ),
    },
    "dev_roll_reminder": {
        "label": "Dev Roll 10-min reminder",
        "vars": ["label", "minutes_left", "pot_sol", "wallet_count", "site"],
        "template": (
            "⏰ *{label} — {minutes_left} minutes to go\\!*\n"
            "💰 Pot: `{pot_sol} SOL` · {wallet_count} wallets\n\n"
            "Watch live → {site}/#dev-roll"
        ),
    },
    "daily_spin_reminder": {
        "label": "Daily Spin 10-min reminder",
        "vars": ["pot_sol", "time_str", "site"],
        "template": (
            "⏰ *Daily Spin — 10 minutes to go\\!*\n"
            "💰 Current pot: `{pot_sol} SOL`\n"
            "🕐 Spins at: `{time_str}`\n\n"
            "Watch live → {site}/#roulette-arena"
        ),
    },
    "rollover": {
        "label": "Pot rollover",
        "vars": ["pot_sol", "threshold_sol", "rollover_count", "site"],
        "template": (
            "🔄 *Pot Rolled Over — Round Skipped*\n"
            "💰 Current pot: `{pot_sol} SOL` \\(threshold: `{threshold_sol} SOL`\\)\n"
            "📈 Pot carries forward to the next round\n"
            "🔢 Rollover streak: {rollover_count}\n\n"
            "{site}"
        ),
    },
    "daily_spin_started": {
        "label": "Daily Spin started",
        "vars": ["round_number", "participants_count", "pot_sol", "site"],
        "template": (
            "🎰 *Daily Spin — Round \\#{round_number}*\n"
            "💰 Pot: `{pot_sol} SOL`\n"
            "👥 {participants_count} wallets competing\n\n"
            "Watch live → {site}/#roulette-arena"
        ),
    },
    "daily_spin_winner": {
        "label": "Daily Spin winner",
        "vars": ["round_number", "winner_wallet", "amount_sol", "participants_count", "explorer_url", "site"],
        "template": (
            "🏆 *Round \\#{round_number} — Winner\\!*\n"
            "🎯 `{winner_wallet}`\n"
            "💰 `{amount_sol} SOL` · odds 1/{participants_count}\n"
            "[View on Solscan]({explorer_url})\n\n"
            "{site}"
        ),
    },
    "guest_roll_scheduled": {
        "label": "Guest Roll scheduled",
        "vars": ["label", "prize_label", "entry_count", "time_str", "site"],
        "template": (
            "🎟️ *{label} — Scheduled*\n"
            "🏆 Prize: `{prize_label}`\n"
            "🪙 {entry_count} coins competing\n"
            "⏰ Spins at: `{time_str}`\n\n"
            "Watch live → {site}/#guest-roll"
        ),
    },
    "guest_roll_spinning": {
        "label": "Guest Roll spinning",
        "vars": ["label", "prize_label", "entry_count", "site"],
        "template": (
            "🎡 *{label} — Spinning Now\\!*\n"
            "🏆 `{prize_label}` · {entry_count} coins\n\n"
            "{site}/#guest-roll"
        ),
    },
    "guest_roll_winner": {
        "label": "Guest Roll winner",
        "vars": ["label", "winner_ticker", "winner_name", "prize_label", "link_line", "site"],
        "template": (
            "🏆 *{label} — Winner\\!*\n"
            "🥇 `${winner_ticker}` · {winner_name}\n"
            "🎁 Prize: `{prize_label}`\n"
            "{link_line}\n"
            "{site}"
        ),
    },
    "buy_cta": {
        "label": "Buy CTA (post-winner)",
        "vars": ["site"],
        "template": (
            "💎 *Want to be next?*\n\n"
            "Hold `1M+ $ROLLAT` for 24h and your wallet enters the next spin\\.\n"
            "Every round, one holder takes the entire SOL pot\\.\n\n"
            "🪙 Buy \\$ROLLAT on pump\\.fun:\n"
            "pump\\.fun/coin/6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump\n\n"
            "CA: `6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump`\n"
            "📊 {site} · 🐦 @Rollat\\_online"
        ),
    },
}


def list_events() -> list[dict]:
    """Return event metadata for the admin UI."""
    return [
        {
            "name": name,
            "label": meta["label"],
            "default_template": meta["template"],
            "vars": meta["vars"],
        }
        for name, meta in EVENT_DEFAULTS.items()
    ]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _is_enabled(event_name: str) -> bool:
    cfg = await _runtime_config()
    if not cfg.get("tg_announcements_enabled", True):
        return False
    disabled = cfg.get("tg_event_disabled") or []
    return event_name not in disabled


async def _render(event_name: str, **kwargs: Any) -> Optional[str]:
    """Pick the template (custom or default) and format with kwargs.
    Returns None if the event is unknown."""
    meta = EVENT_DEFAULTS.get(event_name)
    if not meta:
        logger.warning(f"[telegram] unknown event '{event_name}'")
        return None

    cfg = await _runtime_config()
    custom_templates = cfg.get("tg_templates") or {}
    template = custom_templates.get(event_name) or meta["template"]

    try:
        return template.format(**kwargs)
    except (KeyError, IndexError) as exc:
        logger.warning(
            f"[telegram] custom template for '{event_name}' missing placeholder ({exc}); "
            f"falling back to default"
        )
        try:
            return meta["template"].format(**kwargs)
        except Exception:
            logger.exception(f"[telegram] default template for '{event_name}' failed too")
            return None
    except Exception:
        logger.exception(f"[telegram] template render failed for '{event_name}'")
        return None


async def _send(text: str, parse_mode: str = "Markdown") -> dict:
    """POST a Markdown message to the configured chat. Returns a result dict
    `{ok: bool, status_code: int|None, error: str|None}` so admin endpoints
    can surface failures."""
    if not _configured():
        return {"ok": False, "status_code": None, "error": "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set"}
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "disable_web_page_preview": True,
            }
            if parse_mode:
                payload["parse_mode"] = parse_mode
            resp = await client.post(url, json=payload)
            if resp.status_code != 200:
                logger.warning(f"[telegram] non-200: {resp.status_code} {resp.text[:200]}")
                return {"ok": False, "status_code": resp.status_code, "error": resp.text[:300]}
            return {"ok": True, "status_code": 200, "error": None}
    except Exception as exc:
        logger.exception("[telegram] send failed")
        return {"ok": False, "status_code": None, "error": str(exc)}


async def _emit(event_name: str, **kwargs: Any) -> None:
    """Internal: respect toggle, render, send. Fire-and-forget safe."""
    if not await _is_enabled(event_name):
        return
    text = await _render(event_name, **kwargs)
    if text is None:
        return
    await _send(text)


# ---------------------------------------------------------------------------
# Public API — admin custom-message sender
# ---------------------------------------------------------------------------

async def send_custom(message: str, parse_mode: str = "Markdown") -> dict:
    """Admin-triggered free-text send. Returns the underlying _send result so
    the endpoint can surface failures (Telegram parse errors, network, etc.)."""
    if not message or not message.strip():
        return {"ok": False, "status_code": None, "error": "empty message"}
    return await _send(message, parse_mode=parse_mode)


# ---------------------------------------------------------------------------
# Event-specific announce_* wrappers
#
# Each function builds the kwargs and delegates to `_emit`. The signatures
# stay identical to the old hardcoded versions so call sites don't change.
# ---------------------------------------------------------------------------

# ── Dev Roll ────────────────────────────────────────────────────────────────

async def announce_dev_roll_scheduled(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
    scheduled_at_iso: str,
) -> None:
    label = title or "Dev Roll"
    time_str = scheduled_at_iso[:16].replace("T", " ") + " UTC" if scheduled_at_iso else "TBA"
    await _emit(
        "dev_roll_scheduled",
        label=label, pot_sol=pot_sol, wallet_count=wallet_count,
        time_str=time_str, site=SITE,
    )


async def announce_dev_roll_spinning(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
) -> None:
    label = title or "Dev Roll"
    await _emit(
        "dev_roll_spinning",
        label=label, pot_sol=pot_sol, wallet_count=wallet_count, site=SITE,
    )


async def announce_dev_roll_winner(
    title: str | None,
    winner_wallet: str,
    pot_sol: float,
    *,
    is_wallet: bool = True,
) -> None:
    """Wallet rolls get a Solscan link; custom (name+photo) rolls don't."""
    label = title or "Dev Roll"
    if is_wallet:
        await _emit(
            "dev_roll_winner",
            label=label, winner_wallet=winner_wallet, pot_sol=pot_sol,
            explorer_url=f"https://solscan.io/account/{winner_wallet}", site=SITE,
        )
    else:
        await _emit(
            "dev_roll_winner_custom",
            label=label, winner_wallet=winner_wallet, pot_sol=pot_sol, site=SITE,
        )


async def announce_dev_roll_reminder(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
    minutes_left: int = 10,
) -> None:
    label = title or "Dev Roll"
    await _emit(
        "dev_roll_reminder",
        label=label, minutes_left=minutes_left, pot_sol=pot_sol,
        wallet_count=wallet_count, site=SITE,
    )


# ── Daily Spin ──────────────────────────────────────────────────────────────

async def announce_daily_spin_reminder(
    pot_sol: float,
    next_spin_at_iso: str,
) -> None:
    time_str = next_spin_at_iso[:16].replace("T", " ") + " UTC" if next_spin_at_iso else "00:00 UTC"
    await _emit("daily_spin_reminder", pot_sol=pot_sol, time_str=time_str, site=SITE)


async def announce_rollover(
    pot_sol: float,
    threshold_sol: float,
    rollover_count: int,
) -> None:
    await _emit(
        "rollover",
        pot_sol=pot_sol, threshold_sol=threshold_sol,
        rollover_count=rollover_count, site=SITE,
    )


async def announce_daily_spin_started(
    round_number: int,
    participants_count: int,
    pot_sol: float,
) -> None:
    await _emit(
        "daily_spin_started",
        round_number=round_number, participants_count=participants_count,
        pot_sol=pot_sol, site=SITE,
    )


async def announce_daily_spin_winner(
    round_number: int,
    winner_wallet: str,
    amount_sol: float,
    participants_count: int,
) -> None:
    await _emit(
        "daily_spin_winner",
        round_number=round_number, winner_wallet=winner_wallet,
        amount_sol=amount_sol, participants_count=participants_count,
        explorer_url=f"https://solscan.io/account/{winner_wallet}", site=SITE,
    )


# ── Guest Roll ──────────────────────────────────────────────────────────────

async def announce_guest_roll_scheduled(
    title: str | None,
    prize_label: str,
    entry_count: int,
    scheduled_at_iso: str,
) -> None:
    label = title or "Guest Roll"
    time_str = scheduled_at_iso[:16].replace("T", " ") + " UTC" if scheduled_at_iso else "TBA"
    await _emit(
        "guest_roll_scheduled",
        label=label, prize_label=prize_label, entry_count=entry_count,
        time_str=time_str, site=SITE,
    )


async def announce_guest_roll_spinning(
    title: str | None,
    prize_label: str,
    entry_count: int,
) -> None:
    label = title or "Guest Roll"
    await _emit(
        "guest_roll_spinning",
        label=label, prize_label=prize_label, entry_count=entry_count, site=SITE,
    )


async def announce_guest_roll_winner(
    title: str | None,
    prize_label: str,
    winner_name: str,
    winner_ticker: str,
    winner_link: str | None,
) -> None:
    label = title or "Guest Roll"
    link_line = f"[Community]({winner_link})\n" if winner_link else ""
    await _emit(
        "guest_roll_winner",
        label=label, prize_label=prize_label, winner_name=winner_name,
        winner_ticker=winner_ticker, link_line=link_line, site=SITE,
    )


# ── Buy CTA ─────────────────────────────────────────────────────────────────

async def announce_buy_cta() -> None:
    """Sent after every winner reveal to drive buys."""
    await _emit("buy_cta", site=SITE)
