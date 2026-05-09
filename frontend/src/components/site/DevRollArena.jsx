import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Sparkles, Trophy, Clock, ExternalLink, Copy, Twitter, Skull } from "lucide-react";
import { useDevRoll } from "@/lib/useDevRoll";
import { useCountdown, pad } from "@/lib/useCountdown";
import { launchConfetti } from "@/lib/confetti";
import LastTeamStanding from "./LastTeamStanding";

// Crimson is the dev-roll signature color so it doesn't read as a duplicate of
// the gold main wheel.
const ACCENT = "#FF3366";

const truncWallet = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "—");
const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

const isWalletRoll = (roll) => (roll?.entry_type || "wallet") === "wallet";

const entryLabel = (entry) => {
  if (!entry) return "—";
  return entry.wallet ? truncWallet(entry.wallet) : (entry.name || "—");
};

// Build a {id -> entry} lookup once per roll change.
function useEntryMap(entries) {
  return useMemo(() => {
    const m = {};
    (entries || []).forEach((e) => { m[e.id] = e; });
    return m;
  }, [entries]);
}

// One-second tick state for live countdowns (next-elimination clocks etc.).
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatRemaining(ms) {
  if (ms <= 0) return "00:00";
  const totalSecs = Math.ceil(ms / 1000);
  if (totalSecs < 3600) {
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${pad(m)}:${pad(s)}`;
  }
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return `${h}h ${pad(m)}m`;
}

// EntryCard — renders either a wallet pill or a photo+name tile.
function EntryCard({ entry, size = "md", dim = false, accent = false }) {
  if (!entry) return null;
  const wallet = entry.wallet;
  const photo = entry.image_data_url;

  if (wallet) {
    const sizeClass = size === "lg"
      ? "px-5 py-4 text-base md:text-lg"
      : size === "sm"
      ? "px-2.5 py-1.5 text-[11px]"
      : "px-3 py-2 text-xs";
    return (
      <div
        className={`rounded-sm border bg-obsidian-900/60 font-mono text-white/80 ${sizeClass}`}
        style={{
          borderColor: accent ? ACCENT : "#ffffff10",
          color: accent ? ACCENT : undefined,
          opacity: dim ? 0.35 : 1,
        }}
      >
        {truncWallet(wallet)}
      </div>
    );
  }

  // Custom entry: photo + name.
  const tileSize = size === "lg" ? "w-32 h-32" : size === "sm" ? "w-12 h-12" : "w-20 h-20";
  return (
    <div
      className={`rounded-sm border bg-obsidian-900/60 p-2 flex flex-col items-center gap-1.5 ${dim ? "opacity-40" : ""}`}
      style={{ borderColor: accent ? ACCENT : "#ffffff10" }}
    >
      <div className={`${tileSize} overflow-hidden rounded-sm bg-obsidian-950`}>
        {photo ? <img src={photo} alt={entry.name} className="w-full h-full object-cover" /> : null}
      </div>
      <div
        className="font-mono text-xs text-white/85 truncate max-w-full"
        style={{ color: accent ? ACCENT : undefined }}
      >
        {entry.name}
      </div>
    </div>
  );
}

export default function DevRollArena() {
  const { roll, loading } = useDevRoll();
  const phase = roll?.phase || null;

  return (
    <section
      id="dev-roll"
      className="relative py-20 md:py-28 px-6 md:px-12 border-t border-crimson/10"
      data-testid="dev-roll-section"
    >
      <div className="max-w-[1400px] mx-auto">
        <DevSectionLabel mode={roll?.mode} />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter">
            {roll?.title
              ? <><span style={{ color: ACCENT }}>{roll.title}</span></>
              : <>Dev <span style={{ color: ACCENT }}>Roll.</span></>
            }
          </h2>
          <PhasePill phase={phase} mode={roll?.mode} />
        </div>

        <p className="text-white/55 max-w-2xl mb-10 text-base md:text-lg">
          Surprise rounds, off-cycle. The team can hand-pick a pool, set a pot,
          schedule a UTC timestamp — when it hits, the roll runs live.
          <span className="text-white/35"> &nbsp;Separate from the daily wheel.</span>
        </p>

        <AnimatePresence mode="wait">
          {!roll && !loading && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyState />
            </motion.div>
          )}
          {/* Last Team Standing tournament — own self-contained UX across
              scheduled / spinning / resolved phases. */}
          {roll && roll.is_tournament && (
            <motion.div key="tournament" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <LastTeamStanding roll={roll} />
            </motion.div>
          )}
          {roll && !roll.is_tournament && phase === "scheduled" && (
            <motion.div key="scheduled" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ScheduledView roll={roll} />
            </motion.div>
          )}
          {roll && !roll.is_tournament && phase === "spinning" && roll.mode === "elimination" && (
            <motion.div key="elimination" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <EliminationView roll={roll} />
            </motion.div>
          )}
          {roll && !roll.is_tournament && phase === "spinning" && roll.mode !== "elimination" && (
            <motion.div key="spinning" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <SpinningView roll={roll} />
            </motion.div>
          )}
          {roll && !roll.is_tournament && phase === "resolved" && (
            <motion.div key="resolved" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <ResolvedView roll={roll} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DevSectionLabel({ mode }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <div className="w-8 h-px" style={{ backgroundColor: ACCENT }} />
      <span className="text-[10px] uppercase tracking-[0.3em] font-mono font-bold" style={{ color: ACCENT }}>
        Dev Roll · {mode === "elimination" ? "Elimination" : "Off-cycle"}
      </span>
    </div>
  );
}

function PhasePill({ phase, mode }) {
  const configs = {
    null: { dot: "bg-white/30", text: "text-white/45", label: "NO ROLL SCHEDULED" },
    scheduled: { dot: "animate-pulse", text: "", label: "SCHEDULED" },
    spinning: {
      dot: "animate-ping", text: "",
      label: mode === "elimination" ? "ELIMINATING · LIVE" : "SPINNING · LIVE",
    },
    resolved: { dot: "", text: "", label: "WINNER ANNOUNCED" },
  };
  const key = phase ?? "null";
  const c = configs[key] || configs.null;
  const accent = phase ? ACCENT : undefined;
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-[11px] uppercase tracking-[0.2em] ${c.text}`}
      style={{
        borderColor: accent ? `${ACCENT}55` : "#ffffff20",
        color: accent || undefined,
      }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} style={{ backgroundColor: accent || undefined }} />
      {c.label}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="glass rounded-sm p-8 md:p-12 flex flex-col md:flex-row md:items-center md:justify-between gap-6" data-testid="dev-roll-empty">
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-sm flex items-center justify-center border"
          style={{ borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}10` }}
        >
          <Gift className="w-6 h-6" style={{ color: ACCENT }} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: ACCENT }}>
            Awaiting next dev roll
          </div>
          <div className="font-display font-bold text-xl text-white">
            No dev roll scheduled right now.
          </div>
        </div>
      </div>
      <div className="text-sm text-white/45 font-mono uppercase tracking-widest">
        Watch this space.
      </div>
    </div>
  );
}

function ScheduledView({ roll }) {
  const t = useCountdown(roll.scheduled_at);
  const entries = roll.entries || [];
  const isElim = roll.mode === "elimination";
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 glass rounded-sm p-7 md:p-10 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full blur-3xl" style={{ backgroundColor: `${ACCENT}10` }} />
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-4" style={{ color: ACCENT }}>
          {isElim ? "Eliminations begin in" : "Spins In"}
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
          Scheduled · {new Date(roll.scheduled_at).toUTCString()}
        </div>
      </div>

      <div className="glass rounded-sm p-7 md:p-8 flex flex-col justify-between" data-testid="dev-roll-pot">
        <div>
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
            Announced Pot
          </div>
          <div className="font-mono font-black text-4xl md:text-5xl tabular-nums tracking-tight" style={{ color: ACCENT }}>
            {fmtSol(roll.pot_sol)}
          </div>
          <div className="text-xs text-white/45 mt-2 font-mono">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"} in the pool
            {isElim ? " · last one standing" : " · 1 ticket each"}
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] font-mono text-white/35">
          {isElim ? <Skull className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
          {isElim ? "Survivor takes the pot" : "Equal odds · uniform random"}
        </div>
      </div>

      <div className="lg:col-span-3 glass rounded-sm p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-3">
          Entry Pool · {entries.length}
        </div>
        <div className={isWalletRoll(roll)
          ? "flex gap-2 overflow-x-auto scrollbar-hidden pb-2"
          : "grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-3"}
        >
          {entries.map((e) => (
            <div key={e.id} className="shrink-0">
              <EntryCard entry={e} size={isWalletRoll(roll) ? "md" : "md"} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SpinningView({ roll }) {
  const entries = useMemo(() => roll.entries || [], [roll.entries]);
  const [idx, setIdx] = useState(0);

  // Slot-machine tick: starts fast, slows down on a curve.
  useEffect(() => {
    if (entries.length === 0) return;
    let cancelled = false;
    let i = 0;
    const start = performance.now();
    const total = 9000; // matches DEV_SPIN_ANIMATION_SECS
    const step = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / total, 1);
      const delay = 40 + Math.pow(progress, 2.6) * 480;
      i = Math.floor(Math.random() * entries.length);
      setIdx(i);
      if (progress < 1) setTimeout(step, delay);
    };
    step();
    return () => { cancelled = true; };
  }, [entries.length]);

  const visible = useMemo(() => {
    if (entries.length === 0) return [];
    const out = [];
    for (let off = -2; off <= 2; off++) {
      const j = ((idx + off) % entries.length + entries.length) % entries.length;
      out.push({ off, entry: entries[j] });
    }
    return out;
  }, [idx, entries]);

  return (
    <div className="glass rounded-sm p-7 md:p-12 relative overflow-hidden" data-testid="dev-roll-spinning">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(60% 60% at 50% 50%, ${ACCENT}1A 0%, transparent 70%)` }}
      />
      <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-6 text-center" style={{ color: ACCENT }}>
        Spinning · Pot {fmtSol(roll.pot_sol)}
      </div>

      <div className="relative h-[320px] md:h-[380px] flex flex-col items-center justify-center gap-2 select-none">
        {visible.map(({ off, entry }) => {
          const isCenter = off === 0;
          const opacity = 1 - Math.abs(off) * 0.28;
          const scale = isCenter ? 1.0 : 0.85 - Math.abs(off) * 0.05;
          return (
            <motion.div
              key={`${off}-${entry?.id}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity, y: 0, scale }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{
                minWidth: 280,
                textAlign: "center",
                boxShadow: isCenter ? `0 0 32px ${ACCENT}40` : "none",
              }}
            >
              <div className="flex items-center justify-center">
                <EntryCard entry={entry} size={isCenter ? "lg" : "md"} accent={isCenter} />
              </div>
            </motion.div>
          );
        })}

        <div className="absolute inset-x-0 top-1/2 -translate-y-[34px] flex items-center justify-between px-4 pointer-events-none">
          <div className="w-3 h-3 rotate-45" style={{ backgroundColor: ACCENT }} />
          <div className="w-3 h-3 rotate-45" style={{ backgroundColor: ACCENT }} />
        </div>
      </div>

      <div className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] font-mono text-white/40">
        {entries.length} entries · uniform random · winner locks in shortly
      </div>
    </div>
  );
}

function EliminationView({ roll }) {
  const entries = roll.entries || [];
  const survivors = roll.survivors || [];
  const eliminated = roll.eliminated || [];
  const entryMap = useEntryMap(entries);
  const now = useNow(1000);

  const nextElimAt = roll.next_elimination_at ? new Date(roll.next_elimination_at).getTime() : null;
  const remaining = nextElimAt ? Math.max(0, nextElimAt - now) : 0;
  const interval = (roll.elimination_interval_secs || 0) * 1000;
  const progressPct = interval > 0 ? Math.min(100, Math.max(0, 100 - (remaining / interval) * 100)) : 0;

  return (
    <div className="space-y-4" data-testid="dev-roll-elimination">
      <div className="glass rounded-sm p-6 md:p-7 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(50% 80% at 50% 0%, ${ACCENT}18 0%, transparent 60%)` }}
        />
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 relative">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: ACCENT }}>
              <Skull className="w-3 h-3 inline -mt-0.5 mr-1.5" />
              Elimination in progress
            </div>
            <div className="font-display font-black text-3xl md:text-4xl tracking-tighter">
              <span style={{ color: ACCENT }}>{survivors.length}</span>
              <span className="text-white/40"> / {entries.length} </span>
              <span className="text-white/70 text-xl md:text-2xl">remaining</span>
            </div>
            <div className="text-[11px] font-mono text-white/45 mt-1">
              Pot · <span className="text-white/80">{fmtSol(roll.pot_sol)}</span>
            </div>
          </div>
          <div className="md:text-right">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-1">Next elimination in</div>
            <div className="font-mono font-black text-3xl md:text-5xl tabular-nums" style={{ color: ACCENT }}>
              {nextElimAt ? formatRemaining(remaining) : "—"}
            </div>
          </div>
        </div>
        {/* Progress bar — fills as the next-elim window elapses */}
        <div className="mt-5 h-1 bg-white/5 rounded-full overflow-hidden relative">
          <div
            className="h-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${progressPct}%`, backgroundColor: ACCENT }}
          />
        </div>
      </div>

      <div className="glass rounded-sm p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-4">
          Survivors
        </div>
        <SurvivorsGrid roll={roll} survivors={survivors} entryMap={entryMap} />
      </div>

      {eliminated.length > 0 && (
        <details className="glass rounded-sm p-6 group" open>
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-4 flex items-center justify-between">
            <span>Eliminated · {eliminated.length}</span>
            <span className="text-white/30 group-open:hidden">expand</span>
            <span className="text-white/30 hidden group-open:inline">collapse</span>
          </summary>
          <EliminatedRail eliminated={eliminated} entryMap={entryMap} />
        </details>
      )}
    </div>
  );
}

function SurvivorsGrid({ roll, survivors, entryMap }) {
  const isWallet = isWalletRoll(roll);
  return (
    <div className={isWallet
      ? "flex flex-wrap gap-2"
      : "grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 gap-3"}
    >
      <AnimatePresence>
        {survivors.map((id) => {
          const entry = entryMap[id];
          if (!entry) return null;
          return (
            <motion.div
              key={id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6, rotate: -8 }}
              transition={{ duration: 0.4 }}
            >
              <EntryCard entry={entry} size={isWallet ? "md" : "md"} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function EliminatedRail({ eliminated, entryMap }) {
  // Show most-recent elimination first.
  const sorted = useMemo(
    () => [...eliminated].sort((a, b) => b.position - a.position),
    [eliminated],
  );
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map((ev) => {
        const entry = entryMap[ev.entry_id];
        if (!entry) return null;
        return (
          <div key={ev.entry_id} className="relative">
            <div className="opacity-50 grayscale">
              <EntryCard entry={entry} size="sm" dim />
            </div>
            <div
              className="absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-sm font-mono text-[9px] tracking-widest"
              style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
              title={`Eliminated #${ev.position}`}
            >
              #{ev.position}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ResolvedView({ roll }) {
  const isWallet = isWalletRoll(roll);
  const winnerEntry = useMemo(() => {
    if (roll.winner_entry_id && roll.entries) {
      return roll.entries.find((e) => e.id === roll.winner_entry_id);
    }
    if (roll.winner && isWallet) {
      return { id: "legacy", wallet: roll.winner };
    }
    return null;
  }, [roll, isWallet]);

  const winnerWallet = winnerEntry?.wallet || null;
  const winnerName = winnerEntry?.name || (isWallet ? winnerEntry?.wallet : null);
  const explorer = winnerWallet ? `https://solscan.io/account/${winnerWallet}` : null;
  const canvasRef = useRef(null);

  useEffect(() => {
    const cleanup = launchConfetti(canvasRef.current, 4500);
    return () => cleanup?.();
  }, []);

  const shareText = isWallet
    ? `🏆 Just watched a $ROLLAT Dev Roll land on a winner — ${fmtSol(roll.pot_sol)} sent to one wallet.\n\nHold $ROLLAT, get auto-entered.\n\nrollat.vercel.app`
    : `🏆 ${winnerName} just won the $ROLLAT bracket — ${fmtSol(roll.pot_sol)} on the line.\n\nrollat.vercel.app`;

  return (
    <div
      className="glass rounded-sm p-8 md:p-12 relative overflow-hidden"
      style={{ borderColor: `${ACCENT}40` }}
      data-testid="dev-roll-winner"
    >
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 9999 }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(70% 60% at 50% 0%, ${ACCENT}24 0%, transparent 60%)` }}
      />
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative">
        <div className="flex items-center gap-5">
          {!isWallet && winnerEntry?.image_data_url && (
            <div className="shrink-0">
              <div className="w-28 h-28 md:w-36 md:h-36 rounded-sm overflow-hidden border-2" style={{ borderColor: ACCENT, boxShadow: `0 0 36px ${ACCENT}55` }}>
                <img src={winnerEntry.image_data_url} alt={winnerEntry.name} className="w-full h-full object-cover" />
              </div>
            </div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-3" style={{ color: ACCENT }}>
              <Trophy className="w-3 h-3 inline -mt-0.5 mr-1.5" />
              Dev Roll Winner
            </div>
            <div
              className="font-mono font-black text-2xl md:text-4xl break-all leading-tight"
              data-testid="dev-roll-winner-wallet"
            >
              {isWallet ? (winnerWallet || "—") : (winnerName || "—")}
            </div>
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              {winnerWallet && (
                <button
                  onClick={() => navigator.clipboard?.writeText(winnerWallet)}
                  className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45 hover:text-white"
                >
                  <Copy className="w-3 h-3" /> copy
                </button>
              )}
              {explorer && (
                <a
                  href={explorer}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45 hover:text-white"
                >
                  <ExternalLink className="w-3 h-3" /> solscan
                </a>
              )}
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-[10px] uppercase tracking-[0.2em] font-mono"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT }}
                data-testid="share-on-x"
              >
                <Twitter className="w-3 h-3" /> share on X
              </a>
            </div>
          </div>
        </div>
        <div className="md:text-right">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-2">Pot</div>
          <div className="font-mono font-black text-5xl md:text-6xl tabular-nums" style={{ color: ACCENT }}>
            {fmtSol(roll.pot_sol)}
          </div>
          <div className="text-xs text-white/40 mt-2 font-mono flex items-center gap-1.5 md:justify-end">
            <Clock className="w-3 h-3" />
            {roll.resolved_at ? new Date(roll.resolved_at).toUTCString() : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
