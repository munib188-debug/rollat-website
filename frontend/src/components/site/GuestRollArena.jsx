import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, ExternalLink, Zap, Coins, Clock } from "lucide-react";
import { useGuestRoll } from "@/lib/useGuestRoll";
import { useCountdown, pad } from "@/lib/useCountdown";
import { launchConfetti } from "@/lib/confetti";

// Electric purple — distinct from the gold main wheel and crimson dev roll.
const ACCENT = "#A855F7";
const ACCENT_2 = "#06B6D4"; // cyan secondary for alternating slices

// Wheel animation must match GUEST_SPIN_ANIMATION_SECS in backend/guest_rolls.py
const SPIN_DURATION_MS = 10_000;

// Per-segment palette — 10 distinct hues so adjacent slices read clearly.
const SLICE_COLORS = [
  "#A855F7", "#06B6D4", "#F59E0B", "#EC4899", "#10B981",
  "#3B82F6", "#F43F5E", "#84CC16", "#8B5CF6", "#0EA5E9",
];

export default function GuestRollArena() {
  const { roll } = useGuestRoll();
  const phase = roll?.phase || null;

  return (
    <section
      id="guest-roll"
      className="relative py-20 md:py-28 px-6 md:px-12 border-t border-white/10"
      data-testid="guest-roll-section"
    >
      <div className="max-w-[1400px] mx-auto">
        <SectionHeader />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter">
            {roll?.title
              ? <span style={{ color: ACCENT }}>{roll.title}</span>
              : <>Guest <span style={{ color: ACCENT }}>Roll.</span></>
            }
          </h2>
          <PhasePill phase={phase} />
        </div>

        <p className="text-white/55 max-w-2xl mb-10 text-base md:text-lg">
          Ten partner coins. One winner. The wheel spins, and one community walks away with a
          prize like a DexScreener boost.
          <span className="text-white/35"> &nbsp;Cross-community, off-cycle.</span>
        </p>

        <AnimatePresence mode="wait">
          {!roll && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState />
            </motion.div>
          )}
          {roll && phase === "scheduled" && (
            <motion.div key="scheduled" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ScheduledView roll={roll} />
            </motion.div>
          )}
          {roll && phase === "spinning" && (
            <motion.div key="spinning" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SpinningView roll={roll} />
            </motion.div>
          )}
          {roll && phase === "resolved" && (
            <motion.div key="resolved" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ResolvedView roll={roll} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-px" style={{ backgroundColor: ACCENT }} />
      <span className="text-[10px] uppercase tracking-[0.3em] font-mono font-bold" style={{ color: ACCENT }}>
        Guest Roll · Cross-Community
      </span>
    </div>
  );
}

function PhasePill({ phase }) {
  const configs = {
    null: { dot: "bg-white/30", label: "NO ROLL ACTIVE" },
    scheduled: { dot: "animate-pulse", label: "SCHEDULED" },
    spinning: { dot: "animate-ping", label: "SPINNING · LIVE" },
    resolved: { dot: "", label: "WINNER ANNOUNCED" },
  };
  const key = phase ?? "null";
  const c = configs[key] || configs.null;
  const accent = phase ? ACCENT : undefined;
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-[11px] uppercase tracking-[0.2em]"
      style={{
        borderColor: accent ? `${ACCENT}55` : "#ffffff20",
        color: accent || "#ffffff70",
      }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} style={{ backgroundColor: accent || "#ffffff60" }} />
      {c.label}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-sm p-8 md:p-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-sm flex items-center justify-center border"
          style={{ borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}10` }}
        >
          <Zap className="w-6 h-6" style={{ color: ACCENT }} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
            Awaiting next guest roll
          </div>
          <div className="font-display font-bold text-xl text-white">
            No guest roll scheduled right now.
          </div>
        </div>
      </div>
      <div className="text-sm text-white/45 font-mono uppercase tracking-widest">
        Want in? DM the team.
      </div>
    </div>
  );
}

// ---------- Wheel renderer ----------

/**
 * SVG wheel of N segments. Rotates via Framer Motion.
 * - When `winnerIndex` is provided, the wheel decelerates and parks the winner
 *   under the top pointer.
 * - When `spinning` is true and no winner yet, it free-spins.
 * - When idle, it shows the static layout.
 */
function GuestWheel({ entries, winnerIndex = null, spinning = false, size = 480 }) {
  const n = entries.length;
  const sliceAngle = 360 / n;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 6;

  // Wheel rotation logic. Each tick we set a target rotation.
  // For static layout: 0deg. For spinning (no winner yet): 5 full rotations.
  // For landing on winner: align winner slice midpoint with the top (270° in SVG / -90° / pointing up).
  const targetRotation = useMemo(() => {
    if (winnerIndex == null) {
      return spinning ? 360 * 5 : 0;
    }
    // Each slice's midpoint angle (CCW from 3 o'clock in math convention; we use clockwise from 12 o'clock).
    // We draw slice i starting at angle i*sliceAngle (clockwise from 12). Midpoint = (i + 0.5)*sliceAngle.
    // We want that midpoint at the top (0°). So rotate by -(i+0.5)*sliceAngle.
    // Add 8 full rotations for drama.
    const winnerMid = (winnerIndex + 0.5) * sliceAngle;
    return 360 * 8 - winnerMid;
  }, [winnerIndex, spinning, sliceAngle]);

  const transition = useMemo(() => {
    if (winnerIndex == null && !spinning) return { duration: 0 };
    if (winnerIndex == null) {
      return { duration: 4, ease: "linear", repeat: Infinity };
    }
    return { duration: SPIN_DURATION_MS / 1000, ease: [0.2, 0.85, 0.25, 1] };
  }, [winnerIndex, spinning]);

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      {/* Outer glow */}
      <div
        className="absolute inset-0 rounded-full blur-3xl pointer-events-none"
        style={{ background: `radial-gradient(50% 50% at 50% 50%, ${ACCENT}30 0%, transparent 70%)` }}
      />

      {/* Top pointer */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
        style={{ top: -4 }}
        aria-hidden
      >
        <div
          className="w-0 h-0"
          style={{
            borderLeft: "14px solid transparent",
            borderRight: "14px solid transparent",
            borderTop: `22px solid ${ACCENT}`,
            filter: `drop-shadow(0 0 12px ${ACCENT})`,
          }}
        />
      </div>

      {/* Spinning SVG */}
      <motion.svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        animate={{ rotate: targetRotation }}
        transition={transition}
        style={{ originX: "50%", originY: "50%" }}
        className="relative z-10"
      >
        <defs>
          <radialGradient id="centerHub" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1a1a1a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </radialGradient>
        </defs>

        {entries.map((entry, i) => {
          const startA = i * sliceAngle - 90; // -90 so slice 0 starts at top
          const endA = startA + sliceAngle;
          const path = describeArc(cx, cy, radius, startA, endA);
          const midA = startA + sliceAngle / 2;
          const labelR = radius * 0.7;
          const labelX = cx + labelR * Math.cos((midA * Math.PI) / 180);
          const labelY = cy + labelR * Math.sin((midA * Math.PI) / 180);
          const fill = SLICE_COLORS[i % SLICE_COLORS.length];

          // Logo position closer to outer edge
          const logoR = radius * 0.78;
          const logoX = cx + logoR * Math.cos((midA * Math.PI) / 180);
          const logoY = cy + logoR * Math.sin((midA * Math.PI) / 180);
          const logoSize = Math.max(28, size * 0.07);

          return (
            <g key={`${entry.ticker}-${i}`}>
              <path
                d={path}
                fill={fill}
                fillOpacity={0.92}
                stroke="#0A0D0B"
                strokeWidth={2}
              />
              {/* Ticker text — rotated to read along the slice */}
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={Math.max(12, size * 0.028)}
                fontWeight={800}
                fontFamily="'JetBrains Mono', monospace"
                fill="#0A0D0B"
                transform={`rotate(${midA + 90} ${labelX} ${labelY})`}
                style={{ pointerEvents: "none", letterSpacing: "0.05em" }}
              >
                ${entry.ticker}
              </text>
              {/* Coin logo (if provided) */}
              {entry.logo_url && (
                <image
                  href={entry.logo_url}
                  x={logoX - logoSize / 2}
                  y={logoY - logoSize / 2}
                  width={logoSize}
                  height={logoSize}
                  preserveAspectRatio="xMidYMid slice"
                  clipPath={`circle(${logoSize / 2}px at ${logoSize / 2}px ${logoSize / 2}px)`}
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}

        {/* Center hub */}
        <circle cx={cx} cy={cy} r={size * 0.11} fill="url(#centerHub)" stroke={ACCENT} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={size * 0.04} fill={ACCENT} />
      </motion.svg>
    </div>
  );
}

// SVG arc path helper. Builds a pie slice from (startAngle, endAngle) in degrees.
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${cx} ${cy}`,
    `L ${end.x} ${end.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${start.x} ${start.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

// ---------- Phase views ----------

function ScheduledView({ roll }) {
  const t = useCountdown(roll.scheduled_at);
  const entries = roll.entries || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 glass rounded-sm p-6 md:p-10 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-72 h-72 rounded-full blur-3xl" style={{ backgroundColor: `${ACCENT}15` }} />
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-4" style={{ color: ACCENT }}>
          Spins In
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 font-mono mb-6">
          {[
            { label: "DAYS", v: t.d },
            { label: "HRS", v: t.h },
            { label: "MIN", v: t.m },
            { label: "SEC", v: t.s },
          ].map((c, i) => (
            <div key={c.label} className="flex items-end gap-3">
              <div>
                <div className="text-[9px] tracking-[0.25em] text-white/40 mb-0.5">{c.label}</div>
                <div className="text-4xl md:text-5xl font-black tabular-nums" style={{ color: ACCENT }}>
                  {pad(c.v)}
                </div>
              </div>
              {i < 3 && <span className="text-3xl text-white/20 pb-1">:</span>}
            </div>
          ))}
        </div>
        <div className="text-xs text-white/45 font-mono uppercase tracking-widest">
          {new Date(roll.scheduled_at).toUTCString()}
        </div>

        {/* Static preview wheel */}
        <div className="mt-8">
          <GuestWheel entries={entries} size={420} />
        </div>
      </div>

      <div className="space-y-4">
        <div className="glass rounded-sm p-6 md:p-8 relative overflow-hidden">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: `radial-gradient(60% 60% at 100% 0%, ${ACCENT}1A 0%, transparent 60%)` }}
          />
          <div className="relative">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
              Prize
            </div>
            <div className="font-display font-black text-2xl md:text-3xl text-white leading-tight">
              {roll.prize_label}
            </div>
            <div className="mt-4 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono text-white/40">
              <Trophy className="w-3 h-3" />
              Winner takes all · 1 of {entries.length}
            </div>
          </div>
        </div>

        <div className="glass rounded-sm p-5">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-3">
            Lineup · {entries.length}
          </div>
          <ul className="space-y-1.5 max-h-[360px] overflow-y-auto pr-2 scrollbar-hidden">
            {entries.map((e, i) => (
              <li
                key={e.ticker}
                className="flex items-center gap-3 px-2 py-1.5 rounded-sm border bg-obsidian-900/40"
                style={{ borderColor: `${SLICE_COLORS[i % SLICE_COLORS.length]}30` }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: SLICE_COLORS[i % SLICE_COLORS.length] }}
                />
                {e.logo_url && (
                  <img src={e.logo_url} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                )}
                <span className="font-mono text-[11px] font-bold" style={{ color: SLICE_COLORS[i % SLICE_COLORS.length] }}>
                  ${e.ticker}
                </span>
                <span className="text-xs text-white/55 truncate flex-1">{e.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SpinningView({ roll }) {
  const entries = roll.entries || [];

  return (
    <div className="glass rounded-sm p-6 md:p-12 relative overflow-hidden" data-testid="guest-roll-spinning">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)` }}
      />
      <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-6 text-center" style={{ color: ACCENT }}>
        Spinning · Prize: {roll.prize_label}
      </div>

      <GuestWheel entries={entries} spinning size={480} />

      <div className="mt-8 text-center text-[10px] uppercase tracking-[0.3em] font-mono text-white/40">
        {entries.length} coins · uniform random · winner locks in shortly
      </div>
    </div>
  );
}

