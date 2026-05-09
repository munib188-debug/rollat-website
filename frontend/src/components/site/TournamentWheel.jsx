import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull } from "lucide-react";

// Crimson dev-roll accent.
const ACCENT = "#FF3366";

// Geometry — change these together to rescale the whole wheel.
const RADIUS = 180;     // outer rim
const INNER = 56;       // donut hole (so the central hub fits cleanly)
const PHOTO_R = 24;     // team-photo circle radius

const polar = (angleDeg, r) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
};

// Deterministic crimson tint per team — keeps the same team the same color
// across re-renders, while still distinguishing slices visually.
const _hash = (s) => {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const sliceFill = ({ entry, isElim, isWinner, isFlash }) => {
  if (isFlash) return "#FFFFFF";
  if (isWinner) return "#FFD700";
  if (isElim) return "#1A1416";
  const h = _hash(entry.id);
  const light = 28 + (h % 22); // 28%–49% — rich, not washed out
  return `hsl(${350 + (h % 12) - 6}, 75%, ${light}%)`;
};

/**
 * Compute the SVG path for one pie slice. Donut shape (outer arc + inner arc).
 * Slice `i` of `N` is centered at angle `i * (360/N)` measured from 12 o'clock
 * clockwise (the polar() helper handles the -90° conversion).
 */
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

/**
 * Tournament wheel. Renders a fixed-N pie wheel (N = total teams in the
 * tournament — angles never recompute mid-roll, eliminated slices stay
 * visible but grayed out). Each new entry in `roll.eliminated` triggers:
 *   1. A 2.4s spin that lands on the loser slice (4 full turns + offset).
 *   2. A 600ms white flash on the loser slice as the wheel settles.
 *   3. A "JUST ELIMINATED" callout above the wheel for ~2.5s.
 */
export default function TournamentWheel({ roll, entryMap, eliminatedSet }) {
  // Stabilize `entries` identity across renders — a bare `|| []` fallback
  // creates a fresh array literal each render, which would invalidate every
  // hook depending on it (ESLint catches this; CI fails the build).
  const entries = useMemo(() => roll.entries || [], [roll.entries]);
  const N = entries.length;
  const sliceAngle = N > 0 ? 360 / N : 0;
  const winnerId = roll.phase === "resolved" ? roll.winner_entry_id : null;

  const [rotation, setRotation] = useState(0);
  const [flashId, setFlashId] = useState(null);
  const [calloutEntry, setCalloutEntry] = useState(null);
  const lastElimCountRef = useRef(roll.eliminated?.length || 0);

  // React to new elimination events.
  useEffect(() => {
    const count = roll.eliminated?.length || 0;
    if (count > lastElimCountRef.current && N > 0) {
      const newest = roll.eliminated[count - 1];
      const loserId = newest?.entry_id;
      const idx = entries.findIndex((e) => e.id === loserId);
      if (idx >= 0) {
        // Spin at least 4 full turns and land with the loser at 12 o'clock.
        // Slice i sits at angle `i * sliceAngle` clockwise from the top, so
        // we need the wheel rotated to `-i * sliceAngle`.
        const target = -idx * sliceAngle;
        const base = 4 * 360;
        const cur = rotation % 360;
        const advance = base + (((target - cur) % 360) + 360) % 360;
        const next = rotation + advance;
        setRotation(next);
        // Flash + callout on settle.
        const flashTimer = setTimeout(() => {
          setFlashId(loserId);
          setCalloutEntry(entries[idx]);
          setTimeout(() => setFlashId(null), 700);
          setTimeout(() => setCalloutEntry(null), 2600);
        }, 2400);
        // Cleanup if a new tick arrives before the previous flash fires.
        return () => clearTimeout(flashTimer);
      }
    }
    lastElimCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll.eliminated?.length]);

  // NOTE: hooks must run in the same order on every render — useMemo is
  // declared *before* the early-return below.
  const survivorsRemaining = useMemo(
    () => entries.filter((e) => !eliminatedSet.has(e.id)).length,
    [entries, eliminatedSet],
  );

  if (N === 0) return null;

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
        {/* Status header */}
        <div className="text-center mb-5">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
            <Skull className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Eliminating teams
          </div>
          <div className="font-display font-black text-2xl md:text-3xl">
            <span style={{ color: ACCENT }}>{survivorsRemaining}</span>
            <span className="text-white/35"> / {N}</span>
            <span className="text-white/65 text-base md:text-lg ml-2">remaining</span>
          </div>
        </div>

        {/* "Just eliminated" callout */}
        <AnimatePresence>
          {calloutEntry && (
            <motion.div
              key={calloutEntry.id}
              initial={{ opacity: 0, y: -10, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4 }}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-sm border"
              style={{
                borderColor: `${ACCENT}99`,
                backgroundColor: `${ACCENT}25`,
                boxShadow: `0 0 20px ${ACCENT}66`,
              }}
            >
              <div className="font-display font-black text-sm uppercase tracking-widest" style={{ color: "#fff" }}>
                💀 {calloutEntry.name} eliminated
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <svg
          viewBox="-220 -220 440 440"
          className="w-full max-w-[440px] h-auto"
          style={{ filter: "drop-shadow(0 0 24px rgba(255,51,102,0.35))" }}
        >
          {/* Rotating wheel group */}
          <motion.g
            animate={{ rotate: rotation }}
            transition={{ duration: 2.4, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ transformOrigin: "0 0" }}
          >
            {entries.map((e, i) => {
              const isElim = eliminatedSet.has(e.id);
              const isWinner = winnerId === e.id;
              const isFlash = flashId === e.id;
              const fill = sliceFill({ entry: e, isElim, isWinner, isFlash });
              const [px, py] = polar(i * sliceAngle, (RADIUS + INNER) / 2);
              const clipId = `clip-${e.id}`;
              return (
                <g key={e.id}>
                  <path
                    d={slicePath(i, sliceAngle)}
                    fill={fill}
                    stroke="#0A0D0B"
                    strokeWidth="2"
                    style={{ transition: "fill 0.4s ease" }}
                  />
                  {/* Team photo at slice center */}
                  <g transform={`translate(${px} ${py})`}>
                    <defs>
                      <clipPath id={clipId}>
                        <circle r={PHOTO_R} />
                      </clipPath>
                    </defs>
                    <circle r={PHOTO_R + 2} fill="#0A0D0B" />
                    {e.image_data_url && (
                      <image
                        href={e.image_data_url}
                        x={-PHOTO_R}
                        y={-PHOTO_R}
                        width={PHOTO_R * 2}
                        height={PHOTO_R * 2}
                        clipPath={`url(#${clipId})`}
                        preserveAspectRatio="xMidYMid slice"
                        opacity={isElim && !isWinner ? 0.35 : 1}
                      />
                    )}
                    {isElim && !isWinner && (
                      <>
                        <circle r={PHOTO_R} fill="rgba(0,0,0,0.55)" />
                        <line x1="-14" y1="-14" x2="14" y2="14" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
                        <line x1="-14" y1="14" x2="14" y2="-14" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" />
                      </>
                    )}
                    {isWinner && (
                      <circle r={PHOTO_R + 4} fill="none" stroke="#FFD700" strokeWidth="3" />
                    )}
                  </g>
                </g>
              );
            })}
          </motion.g>

          {/* Central hub (stationary) */}
          <circle r={INNER - 6} fill="#0A0D0B" stroke={ACCENT} strokeWidth="2" opacity="0.9" />
          <circle r={INNER - 14} fill="none" stroke={`${ACCENT}55`} strokeWidth="1" />

          {/* Pointer at top — stays fixed while wheel rotates underneath */}
          <polygon
            points="0,-208 -14,-184 14,-184"
            fill={ACCENT}
            stroke="#0A0D0B"
            strokeWidth="2"
          />
        </svg>

        <div className="mt-5 text-[10px] uppercase tracking-[0.3em] font-mono text-white/35">
          Pot · <span className="text-white/70">{(roll.pot_sol ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL</span>
        </div>
      </div>
    </div>
  );
}
