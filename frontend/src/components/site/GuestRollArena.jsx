import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, ExternalLink, Zap, Clock } from "lucide-react";
import { useGuestRoll } from "@/lib/useGuestRoll";
import { useCountdown, pad } from "@/lib/useCountdown";
import { launchConfetti } from "@/lib/confetti";

const ACCENT = "#A855F7";

// Reel animation must match GUEST_SPIN_ANIMATION_SECS in backend/guest_rolls.py
const SPIN_DURATION_MS = 10_000;

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
          Ten partner coins. One winner. The reel spins, and one community walks away with a
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
        Community picks the lineup.
      </div>
    </div>
  );
}

// ---------- Slot-machine reel ----------

const CARD_W = 132;
const CARD_GAP = 12;
const STEP = CARD_W + CARD_GAP;
const REPEATS = 14; // total card count = entries.length * REPEATS for landing room

/**
 * Horizontal slot-machine reel.
 *  - `winnerIndex` provided → decelerate and park winner under the center pointer.
 *  - `spinning` true (no winner yet) → continuous fast scroll.
 *  - Otherwise → static preview row.
 */
function GuestReel({ entries, winnerIndex = null, spinning = false, height = 168 }) {
  const containerRef = useRef(null);
  const [containerW, setContainerW] = useState(0);
  const n = entries.length;

  useLayoutEffect(() => {
    const measure = () => setContainerW(containerRef.current?.clientWidth || 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const isStatic = winnerIndex == null && !spinning;

  // Repeated entries for animated states; single pass for static preview.
  const cards = useMemo(() => {
    if (isStatic) return entries.map((e, i) => ({ entry: e, srcIndex: i, key: `s-${i}` }));
    return Array.from({ length: n * REPEATS }, (_, i) => ({
      entry: entries[i % n],
      srcIndex: i % n,
      key: `r-${i}`,
    }));
  }, [entries, isStatic, n]);

  const targetX = useMemo(() => {
    if (isStatic) return 0;
    if (winnerIndex == null) {
      // Free spin: shift left by one full cycle. Framer Motion replays each render
      // when transition.repeat is Infinity, giving a seamless conveyor.
      return -n * STEP;
    }
    // Land: center the chosen winner under the pointer at containerW/2.
    // Pick a card index in the back half of the strip for dramatic deceleration room.
    const finalCardIdx = Math.floor(REPEATS * 0.85) * n + winnerIndex;
    const cardCenterFromStart = finalCardIdx * STEP + CARD_W / 2;
    return -(cardCenterFromStart - containerW / 2);
  }, [isStatic, winnerIndex, containerW, n]);

  const transition = useMemo(() => {
    if (isStatic) return { duration: 0 };
    if (winnerIndex == null) {
      return { duration: 1.2, ease: "linear", repeat: Infinity };
    }
    return { duration: SPIN_DURATION_MS / 1000, ease: [0.15, 0.7, 0.2, 1] };
  }, [isStatic, winnerIndex]);

  // Track which card is currently centered for highlight (only meaningful when landed).
  const winnerSrcIndex = winnerIndex;

  return (
    <div className="relative" style={{ height: height + 24 }}>
      {/* Soft glow behind the reel */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(60% 80% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)` }}
      />

      {/* Top + bottom guide rails */}
      <div className="absolute left-0 right-0 top-0 h-px" style={{ backgroundColor: `${ACCENT}40` }} />
      <div className="absolute left-0 right-0 bottom-0 h-px" style={{ backgroundColor: `${ACCENT}40` }} />

      {/* Center pointer (top arrow) */}
      <div
        className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none"
        style={{ top: -10 }}
        aria-hidden
      >
        <div
          className="w-0 h-0"
          style={{
            borderLeft: "10px solid transparent",
            borderRight: "10px solid transparent",
            borderTop: `16px solid ${ACCENT}`,
            filter: `drop-shadow(0 0 8px ${ACCENT})`,
          }}
        />
      </div>

      {/* Selection frame (centered) */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none rounded-sm"
        style={{
          width: CARD_W + 10,
          height: height + 10,
          border: `2px solid ${ACCENT}`,
          boxShadow: `0 0 24px ${ACCENT}80, inset 0 0 16px ${ACCENT}30`,
        }}
      />

      {/* Edge fades */}
      <div
        className="absolute left-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to right, #0A0D0B 5%, rgba(10,13,11,0.6) 60%, transparent 100%)" }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-24 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to left, #0A0D0B 5%, rgba(10,13,11,0.6) 60%, transparent 100%)" }}
      />

      {/* Reel viewport */}
      <div
        ref={containerRef}
        className="overflow-hidden relative"
        style={{ height: height + 16, paddingTop: 8, paddingBottom: 8 }}
      >
        {isStatic ? (
          // Static preview: scroll-x, justify-start so user can see the lineup.
          <div className="flex justify-center" style={{ gap: CARD_GAP }}>
            {cards.map(({ entry, srcIndex, key }) => (
              <ReelCard
                key={key}
                entry={entry}
                colorIndex={srcIndex}
                height={height}
                highlight={false}
              />
            ))}
          </div>
        ) : (
          <motion.div
            className="flex"
            style={{ gap: CARD_GAP, willChange: "transform" }}
            animate={{ x: targetX }}
            transition={transition}
            initial={false}
          >
            {cards.map(({ entry, srcIndex, key }) => (
              <ReelCard
                key={key}
                entry={entry}
                colorIndex={srcIndex}
                height={height}
                highlight={winnerSrcIndex != null && srcIndex === winnerSrcIndex}
              />
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

function ReelCard({ entry, colorIndex, height, highlight }) {
  const color = SLICE_COLORS[colorIndex % SLICE_COLORS.length];
  return (
    <div
      className="shrink-0 rounded-sm border flex flex-col items-center justify-center gap-2 px-2 py-3 bg-obsidian-900/70 backdrop-blur-sm transition-shadow"
      style={{
        width: CARD_W,
        height,
        borderColor: highlight ? color : `${color}40`,
        boxShadow: highlight ? `0 0 32px ${color}aa, inset 0 0 12px ${color}30` : "none",
      }}
    >
      {entry?.logo_url ? (
        <img
          src={entry.logo_url}
          alt=""
          className="w-14 h-14 rounded-full object-cover"
          style={{ border: `2px solid ${color}` }}
        />
      ) : (
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center font-black text-xl"
          style={{ backgroundColor: `${color}30`, color, border: `2px solid ${color}80` }}
        >
          {entry?.ticker?.[0] || "?"}
        </div>
      )}
      <div className="font-mono font-black text-sm leading-none" style={{ color }}>
        ${entry?.ticker}
      </div>
      <div className="text-[10px] text-white/55 truncate w-full text-center font-mono uppercase tracking-wider">
        {entry?.name}
      </div>
    </div>
  );
}

// ---------- Phase views ----------

function ScheduledView({ roll }) {
  const t = useCountdown(roll.scheduled_at);
  const entries = roll.entries || [];

  return (
    <div className="space-y-6">
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
        </div>

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
      </div>

      {/* Lineup reel — static preview */}
      <div className="glass rounded-sm p-6 md:p-10 relative overflow-hidden">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-6" style={{ color: ACCENT }}>
          Lineup · {entries.length} coins
        </div>
        <GuestReel entries={entries} />
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

      <GuestReel entries={entries} spinning height={184} />

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
    <div className="space-y-6">
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 9999 }}
      />

      <div className="glass rounded-sm p-6 md:p-10 relative overflow-hidden" style={{ borderColor: `${ACCENT}40` }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)` }}
        />
        <GuestReel entries={entries} winnerIndex={winnerIndex >= 0 ? winnerIndex : 0} height={184} />
      </div>

      <div className="glass rounded-sm p-7 md:p-10 relative overflow-hidden" style={{ borderColor: `${ACCENT}40` }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(70% 60% at 100% 0%, ${ACCENT}28 0%, transparent 60%)` }}
        />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
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
          </div>

          <div className="flex flex-col items-start md:items-end gap-3">
            <div className="flex items-center gap-3 flex-wrap">
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
            <div className="text-xs text-white/40 font-mono flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              {roll.resolved_at ? new Date(roll.resolved_at).toUTCString() : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
