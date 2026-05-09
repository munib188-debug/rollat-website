import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull } from "lucide-react";

// Crimson dev-roll accent.
const ACCENT = "#FF3366";

// Geometry — change these together to rescale the whole wheel.
const RADIUS = 190;     // outer rim
const INNER = 64;       // donut hole (so the central hub fits cleanly)
const PHOTO_R = 26;     // team-photo circle radius

// Spin animation tuning.  A 5s deceleration with a strong ease-out
// (near-flat tail) gives the game-show "is it gonna land?" feel and
// lets the viewer track what's under the pointer right at the end.
const SPIN_MS = 5000;
const SPIN_EASE = [0.05, 0.85, 0.2, 1.0];
const FLASH_MS = 900;        // duration of the white flash on the loser slice
const CALLOUT_HOLD_MS = 3400; // how long the "ELIMINATED" overlay sticks around

const polar = (angleDeg, r) => {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return [Math.cos(rad) * r, Math.sin(rad) * r];
};

const _hash = (s) => {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

// Deterministic per-team crimson tint — keeps colors stable across renders.
const tintFor = (entryId) => {
  const h = _hash(entryId);
  const light = 28 + (h % 22); // 28%–49%
  const hue = 350 + (h % 12) - 6;
  return `hsl(${hue}, 75%, ${light}%)`;
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

/**
 * One slice (path + clipped photo). Memoized by entryId + status flags so
 * mid-spin React re-renders triggered by the polling hook don't redecode
 * the base64 images on every poll, which is what made the wheel feel laggy.
 */
const Slice = memo(function Slice({ entry, index, sliceAngle, isElim, isWinner, isFlash }) {
  const [px, py] = polar(index * sliceAngle, (RADIUS + INNER) / 2);
  const clipId = `clip-${entry.id}`;
  const fill = isFlash
    ? "#FFFFFF"
    : isWinner
    ? "#FFD700"
    : isElim
    ? "#1A1416"
    : tintFor(entry.id);

  return (
    <g>
      <path
        d={slicePath(index, sliceAngle)}
        fill={fill}
        stroke="#0A0D0B"
        strokeWidth="2"
        style={{ transition: "fill 0.5s ease" }}
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
            opacity={isElim && !isWinner ? 0.32 : 1}
          />
        )}
        {isElim && !isWinner && (
          <>
            <circle r={PHOTO_R} fill="rgba(0,0,0,0.55)" />
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

/**
 * Tournament wheel. Renders a fixed-N pie wheel (N = total teams in the
 * tournament — angles never recompute mid-roll). Each new entry in
 * `roll.eliminated` triggers:
 *   1. A 5s spin landing the loser at 12 o'clock.
 *   2. A 900ms white flash + scale pulse on the loser slice.
 *   3. A big center "<TEAM> ELIMINATED" text reveal.
 */
export default function TournamentWheel({ roll, eliminatedSet }) {
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
        // Spin a healthy 5 full turns plus the offset to bring slice `idx`
        // to 12 o'clock. 5 turns at 5s reads as a real roulette spin.
        const target = -idx * sliceAngle;
        const base = 5 * 360;
        const cur = rotation % 360;
        const advance = base + (((target - cur) % 360) + 360) % 360;
        const next = rotation + advance;
        setRotation(next);

        const t1 = setTimeout(() => {
          setFlashId(loserId);
          setCalloutEntry(entries[idx]);
        }, SPIN_MS);
        const t2 = setTimeout(() => setFlashId(null), SPIN_MS + FLASH_MS);
        const t3 = setTimeout(() => setCalloutEntry(null), SPIN_MS + CALLOUT_HOLD_MS);
        return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
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

  // The pointer's spotlight wedge: a faint translucent triangle anchored
  // at the pointer that always shows what's currently under the arrow.
  const halfA = sliceAngle / 2;
  const [sx, sy] = polar(-halfA, RADIUS);
  const [ex, ey] = polar(halfA, RADIUS);
  const spotlightPath = `M 0 0 L ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 0 1 ${ex} ${ey} Z`;

  const calloutPhoto = calloutEntry?.image_data_url;

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

        <div className="relative w-full max-w-[480px]">
          <svg
            viewBox="-230 -230 460 460"
            className="w-full h-auto select-none"
            style={{ filter: "drop-shadow(0 0 32px rgba(255,51,102,0.4))" }}
          >
            <defs>
              <radialGradient id="hubGlow" cx="0" cy="0" r="0.5">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.45" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Outer rim ring (stationary) */}
            <circle r={RADIUS + 6} fill="none" stroke={ACCENT} strokeOpacity="0.3" strokeWidth="2" />

            {/* Rotating wheel group */}
            <motion.g
              animate={{ rotate: rotation }}
              transition={{ duration: SPIN_MS / 1000, ease: SPIN_EASE }}
              style={{ transformOrigin: "0 0", willChange: "transform" }}
            >
              {entries.map((e, i) => (
                <Slice
                  key={e.id}
                  entry={e}
                  index={i}
                  sliceAngle={sliceAngle}
                  isElim={eliminatedSet.has(e.id)}
                  isWinner={winnerId === e.id}
                  isFlash={flashId === e.id}
                />
              ))}
            </motion.g>

            {/* Spotlight wedge: stationary, anchored at top, shows what's
                currently under the pointer. Pulses softly so the user's
                eye is always drawn to the slice in the firing line. */}
            <motion.path
              d={spotlightPath}
              fill={ACCENT}
              animate={{ opacity: [0.14, 0.22, 0.14] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              style={{ pointerEvents: "none" }}
            />

            {/* Hub glow */}
            <circle r={INNER} fill="url(#hubGlow)" />
            {/* Hub disk */}
            <circle r={INNER - 6} fill="#0A0D0B" stroke={ACCENT} strokeWidth="2.5" />
            <circle r={INNER - 14} fill="none" stroke={`${ACCENT}66`} strokeWidth="1" />

            {/* Pointer at 12 o'clock — wiggles slightly so it feels alive */}
            <motion.polygon
              points={`0,${-RADIUS - 18} -16,${-RADIUS + 8} 16,${-RADIUS + 8}`}
              fill={ACCENT}
              stroke="#0A0D0B"
              strokeWidth="2"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />
          </svg>

          {/* Center elimination overlay — sits inside the SVG container.
              Big team photo + name + ELIMINATED. Held longer than the
              flash so it actually has a chance to read. */}
          <AnimatePresence>
            {calloutEntry && (
              <motion.div
                key={calloutEntry.id}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1.05] }}
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="flex flex-col items-center gap-2 px-5 py-4 rounded-sm"
                  style={{
                    backgroundColor: "rgba(10, 13, 11, 0.72)",
                    border: `2px solid ${ACCENT}`,
                    boxShadow: `0 0 50px ${ACCENT}99`,
                    backdropFilter: "blur(4px)",
                  }}
                >
                  {calloutPhoto && (
                    <div className="w-16 h-16 rounded-sm overflow-hidden border" style={{ borderColor: ACCENT }}>
                      <img src={calloutPhoto} alt={calloutEntry.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="font-display font-black text-xl md:text-2xl text-center text-white tracking-tight">
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

        <div className="mt-5 text-[10px] uppercase tracking-[0.3em] font-mono text-white/35">
          Pot · <span className="text-white/70">{(roll.pot_sol ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL</span>
        </div>
      </div>
    </div>
  );
}
