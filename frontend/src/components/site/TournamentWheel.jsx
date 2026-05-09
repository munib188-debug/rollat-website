import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull, Clock } from "lucide-react";

// Crimson dev-roll accent.
const ACCENT = "#FF3366";

// Geometry — change these together to rescale the whole wheel.
const RADIUS = 200;
const INNER = 80;
const PHOTO_R = 28;

// Spin animation tuning.
const SPIN_MS = 5200;                     // total spin duration
const SPIN_EASE = [0.05, 0.85, 0.2, 1.0]; // strong ease-out
const FLASH_MS = 700;                     // white flash duration on the loser
const REVEAL_HOLD_MS = 3200;              // how long "ELIMINATED" overlay sticks

const polar = (angleDeg, r) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
};

const slicePath = (i, sliceAngle) => {
  const half = sliceAngle / 2;
  const startA = i * sliceAngle - half;
  const endA = i * sliceAngle + half;
  const [sxO, syO] = polar(startA, RADIUS);
  const [exO, eyO] = polar(endA, RADIUS);
  const [sxI, syI] = polar(startA, INNER);
  const [exI, eyI] = polar(endA, INNER);
  const large = sliceAngle > 180 ? 1 : 0;
  return [
    `M ${sxI} ${syI}`,
    `L ${sxO} ${syO}`,
    `A ${RADIUS} ${RADIUS} 0 ${large} 1 ${exO} ${eyO}`,
    `L ${exI} ${eyI}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${sxI} ${syI}`,
    "Z",
  ].join(" ");
};

// Two-tone alternating crimson for clean slice contrast (deterministic by
// index — uniform, not random). Index parity gives clear visual stripes.
const sliceColor = (index, isElim, isWinner, isFlash) => {
  if (isFlash) return "#FFFFFF";
  if (isWinner) return "#FFD700";
  if (isElim) return "#1A1416";
  return index % 2 === 0 ? "#C2274D" : "#E0335F";
};

/**
 * One slice (path + clipped photo). Memoized — base64 photos NEVER redecode
 * on polling-driven re-renders if entry identity is stable upstream.
 */
const Slice = memo(function Slice({ entry, index, sliceAngle, isElim, isWinner, isFlash }) {
  const [px, py] = polar(index * sliceAngle, (RADIUS + INNER) / 2);
  const clipId = `clip-${entry.id}`;
  const fill = sliceColor(index, isElim, isWinner, isFlash);

  return (
    <g>
      <path
        d={slicePath(index, sliceAngle)}
        fill={fill}
        stroke="#0A0D0B"
        strokeWidth="2"
        style={{ transition: "fill 0.45s ease" }}
      />
      <g transform={`translate(${px} ${py})`}>
        <defs>
          <clipPath id={clipId}>
            <circle r={PHOTO_R} />
          </clipPath>
        </defs>
        <circle r={PHOTO_R + 2} fill="#0A0D0B" />
        {entry.image_data_url && (
          <image
            href={entry.image_data_url}
            x={-PHOTO_R}
            y={-PHOTO_R}
            width={PHOTO_R * 2}
            height={PHOTO_R * 2}
            clipPath={`url(#${clipId})`}
            preserveAspectRatio="xMidYMid slice"
            opacity={isElim && !isWinner ? 0.3 : 1}
          />
        )}
        {isElim && !isWinner && (
          <>
            <circle r={PHOTO_R} fill="rgba(0,0,0,0.6)" />
            <line x1="-15" y1="-15" x2="15" y2="15" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
            <line x1="-15" y1="15" x2="15" y2="-15" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
          </>
        )}
        {isWinner && (
          <circle r={PHOTO_R + 4} fill="none" stroke="#FFD700" strokeWidth="3" />
        )}
      </g>
    </g>
  );
});

