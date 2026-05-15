import { useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

const CHIP_LINES = [
  { x1: 0, y1: 33, x2: 100, y2: 33 },
  { x1: 0, y1: 66, x2: 100, y2: 66 },
  { x1: 33, y1: 0, x2: 33, y2: 100 },
  { x1: 66, y1: 0, x2: 66, y2: 100 },
];

function GoldChip() {
  return (
    <svg width="44" height="34" viewBox="0 0 100 100" className="opacity-90">
      <rect x="8" y="8" width="84" height="84" rx="12" fill="url(#chipGrad)" stroke="#c8a84b" strokeWidth="2" />
      {CHIP_LINES.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#8a6a1a" strokeWidth="1.5" strokeOpacity="0.6" />
      ))}
      <rect x="20" y="20" width="60" height="60" rx="6" fill="none" stroke="#c8a84b" strokeWidth="1.5" strokeOpacity="0.5" />
      <defs>
        <linearGradient id="chipGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c8a84b" />
          <stop offset="40%" stopColor="#f5d680" />
          <stop offset="70%" stopColor="#b8922a" />
          <stop offset="100%" stopColor="#e0c060" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RollatLogo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="28" stroke="#FFD700" strokeWidth="2.5" />
      <circle cx="32" cy="6.5" r="3.2" fill="#FFD700" />
      <text x="32" y="42" textAnchor="middle"
        fontFamily="Unbounded, Inter, system-ui, sans-serif"
        fontWeight="900" fontSize="30" fill="#FFFFFF"
        letterSpacing="-1">R</text>
    </svg>
  );
}

export default function RollatCard({ wallet, className = "" }) {
  const cardRef = useRef(null);
  const [hovered, setHovered] = useState(false);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [10, -10]), { stiffness: 200, damping: 30 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-10, 10]), { stiffness: 200, damping: 30 });
  const glareX = useTransform(mouseX, [-0.5, 0.5], ["0%", "100%"]);
  const glareY = useTransform(mouseY, [-0.5, 0.5], ["0%", "100%"]);

  function handleMouseMove(e) {
    const rect = cardRef.current.getBoundingClientRect();
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5);
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function handleMouseLeave() {
    mouseX.set(0);
    mouseY.set(0);
    setHovered(false);
  }

  const displayWallet = wallet
    ? `${wallet.slice(0, 6)}···${wallet.slice(-4)}`
    : "XXXX···XXXX";

  return (
    <div className={`perspective-[1200px] ${className}`} style={{ perspective: "1200px" }}>
      <motion.div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={handleMouseLeave}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="relative select-none cursor-default"
        /* credit-card ratio 85.6 × 54 mm → ~1.586:1 */
        data-testid="rollat-card"
      >
        {/* Card body */}
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            width: "340px",
            height: "214px",
            background: "linear-gradient(145deg, #0d0d0d 0%, #111111 40%, #0a0a0a 70%, #141414 100%)",
            boxShadow: hovered
              ? "0 32px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,215,0,0.25), 0 0 60px rgba(255,215,0,0.08)"
              : "0 20px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,215,0,0.12)",
            transition: "box-shadow 0.3s ease",
          }}
        >
          {/* Subtle brushed-metal texture overlay */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)",
            }}
          />

          {/* Inner gold border glow */}
          <div
            className="absolute inset-0 rounded-2xl"
            style={{
              boxShadow: "inset 0 0 0 1px rgba(255,215,0,0.18), inset 0 1px 0 rgba(255,215,0,0.35)",
            }}
          />

          {/* Top-left diagonal accent line */}
          <div
            className="absolute top-0 left-0"
            style={{
              width: "200px",
              height: "200px",
              background:
                "linear-gradient(135deg, rgba(255,215,0,0.06) 0%, transparent 50%)",
              borderRadius: "0 0 100% 0",
            }}
          />

          {/* Bottom-right diagonal accent */}
          <div
            className="absolute bottom-0 right-0"
            style={{
              width: "140px",
              height: "140px",
              background:
                "linear-gradient(315deg, rgba(255,215,0,0.04) 0%, transparent 60%)",
              borderRadius: "100% 0 0 0",
            }}
          />

          {/* Holographic shimmer on hover */}
          <motion.div
            className="absolute inset-0 rounded-2xl pointer-events-none"
            style={{
              background: useTransform(
                [glareX, glareY],
                ([x, y]) =>
                  `radial-gradient(ellipse at ${x} ${y}, rgba(255,215,0,0.12) 0%, rgba(255,200,50,0.05) 30%, transparent 65%)`
              ),
              opacity: hovered ? 1 : 0,
              transition: "opacity 0.3s",
            }}
          />

          {/* — CARD CONTENT — */}
          <div className="relative h-full flex flex-col justify-between p-6">

            {/* TOP ROW: wordmark left · logo right */}
            <div className="flex items-start justify-between">
              <div>
                <div
                  className="text-[10px] uppercase tracking-[0.35em] font-mono mb-0.5"
                  style={{ color: "rgba(255,215,0,0.55)" }}
                >
                  On-Chain Roulette
                </div>
                <div
                  className="font-black tracking-tight leading-none"
                  style={{
                    fontFamily: "Unbounded, Inter, system-ui, sans-serif",
                    fontSize: "22px",
                    background: "linear-gradient(135deg, #f5d680 0%, #FFD700 45%, #c8a84b 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  ROLLAT
                </div>
              </div>

              {/* Logo — top right */}
              <div style={{ transform: "translateZ(8px)" }}>
                <RollatLogo size={40} />
              </div>
            </div>

            {/* MIDDLE: chip + roulette dots row */}
            <div className="flex items-center gap-5">
              <GoldChip />

              {/* Decorative roulette pocket dots */}
              <div className="flex items-center gap-1.5 opacity-30">
                {["#DC143C", "#111", "#DC143C", "#111", "#111"].map((c, i) => (
                  <div
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: c === "#111" ? "rgba(255,255,255,0.2)" : c,
                      border: "1px solid rgba(255,215,0,0.2)",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* BOTTOM ROW */}
            <div className="flex items-end justify-between">
              <div>
                {wallet && (
                  <div
                    className="font-mono text-[11px] tracking-[0.18em] mb-1"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  >
                    {displayWallet}
                  </div>
                )}
                <div
                  className="text-[9px] uppercase tracking-[0.3em] font-mono"
                  style={{ color: "rgba(255,215,0,0.4)" }}
                >
                  Hold · Spin · Win
                </div>
              </div>

              {/* Solana network badge */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                style={{
                  border: "1px solid rgba(153,69,255,0.35)",
                  background: "rgba(153,69,255,0.08)",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#9945FF",
                    boxShadow: "0 0 6px #9945FF",
                  }}
                />
                <span
                  className="text-[9px] uppercase tracking-[0.25em] font-mono"
                  style={{ color: "rgba(153,69,255,0.8)" }}
                >
                  Solana
                </span>
              </div>
            </div>
          </div>

          {/* Edge gloss line top */}
          <div
            className="absolute top-0 left-6 right-6 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,215,0,0.4) 30%, rgba(255,255,255,0.15) 50%, rgba(255,215,0,0.4) 70%, transparent)",
            }}
          />
        </div>

        {/* Card shadow depth layer */}
        <div
          className="absolute inset-x-4 -bottom-3 rounded-2xl -z-10"
          style={{
            height: "100%",
            background: "linear-gradient(to bottom, #0a0a0a, transparent)",
            filter: "blur(16px)",
            opacity: 0.6,
            transform: "translateZ(-20px)",
          }}
        />
      </motion.div>
    </div>
  );
}