function ResolvedView({ roll }) {
  const entries = roll.entries || [];
  const winner = roll.winner;
  const winnerIndex = roll.winner_index ?? entries.findIndex((e) => e.ticker === winner?.ticker);
  const canvasRef = useRef(null);

  useEffect(() => {
    const cleanup = launchConfetti(canvasRef.current, 5000);
    return () => cleanup?.();
  }, []);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 9999 }}
      />
      <div
        className="glass rounded-sm p-6 md:p-10 relative overflow-hidden"
        style={{ borderColor: `${ACCENT}40` }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}24 0%, transparent 70%)` }}
        />
        <GuestWheel entries={entries} winnerIndex={winnerIndex >= 0 ? winnerIndex : 0} size={420} />
      </div>

      <div className="glass rounded-sm p-7 md:p-10 relative overflow-hidden flex flex-col justify-center" style={{ borderColor: `${ACCENT}40` }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(70% 60% at 100% 0%, ${ACCENT}28 0%, transparent 60%)` }}
        />
        <div className="relative">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
            <Trophy className="w-3 h-3 inline -mt-0.5 mr-1.5" />
            Guest Roll Winner
          </div>
          <div className="flex items-center gap-4 mb-4">
            {winner?.logo_url && (
              <img
                src={winner.logo_url}
                alt=""
                className="w-16 h-16 rounded-full object-cover border-2"
                style={{ borderColor: ACCENT }}
              />
            )}
            <div>
              <div
                className="font-mono font-black text-3xl md:text-5xl"
                style={{ color: ACCENT }}
                data-testid="guest-roll-winner-ticker"
              >
                ${winner?.ticker}
              </div>
              <div className="text-white/70 text-lg mt-1">{winner?.name}</div>
            </div>
          </div>
          <div className="border-t border-white/5 pt-4 mt-4">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-1">Prize</div>
            <div className="font-display font-black text-2xl text-white">{roll.prize_label}</div>
          </div>
          <div className="mt-5 flex items-center gap-3 flex-wrap">
            {winner?.link && (
              <a
                href={winner.link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border text-[11px] uppercase tracking-[0.2em] font-mono"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT }}
              >
                <ExternalLink className="w-3 h-3" /> Visit Community
              </a>
            )}
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                `🏆 The $ROLLAT Guest Roll just landed on $${winner?.ticker} (${winner?.name})!\n\nThey win: ${roll.prize_label}.\n\nrollat.vercel.app`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border text-[11px] uppercase tracking-[0.2em] font-mono text-white/60 hover:text-white"
              style={{ borderColor: "#ffffff20" }}
            >
              Share on X
            </a>
          </div>
          <div className="text-xs text-white/40 mt-4 font-mono flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {roll.resolved_at ? new Date(roll.resolved_at).toUTCString() : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
