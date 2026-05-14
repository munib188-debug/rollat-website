import { memo, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull, Clock, Volume2, VolumeX, Users, Music } from "lucide-react";

// Crimson dev-roll accent.
const ACCENT = "#FF3366";

// Geometry — change these together to rescale the whole wheel.
const RADIUS = 200;
const INNER = 80;
const PHOTO_R = 26;
const BADGE_R = 14;          // backer-count badge radius

// Spin animation tuning.
const SPIN_MS = 5200;
const SPIN_EASE = [0.05, 0.85, 0.2, 1.0];
const FLASH_MS = 700;
const REVEAL_HOLD_MS = 3200;

// Audio toggle persists across sessions.
const AUDIO_KEY = "rollat_wheel_audio_enabled";

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

const sliceColor = (index, isElim, isWinner, isFlash) => {
  if (isFlash) return "#FFFFFF";
  if (isWinner) return "#FFD700";
  if (isElim) return "#1A1416";
  return index % 2 === 0 ? "#C2274D" : "#E0335F";
};

/**
 * Synthetic wheel audio via Web Audio API. Generates ticks + thunks on the
 * fly so we don't need any audio assets. Lazy-init on first interaction
 * because most browsers block autoplay AudioContexts otherwise.
 */
function useWheelAudio(enabled) {
  const ctxRef = useRef(null);

  const ensure = () => {
    if (!enabled) return null;
    if (!ctxRef.current) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        ctxRef.current = new Ctx();
      } catch {
        return null;
      }
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    return ctxRef.current;
  };

  const tick = () => {
    const ctx = ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1200;
    osc.type = "square";
    gain.gain.setValueAtTime(0.045, t);
    gain.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  };

  const thunk = () => {
    const ctx = ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Two layered tones: low body + mid-frequency click for impact.
    [
      { f: 90, type: "sine", v: 0.45, dur: 0.55 },
      { f: 280, type: "triangle", v: 0.18, dur: 0.18 },
    ].forEach(({ f, type, v, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = type;
      gain.gain.setValueAtTime(v, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  };

  return { tick, thunk };
}

/**
 * One slice + its backer badge + your-team highlight.  Memoized so polling
 * re-renders don't redecode base64 photos mid-spin.
 */
const Slice = memo(function Slice({
  entry, index, sliceAngle, isElim, isWinner, isFlash, isMine, backerCount,
}) {
  const [px, py] = polar(index * sliceAngle, (RADIUS + INNER) / 2);
  const [bx, by] = polar(index * sliceAngle, RADIUS - 22);  // badge near rim
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
      {isMine && !isElim && !isWinner && (
        // Inner gold ring around the user's team's photo so they can spot
        // themselves on the wheel at a glance.
        <g transform={`translate(${px} ${py})`}>
          <circle r={PHOTO_R + 6} fill="none" stroke="#FFD700" strokeWidth="3" opacity="0.9" />
          <circle r={PHOTO_R + 10} fill="none" stroke="#FFD700" strokeWidth="1" opacity="0.4" />
        </g>
      )}
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

      {/* Backer count badge — near the rim, on the same radial line as the
          slice center. Hidden when the slice is eliminated to reduce noise. */}
      {!isElim && backerCount > 0 && (
        <g transform={`translate(${bx} ${by})`}>
          <circle r={BADGE_R} fill="#0A0D0B" stroke={isMine ? "#FFD700" : "#FFFFFF"} strokeWidth="1.5" />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="13"
            fontFamily="ui-monospace, monospace"
            fontWeight="800"
            fill={isMine ? "#FFD700" : "#FFFFFF"}
          >
            {backerCount > 99 ? "99+" : backerCount}
          </text>
        </g>
      )}
    </g>
  );
});

// Hub countdown / status display — sits in the donut hole when idle.
function HubStatus({ remainingMs, spinning, calloutEntry }) {
  if (calloutEntry) return null;
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
  const totalSecs = Math.max(0, Math.ceil(remainingMs / 1000));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const display = h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}:${pad(s)}`;
  return (
    <foreignObject x={-INNER + 6} y={-INNER + 6} width={(INNER - 6) * 2} height={(INNER - 6) * 2}>
      <div className="w-full h-full flex flex-col items-center justify-center">
        <div className="text-[8px] font-mono uppercase tracking-[0.25em] text-white/40 mb-1">NEXT IN</div>
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
 */
export default function TournamentWheel({
  roll, eliminatedSet, supportersByTeam = {}, myTeamId = null,
}) {
  // Stable entries identity (Slice memo would otherwise bust on every poll).
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
  const [pendingLoserId, setPendingLoserId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [calloutEntry, setCalloutEntry] = useState(null);
  const lastElimCountRef = useRef(roll.eliminated?.length || 0);

  const [audioOn, setAudioOn] = useState(() => {
    try { return localStorage.getItem(AUDIO_KEY) !== "0"; } catch { return true; }
  });
  const audio = useWheelAudio(audioOn);

  // Background music — starts paused (muted-by-default). User must click to
  // play; this sidesteps browser autoplay policy cleanly.
  const musicRef = useRef(null);
  const [musicOn, setMusicOn] = useState(false);
  useEffect(() => {
    const el = musicRef.current;
    if (!el) return;
    if (musicOn) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [musicOn]);

  const confettiCanvasRef = useRef(null);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const nextElimMs = roll.next_elimination_at
    ? new Date(roll.next_elimination_at).getTime()
    : null;
  const remainingMs = nextElimMs ? Math.max(0, nextElimMs - now) : 0;
  const intervalMs = (roll.elimination_interval_secs || 0) * 1000;

  // Anticipation: rim opacity + pulse speed scale with how close we are to
  // the next tick. `tension` ranges 0 (just ticked, all calm) → 1 (T-zero).
  const tension = intervalMs > 0
    ? 1 - Math.min(1, Math.max(0, remainingMs / intervalMs))
    : 0;
  const rimOpacity = 0.25 + tension * 0.65;
  const rimPulseDur = 1.6 - tension * 1.2;            // 1.6s → 0.4s as tension peaks
  const rimGlow = 18 + tension * 36;                  // 18px → 54px

  // React to a new elimination event from the server.
  useEffect(() => {
    const count = roll.eliminated?.length || 0;
    if (count > lastElimCountRef.current && N > 0) {
      const newest = roll.eliminated[count - 1];
      const loserId = newest?.entry_id;
      const idx = entries.findIndex((e) => e.id === loserId);
      if (idx >= 0) {
        setPendingLoserId(loserId);
        setSpinning(true);
        const target = -idx * sliceAngle;
        const base = 5 * 360;
        const cur = rotation % 360;
        const advance = base + (((target - cur) % 360) + 360) % 360;
        setRotation(rotation + advance);

        // Schedule audio ticks across the spin — bunched at the start, sparse
        // at the end, mirroring the cubic ease-out so it feels like the
        // wheel is decelerating.
        const tickTimers = [];
        if (audioOn) {
          const totalTicks = Math.min(40, Math.max(15, N * 5));
          for (let k = 1; k <= totalTicks; k++) {
            const t = SPIN_MS * (1 - Math.pow(1 - k / totalTicks, 1 / 3));
            tickTimers.push(setTimeout(audio.tick, t));
          }
        }

        const tStop = setTimeout(() => {
          setSpinning(false);
          setFlashId(loserId);
          setCalloutEntry(entries[idx]);
          if (audioOn) audio.thunk();
          // Confetti burst from the pointer area.
          launchSliceConfetti(confettiCanvasRef.current);
        }, SPIN_MS);
        const tFlash = setTimeout(() => setFlashId(null), SPIN_MS + FLASH_MS);
        const tDone = setTimeout(() => {
          setCalloutEntry(null);
          setPendingLoserId(null);
        }, SPIN_MS + REVEAL_HOLD_MS);

        return () => {
          tickTimers.forEach(clearTimeout);
          clearTimeout(tStop);
          clearTimeout(tFlash);
          clearTimeout(tDone);
        };
      }
    }
    lastElimCountRef.current = count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roll.eliminated?.length]);

  const survivorsRemaining = useMemo(
    () => entries.filter((e) => !eliminatedSet.has(e.id)).length,
    [entries, eliminatedSet],
  );

  const toggleAudio = () => {
    setAudioOn((prev) => {
      const next = !prev;
      try { localStorage.setItem(AUDIO_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const toggleMusic = () => setMusicOn((prev) => !prev);

  if (N === 0) return null;

  const halfA = sliceAngle / 2;
  const [sx, sy] = polar(-halfA, RADIUS);
  const [ex, ey] = polar(halfA, RADIUS);
  const spotlightPath = `M 0 0 L ${sx} ${sy} A ${RADIUS} ${RADIUS} 0 0 1 ${ex} ${ey} Z`;

  return (
    <div
      className="glass rounded-sm p-4 sm:p-6 md:p-10 relative overflow-hidden"
      data-testid="tournament-wheel"
    >
      {/* Hidden audio element for background music. src is only set when
          music_url is present so the browser never tries to load undefined. */}
      {roll.music_url && (
        <audio ref={musicRef} src={roll.music_url} loop preload="none" />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)` }}
      />
      <div className="relative flex flex-col items-center">
        {/* Status row — stacks vertically on narrow screens */}
        <div className="w-full max-w-[480px] mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
              <Skull className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Eliminating
            </div>
            <div className="font-display font-black text-2xl md:text-3xl">
              <span style={{ color: ACCENT }}>{survivorsRemaining}</span>
              <span className="text-white/35"> / {N}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-left sm:text-right">
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1 text-white/40">
                <Clock className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Next elim
              </div>
              <div className="font-mono font-black text-2xl md:text-3xl tabular-nums" style={{ color: ACCENT }}>
                {spinning ? "—" : nextElimMs ? formatRemaining(remainingMs) : "—"}
              </div>
            </div>
            <button
              onClick={toggleAudio}
              className="ml-2 p-2 rounded-sm border text-white/60 hover:text-white"
              style={{ borderColor: "#ffffff20", backgroundColor: "rgba(0,0,0,0.25)" }}
              aria-label={audioOn ? "Mute wheel" : "Unmute wheel"}
              title={audioOn ? "Mute wheel sounds" : "Unmute wheel sounds"}
            >
              {audioOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            {roll.music_url && (
              <button
                onClick={toggleMusic}
                className="p-2 rounded-sm border hover:text-white transition-colors"
                style={{
                  borderColor: musicOn ? `${ACCENT}55` : "#ffffff20",
                  backgroundColor: musicOn ? `${ACCENT}22` : "rgba(0,0,0,0.25)",
                  color: musicOn ? ACCENT : "rgba(255,255,255,0.6)",
                }}
                aria-label={musicOn ? "Pause music" : "Play background music"}
                title={musicOn ? "Pause background music" : "Play background music (muted by default)"}
              >
                <Music className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Wheel */}
        <div className="relative w-full max-w-[480px]">
          <svg
            viewBox="-240 -240 480 480"
            className="w-full h-auto select-none"
            style={{ filter: `drop-shadow(0 0 ${rimGlow}px rgba(255,51,102,${0.35 + tension * 0.45}))` }}
          >
            <defs>
              <radialGradient id="hubGlow" cx="0" cy="0" r="0.5">
                <stop offset="0%" stopColor={ACCENT} stopOpacity="0.45" />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
              <radialGradient id="bgGlow" cx="0" cy="0" r="0.6">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.05 + tension * 0.1} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle r={RADIUS + 28} fill="url(#bgGlow)" />
            {/* Outer rim ring — pulses with anticipation. Brighter and faster
                near T=0, calm during the wide stretch of an interval. */}
            <motion.circle
              r={RADIUS + 8}
              fill="none"
              stroke={ACCENT}
              strokeWidth="2"
              animate={{ opacity: [rimOpacity * 0.6, rimOpacity, rimOpacity * 0.6] }}
              transition={{ duration: rimPulseDur, repeat: Infinity, ease: "easeInOut" }}
            />
            <circle r={RADIUS + 14} fill="none" stroke={ACCENT} strokeOpacity="0.12" strokeWidth="1" />

            {/* Rotating wheel group */}
            <motion.g
              animate={{ rotate: rotation }}
              transition={{ duration: SPIN_MS / 1000, ease: SPIN_EASE }}
              style={{ transformOrigin: "0 0", willChange: "transform" }}
            >
              {entries.map((e, i) => {
                const isFinallyElim = eliminatedSet.has(e.id);
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
                    isMine={myTeamId === e.id}
                    backerCount={supportersByTeam[e.id] ?? 0}
                  />
                );
              })}
            </motion.g>

            {/* Spotlight wedge */}
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

            <HubStatus remainingMs={remainingMs} spinning={spinning} calloutEntry={calloutEntry} />

            {/* Pointer at 12 o'clock — apex points DOWN at the rim. */}
            <motion.polygon
              points={`0,${-RADIUS + 6} -18,${-RADIUS - 22} 18,${-RADIUS - 22}`}
              fill={ACCENT}
              stroke="#0A0D0B"
              strokeWidth="2"
              animate={{ y: [0, 2, 0] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            />

            {/* Ticker pin: a small flap immediately under the pointer apex
                that wiggles continuously while the wheel is spinning. Visual
                proxy for "ticking against passing slices". */}
            <motion.rect
              x={-3}
              y={-RADIUS + 4}
              width={6}
              height={14}
              rx={1.5}
              fill="#FFFFFF"
              stroke="#0A0D0B"
              strokeWidth="1"
              animate={
                spinning
                  ? { rotate: [-22, 22, -22], transition: { duration: 0.08, repeat: Infinity, ease: "easeInOut" } }
                  : { rotate: 0 }
              }
              style={{ transformOrigin: `0px ${-RADIUS + 4}px` }}
            />
          </svg>

          {/* Confetti canvas overlay (small, positioned over the wheel only). */}
          <canvas
            ref={confettiCanvasRef}
            className="absolute inset-0 pointer-events-none"
            width={480}
            height={480}
          />

          {/* Center elimination overlay */}
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
                  className="flex flex-col items-center gap-2 px-4 sm:px-6 py-4 sm:py-5 rounded-sm"
                  style={{
                    backgroundColor: "rgba(10, 13, 11, 0.78)",
                    border: `2px solid ${ACCENT}`,
                    boxShadow: `0 0 60px ${ACCENT}AA`,
                    backdropFilter: "blur(6px)",
                  }}
                >
                  {calloutEntry.image_data_url && (
                    <div className="w-16 sm:w-20 h-16 sm:h-20 rounded-sm overflow-hidden border-2" style={{ borderColor: ACCENT }}>
                      <img src={calloutEntry.image_data_url} alt={calloutEntry.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="font-display font-black text-xl sm:text-2xl md:text-3xl text-center text-white tracking-tight">
                    {calloutEntry.name}
                  </div>
                  <div
                    className="font-display font-black text-xs sm:text-sm md:text-base uppercase tracking-[0.3em]"
                    style={{ color: ACCENT }}
                  >
                    💀 Eliminated
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center gap-4 text-[10px] uppercase tracking-[0.3em] font-mono text-white/35">
          <span>
            Pot ·{" "}
            <span className="text-white/70">
              {(roll.pot_sol ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL
            </span>
          </span>
          {myTeamId && (
            <span style={{ color: "#FFD700" }} className="flex items-center gap-1">
              <Users className="w-3 h-3" /> your team is in the wheel
            </span>
          )}
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

/**
 * Small crimson confetti burst from the top-center of the canvas (where the
 * pointer sits). Self-contained — doesn't depend on confetti.js so the
 * positioning is precise to the wheel.
 */
function launchSliceConfetti(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const originX = W / 2;
  const originY = H * 0.08; // pointer area, near top
  const colors = ["#FF3366", "#FF668C", "#FFA0B5", "#FFD700"];
  const particles = Array.from({ length: 60 }, () => {
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.4; // upward-ish cone
    const speed = 4 + Math.random() * 7;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: 3 + Math.random() * 4,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.3,
      life: 1,
      decay: 0.012 + Math.random() * 0.012,
    };
  });

  let raf;
  const loop = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      if (p.life <= 0) continue;
      alive = true;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22;            // gravity
      p.vx *= 0.99;            // air drag
      p.rot += p.vrot;
      p.life -= p.decay;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.5);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(loop);
    else ctx.clearRect(0, 0, W, H);
  };
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}