// Hub countdown / status display — sits in the donut hole when idle.
function HubStatus({ remainingMs, spinning, calloutEntry }) {
  if (calloutEntry) return null; // overlay covers the hub during reveal
  if (spinning) {
    return (
      <foreignObject x={-INNER + 10} y={-INNER + 10} width={(INNER - 10) * 2} height={(INNER - 10) * 2}>
        <div className="w-full h-full flex items-center justify-center">
          <div
            className="font-display font-black text-[11px] uppercase tracking-[0.3em] animate-pulse"
            style={{ color: ACCENT }}
          >
            spinning
          </div>
        </div>
      </foreignObject>
    );
  }
  // Idle countdown to next elimination
  const totalSecs = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const display = h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}:${pad(s)}`;
  return (
    <foreignObject x={-INNER + 6} y={-INNER + 6} width={(INNER - 6) * 2} height={(INNER - 6) * 2}>
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="text-[8px] font-mono uppercase tracking-[0.25em] text-white/40 mb-1">
          NEXT IN
        </div>
        <div
          className="font-mono font-black tabular-nums text-lg leading-none"
          style={{ color: ACCENT }}
        >
          {display}
        </div>
      </div>
    </foreignObject>
  );
}

/**
 * Tournament wheel.
 *
 * The X-mark on a slice is deferred until AFTER the wheel finishes landing
 * — otherwise the loser is visually eliminated at the same instant the
 * spin begins, defeating the whole "watch the wheel pick" effect.
 */
export default function TournamentWheel({ roll, eliminatedSet }) {
  // Stabilize `entries` identity: the polling hook returns a new array
  // reference on every refresh, but the actual team set never changes
  // mid-tournament. Reuse the previous array if the id+image signature
  // matches — keeps Slice's React.memo working so base64 photos don't
  // redecode on each poll, which is what was causing the laggy spin.
  const entriesRef = useRef([]);
  const entries = useMemo(() => {
    const next = roll.entries || [];
    const prev = entriesRef.current;
    if (
      prev.length === next.length &&
      next.every((e, i) => prev[i] && prev[i].id === e.id && prev[i].image_data_url === e.image_data_url)
    ) {
      return prev;
    }
    entriesRef.current = next;
    return next;
  }, [roll.entries]);

  const N = entries.length;
  const sliceAngle = N > 0 ? 360 / N : 0;
  const winnerId = roll.phase === "resolved" ? roll.winner_entry_id : null;

  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  // While we're spinning toward someone, treat them as still-alive in the
  // wheel — the "X" overlay only kicks in after the reveal completes.
  const [pendingLoserId, setPendingLoserId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [calloutEntry, setCalloutEntry] = useState(null);
  const lastElimCountRef = useRef(roll.eliminated?.length || 0);

  // Live countdown to the next elimination tick.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextElimMs = roll.next_elimination_at
    ? new Date(roll.next_elimination_at).getTime()
    : null;
  const remainingMs = nextElimMs ? Math.max(0, nextElimMs - now) : 0;

  // React to a fresh elimination event from the server.
  useEffect(() => {
    const count = roll.eliminated?.length || 0;
    if (count > lastElimCountRef.current && N > 0) {
      const newest = roll.eliminated[count - 1];
      const loserId = newest?.entry_id;
      const idx = entries.findIndex((e) => e.id === loserId);
      if (idx >= 0) {
        // Don't show the X yet — slice stays alive-looking through the spin.
        setPendingLoserId(loserId);
        setSpinning(true);
        // Spin 5 full turns + offset so the loser slice ends at 12 o'clock.
        const target = -idx * sliceAngle;
        const base = 5 * 360;
        const cur = rotation % 360;
        const advance = base + (((target - cur) % 360) + 360) % 360;
        setRotation(rotation + advance);

        const tStop = setTimeout(() => {
          setSpinning(false);
          setFlashId(loserId);
          setCalloutEntry(entries[idx]);
        }, SPIN_MS);
        const tFlash = setTimeout(() => setFlashId(null), SPIN_MS + FLASH_MS);
        // After the reveal hold ends, drop the pending state — only NOW does
        // the slice flip to its eliminated visual. This is the fix for the
        // "X appeared before the arrow landed" bug.
        const tDone = setTimeout(() => {
          setCalloutEntry(null);
          setPendingLoserId(null);
        }, SPIN_MS + REVEAL_HOLD_MS);

        return () => { clearTimeout(tStop); clearTimeout(tFlash); clearTimeout(tDone); };
      }
    }
    lastElimCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll.eliminated?.length]);

  const survivorsRemaining = useMemo(
    () => entries.filter((e) => !eliminatedSet.has(e.id)).length,
    [entries, eliminatedSet],
  );

  if (N === 0) return null;

  // Spotlight wedge anchored at the pointer. Pulses softly so the eye is
  // drawn to whatever's currently in the firing line.
  const halfA = sliceAngle / 2;
  const [sx, sy] = polar(-halfA, RADIUS);
  const [ex, ey] = polar(halfA, RADIUS);
  const spotlightPath = `M 0 0 L ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 0 1 ${ex} ${ey} Z`;

  return (
    <div
      className="glass rounded-sm p-6 md:p-10 relative overflow-hidden"
      data-testid="tournament-wheel"
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)`,
        }}
      />
      <div className="relative flex flex-col items-center">
        {/* Status row */}
        <div className="w-full max-w-[480px] flex items-center justify-between mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
              <Skull className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Eliminating
            </div>
            <div className="font-display font-black text-2xl md:text-3xl">
              <span style={{ color: ACCENT }}>{survivorsRemaining}</span>
              <span className="text-white/35"> / {N}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1 text-white/40">
              <Clock className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Next elimination
            </div>
            <div className="font-mono font-black text-2xl md:text-3xl tabular-nums" style={{ color: ACCENT }}>
              {spinning ? "—" : nextElimMs ? formatRemaining(remainingMs) : "—"}
            </div>
          </div>
        </div>

        {/* Wheel */}
        <div className="relative w-full max-w-[480px]">
          <svg
            viewBox="-240 -240 480 480"
            className="w-full h-auto select-none"
            style={{ filter: "drop-shadow(0 0 36px rgba(255,51,102,0.45))" }}
          >
            <defs>
              <radialGradient id="hubGlow" cx="0" cy="0" r="0.5">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.45" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="bgGlow" cx="0" cy="0" r="0.6">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.05" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle r={RADIUS + 28} fill="url(#bgGlow)" />
            <circle r={RADIUS + 8} fill="none" stroke={ACCENT} strokeOpacity="0.35" strokeWidth="2" />
            <circle r={RADIUS + 14} fill="none" stroke={ACCENT} strokeOpacity="0.12" strokeWidth="1" />

            {/* Rotating wheel group */}
            <motion.g
              animate={{ rotate: rotation }}
              transition={{ duration: SPIN_MS / 1000, ease: SPIN_EASE }}
              style={{ transformOrigin: "0 0", willChange: "transform" }}
            >
              {entries.map((e, i) => {
                const isFinallyElim = eliminatedSet.has(e.id);
                // Slices stay "alive" in the wheel until the reveal closes —
                // pendingLoserId is the team currently being spun-to.
                const isVisuallyElim = isFinallyElim && e.id !== pendingLoserId;
                return (
                  <Slice
                    key={e.id}
                    entry={e}
                    index={i}
                    sliceAngle={sliceAngle}
                    isElim={isVisuallyElim}
                    isWinner={winnerId === e.id}
                    isFlash={flashId === e.id}
                  />
                );
              })}
            </motion.g>

            {/* Stationary spotlight wedge */}
            <motion.path
              d={spotlightPath}
              fill={ACCENT}
              animate={{ opacity: [0.12, 0.22, 0.12] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              style={{ pointerEvents: "none" }}
            />

            {/* Hub */}
            <circle r={INNER + 4} fill="url(#hubGlow)" />
            <circle r={INNER - 2} fill="#0A0D0B" stroke={ACCENT} strokeWidth="2.5" />
            <circle r={INNER - 12} fill="none" stroke={`${ACCENT}55`} strokeWidth="1" />

            <HubStatus
              remainingMs={remainingMs}
              spinning={spinning}
              calloutEntry={calloutEntry}
            />

            {/* Pointer at 12 o'clock — apex points DOWN into the wheel,
                so the user instinctively reads "this is the slice that just
                got picked". Base sits above the outer rim, tip touches it. */}
            <motion.polygon
              points={`0,${-RADIUS + 6} -18,${-RADIUS - 22} 18,${-RADIUS - 22}`}
              fill={ACCENT}
              stroke="#0A0D0B"
              strokeWidth="2"
              animate={{ y: [0, 2, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </svg>

          {/* Center elimination overlay — sits ABOVE the SVG when present.
              Big team photo + name + ELIMINATED. */}
          <AnimatePresence>
            {calloutEntry && (
              <motion.div
                key={calloutEntry.id}
                initial={{ opacity: 0, scale: 0.55 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1.05] }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div
                  className="flex flex-col items-center gap-2 px-6 py-5 rounded-sm"
                  style={{
                    backgroundColor: "rgba(10, 13, 11, 0.78)",
                    border: `2px solid ${ACCENT}`,
                    boxShadow: `0 0 60px ${ACCENT}AA`,
                    backdropFilter: "blur(6px)",
                  }}
                >
                  {calloutEntry.image_data_url && (
                    <div
                      className="w-20 h-20 rounded-sm overflow-hidden border-2"
                      style={{ borderColor: ACCENT }}
                    >
                      <img
                        src={calloutEntry.image_data_url}
                        alt={calloutEntry.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="font-display font-black text-2xl md:text-3xl text-center text-white tracking-tight">
                    {calloutEntry.name}
                  </div>
                  <div
                    className="font-display font-black text-sm md:text-base uppercase tracking-[0.3em]"
                    style={{ color: ACCENT }}
                  >
                    💀 Eliminated
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-6 text-[10px] uppercase tracking-[0.3em] font-mono text-white/35">
          Pot ·{" "}
          <span className="text-white/70">
            {(roll.pot_sol ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL
          </span>
        </div>
      </div>
    </div>
  );
}

function formatRemaining(ms) {
  if (ms <= 0) return "00:00";
  const totalSecs = Math.ceil(ms / 1000);
  if (totalSecs < 3600) {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
