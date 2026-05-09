"""Telegram announcement bot for $ROLLAT.

Sends notifications to a Telegram channel/group on key spin events:
  - Dev Roll scheduled / spinning / winner
  - Daily 24h spin started / winner

Configure via env vars (set in Render dashboard):
  TELEGRAM_BOT_TOKEN  — from @BotFather
  TELEGRAM_CHAT_ID    — channel username (@rollat_announcements) or numeric ID

If either var is missing, all functions silently no-op so the main spin
flow is never blocked by a missing Telegram config.
"""

from __future__ import annotations

import logging
import os

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_BOT_TOKEN: str = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID: str = os.environ.get("TELEGRAM_CHAT_ID", "")

SITE = "rollat.vercel.app"


def _configured() -> bool:
    return bool(TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)


async def _send(text: str) -> None:
    """POST a Markdown message to the configured chat. Fire-and-forget safe."""
    if not _configured():
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json={
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            })
            if resp.status_code != 200:
                logger.warning(f"[telegram] non-200 response: {resp.status_code} {resp.text[:200]}")
    except Exception:
        logger.exception("[telegram] send failed")


# ── Dev Roll announcements ──────────────────────────────────────────────────

async def announce_dev_roll_scheduled(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
    scheduled_at_iso: str,
) -> None:
    label = title or "Dev Roll"
    # "2026-05-02T18:30:00+00:00" -> "2026-05-02 18:30 UTC"
    time_str = scheduled_at_iso[:16].replace("T", " ") + " UTC" if scheduled_at_iso else "TBA"
    await _send(
        f"🎁 *{label} — Scheduled*\n"
        f"💰 Pot: `{pot_sol} SOL`\n"
        f"👥 {wallet_count} wallet{'s' if wallet_count != 1 else ''} in the pool\n"
        f"⏰ Spins at: `{time_str}`\n\n"
        f"Watch live → {SITE}/#dev-roll"
    )


async def announce_dev_roll_spinning(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
) -> None:
    label = title or "Dev Roll"
    await _send(
        f"🎰 *{label} — Spinning Now\\!*\n"
        f"💰 `{pot_sol} SOL` · {wallet_count} wallets competing\n\n"
        f"{SITE}/#dev-roll"
    )


async def announce_dev_roll_winner(
    title: str | None,
    winner_wallet: str,
    pot_sol: float,
    *,
    is_wallet: bool = True,
) -> None:
    """Announce a dev roll winner. For wallet-typed rolls (`is_wallet=True`)
    we include a Solscan deep link; for custom (name+photo) rolls we skip
    the link since the 'winner' value is a display name, not an address."""
    label = title or "Dev Roll"
    if is_wallet:
        explorer = f"https://solscan.io/account/{winner_wallet}"
        await _send(
            f"🏆 *{label} — Winner\\!*\n"
            f"🎯 `{winner_wallet}`\n"
            f"💰 `{pot_sol} SOL`\n"
            f"[View on Solscan]({explorer})\n\n"
            f"{SITE}"
        )
    else:
        await _send(
            f"🏆 *{label} — Winner\\!*\n"
            f"🎯 `{winner_wallet}`\n"
            f"💰 `{pot_sol} SOL`\n\n"
            f"{SITE}/#dev-roll"
        )


# ── Reminder / rollover announcements ──────────────────────────────────────

async def announce_dev_roll_reminder(
    title: str | None,
    pot_sol: float,
    wallet_count: int,
    minutes_left: int = 10,
) -> None:
    label = title or "Dev Roll"
    await _send(
        f"⏰ *{label} — {minutes_left} minutes to go\\!*\n"
        f"💰 Pot: `{pot_sol} SOL` · {wallet_count} wallets\n\n"
        f"Watch live → {SITE}/#dev-roll"
    )


async def announce_daily_spin_reminder(
    pot_sol: float,
    next_spin_at_iso: str,
) -> None:
    time_str = next_spin_at_iso[:16].replace("T", " ") + " UTC" if next_spin_at_iso else "00:00 UTC"
    await _send(
        f"⏰ *Daily Spin — 10 minutes to go\\!*\n"
        f"💰 Current pot: `{pot_sol} SOL`\n"
        f"🕐 Spins at: `{time_str}`\n\n"
        f"Watch live → {SITE}/#roulette-arena"
    )


async def announce_rollover(
    pot_sol: float,
    threshold_sol: float,
    rollover_count: int,
) -> None:
    await _send(
        f"🔄 *Pot Rolled Over — Round Skipped*\n"
        f"💰 Current pot: `{pot_sol} SOL` \\(threshold: `{threshold_sol} SOL`\\)\n"
        f"📈 Pot carries forward to the next round\n"
        f"🔢 Rollover streak: {rollover_count}\n\n"
        f"{SITE}"
    )


# ── Daily 24h spin announcements ────────────────────────────────────────────

async def announce_daily_spin_started(
    round_number: int,
    participants_count: int,
    pot_sol: float,
) -> None:
    await _send(
        f"🎰 *Daily Spin — Round \\#{round_number}*\n"
        f"💰 Pot: `{pot_sol} SOL`\n"
        f"👥 {participants_count} wallets competing\n\n"
        f"Watch live → {SITE}/#roulette-arena"
    )


async def announce_daily_spin_winner(
    round_number: int,
    winner_wallet: str,
    amount_sol: float,
    participants_count: int,
) -> None:
    explorer = f"https://solscan.io/account/{winner_wallet}"
    await _send(
        f"🏆 *Round \\#{round_number} — Winner\\!*\n"
        f"🎯 `{winner_wallet}`\n"
        f"💰 `{amount_sol} SOL` · odds 1/{participants_count}\n"
        f"[View on Solscan]({explorer})\n\n"
        f"{SITE}"
    )


async def announce_guest_roll_scheduled(
    title: str | None,
    prize_label: str,
    entry_count: int,
    scheduled_at_iso: str,
) -> None:
    label = title or "Guest Roll"
    time_str = scheduled_at_iso[:16].replace("T", " ") + " UTC" if scheduled_at_iso else "TBA"
    await _send(
        f"🎟️ *{label} — Scheduled*\n"
        f"🏆 Prize: `{prize_label}`\n"
        f"🪙 {entry_count} coins competing\n"
        f"⏰ Spins at: `{time_str}`\n\n"
        f"Watch live → {SITE}/#guest-roll"
    )


async def announce_guest_roll_spinning(
    title: str | None,
    prize_label: str,
    entry_count: int,
) -> None:
    label = title or "Guest Roll"
    await _send(
        f"🎡 *{label} — Spinning Now\\!*\n"
        f"🏆 `{prize_label}` · {entry_count} coins\n\n"
        f"{SITE}/#guest-roll"
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
    await _send(
        f"🏆 *{label} — Winner\\!*\n"
        f"🥇 `${winner_ticker}` · {winner_name}\n"
        f"🎁 Prize: `{prize_label}`\n"
        f"{link_line}\n"
        f"{SITE}"
    )


async def announce_buy_cta() -> None:
    """Sent after every winner reveal to drive buys."""
    await _send(
        f"💎 *Want to be next?*\n\n"
        f"Hold `1M+ $ROLLAT` for 24h and your wallet enters the next spin\\.\n"
        f"Every round, one holder takes the entire SOL pot\\.\n\n"
        f"🪙 Buy \\$ROLLAT on pump\\.fun:\n"
        f"pump\\.fun/coin/6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump\n\n"
        f"CA: `6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump`\n"
        f"📊 {SITE} · 🐦 @Rollat\\_online"
    )
