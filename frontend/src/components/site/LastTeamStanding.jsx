import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull, Trophy, Users, X, Wallet, Twitter, Check, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useCountdown, pad } from "@/lib/useCountdown";
import { useTournamentSupporters } from "@/lib/useTournamentSupporters";
import WalletPicker from "./WalletPicker";
import TournamentWheel from "./TournamentWheel";
import TournamentResolved from "./TournamentResolved";

const ACCENT = "#FF3366";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

const truncWallet = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "—");

/**
 * Public Last Team Standing experience. Renders for any dev roll where
 * `is_tournament=true`, replacing the regular ScheduledView / EliminationView
 * / ResolvedView.
 */
export default function LastTeamStanding({ roll }) {
  const phase = roll?.phase;
  const { publicKey } = useWallet();
  const myAddr = publicKey?.toBase58() || null;

  const { teams, total, my, reload } = useTournamentSupporters({
    rollId: roll.id,
    phase,
    wallet: myAddr,
  });

  // Map team_entry_id → entry for quick lookups in the grid.
  const entryMap = useMemo(() => {
    const m = {};
    (roll.entries || []).forEach((e) => { m[e.id] = e; });
    return m;
  }, [roll.entries]);

  // For each team, precompute supporter count + whether eliminated.
  const eliminatedSet = useMemo(
    () => new Set((roll.eliminated || []).map((ev) => ev.entry_id)),
    [roll.eliminated],
  );

  const supportersByTeam = useMemo(() => {
    const m = {};
    (teams || []).forEach((t) => { m[t.team_entry_id] = t.supporter_count; });
    return m;
  }, [teams]);

  // Sign-up modal state
  const [signupOpen, setSignupOpen] = useState(false);
  const [signupTeamId, setSignupTeamId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Defer the resolved-view transition until the wheel's final spin + reveal
  // animation completes. Without this, the moment the last 2 → 1 elimination
  // tick lands the wheel unmounts and the user sees the winner card with no
  // wheel animation in between. We wait `WHEEL_REVEAL_HOLD_MS` after the
  // most recent elimination event before flipping to the resolved view.
  const WHEEL_REVEAL_HOLD_MS = 9000; // SPIN_MS (5.2s) + reveal hold (3.4s) + small buffer
  const [resolvedReady, setResolvedReady] = useState(phase === "resolved");
  const lastElimCountRef = useRef(roll.eliminated?.length || 0);

  useEffect(() => {
    const count = roll.eliminated?.length || 0;
    if (phase === "resolved") {
      if (count > lastElimCountRef.current) {
        // Fresh resolve — keep the wheel showing while it animates out.
        setResolvedReady(false);
        const t = setTimeout(() => setResolvedReady(true), WHEEL_REVEAL_HOLD_MS);
        lastElimCountRef.current = count;
        return () => clearTimeout(t);
      }
      // Page reload after the resolution already happened — show winner immediately.
      setResolvedReady(true);
    } else {
      setResolvedReady(false);
    }
    lastElimCountRef.current = count;
  }, [phase, roll.eliminated?.length]);

  // NOTE: hooks must run in the same order on every render — the
  // teamsBelowCap useMemo lives BEFORE the early return below.
  const minBackers = roll.min_backers_per_team || 0;
  const teamsBelowCap = useMemo(() => {
    if (minBackers <= 0 || !roll.entries) return [];
    return roll.entries
      .map((e) => ({ entry: e, count: supportersByTeam[e.id] ?? 0 }))
      .filter((t) => t.count < minBackers);
  }, [roll.entries, supportersByTeam, minBackers]);

  if (phase === "resolved" && resolvedReady) {
    return <TournamentResolved roll={roll} />;
  }

  // Should we keep the wheel mounted? Yes during spin AND during the
  // post-final-tick window where phase == resolved but the animation
  // hasn't played out yet.
  const showWheel = phase === "spinning" || (phase === "resolved" && !resolvedReady);

  const scheduledMs = roll.scheduled_at ? new Date(roll.scheduled_at).getTime() : null;
  const scheduledPassed = scheduledMs ? Date.now() >= scheduledMs : false;
  const waitingForBackers = phase === "scheduled" && scheduledPassed && teamsBelowCap.length > 0;

  return (
    <>
      <div className="space-y-6" data-testid="last-team-standing">
        <Banner roll={roll} totalSupporters={total} />

        {phase === "scheduled" && !waitingForBackers && (
          <ScheduledCountdown roll={roll} minBackers={minBackers} />
        )}
        {waitingForBackers && (
          <WaitingForBackers
            minBackers={minBackers}
            teamsBelowCap={teamsBelowCap}
          />
        )}

        {my && (
          <MyStatusPill
            roll={roll}
            entry={entryMap[my.team_entry_id]}
            eliminated={my.eliminated}
            myAddr={myAddr}
            xHandle={my.x_handle}
          />
        )}

        {showWheel && (
          <TournamentWheel
            roll={roll}
            eliminatedSet={eliminatedSet}
            supportersByTeam={supportersByTeam}
            myTeamId={my?.team_entry_id || null}
          />
        )}

        <TeamGrid
          roll={roll}
          phase={phase}
          entries={roll.entries || []}
          supportersByTeam={supportersByTeam}
          eliminatedSet={eliminatedSet}
          mySignup={my}
          onBack={(teamId) => {
            if (phase !== "scheduled") return;
            if (!myAddr) { setPickerOpen(true); return; }
            setSignupTeamId(teamId);
            setSignupOpen(true);
          }}
        />
      </div>

      <SignupModal
        open={signupOpen}
        onClose={() => setSignupOpen(false)}
        roll={roll}
        teamId={signupTeamId}
        team={signupTeamId ? entryMap[signupTeamId] : null}
        wallet={myAddr}
        onConnectWallet={() => setPickerOpen(true)}
        onSuccess={async () => {
          setSignupOpen(false);
          await reload();
          toast.success("You're in. Cheer for your team.");
        }}
      />

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}

function Banner({ roll, totalSupporters }) {
  const teamCount = (roll.entries || []).length;
  return (
    <div
      className="glass rounded-sm p-7 md:p-8 relative overflow-hidden"
      style={{ borderColor: `${ACCENT}30` }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(70% 80% at 50% 0%, ${ACCENT}1F 0%, transparent 60%)` }}
      />
      <div className="relative">
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: ACCENT }}>
          <Skull className="w-3 h-3 inline -mt-0.5 mr-1.5" /> Last Team Standing
        </div>
        <h3 className="font-display font-black text-2xl md:text-3xl tracking-tighter mb-3">
          {teamCount} teams enter. <span style={{ color: ACCENT }}>One survives.</span>
        </h3>
        <p className="text-white/60 max-w-2xl text-sm md:text-base">
          Pick the team you believe will outlast the others. When a team is eliminated,
          their supporters fall with them. The pot — <span className="text-white">{fmtSol(roll.pot_sol)}</span> —
          gets split between the surviving team's backers.
        </p>
        <div className="flex items-center gap-4 mt-4 text-[11px] font-mono uppercase tracking-widest text-white/45">
          <span><Users className="w-3 h-3 inline -mt-0.5 mr-1" /> {totalSupporters} backer{totalSupporters === 1 ? "" : "s"}</span>
          <span className="text-white/20">·</span>
          <span>Pot · <span style={{ color: ACCENT }}>{fmtSol(roll.pot_sol)}</span></span>
        </div>
      </div>
    </div>
  );
}

function ScheduledCountdown({ roll, minBackers }) {
  const t = useCountdown(roll.scheduled_at);
  return (
    <div className="glass rounded-sm p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/45 mb-1">
          Wheel starts (sign-ups close)
        </div>
        <div className="text-xs text-white/55">{new Date(roll.scheduled_at).toUTCString()}</div>
        {minBackers > 0 && (
          <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-gold/80 mt-2">
            Min {minBackers} backer{minBackers === 1 ? "" : "s"} per team — start is held until met
          </div>
        )}
      </div>
      <div className="flex items-end gap-3 font-mono">
        {[
          { label: "DAYS", v: t.d },
          { label: "HRS", v: t.h },
          { label: "MIN", v: t.m },
          { label: "SEC", v: t.s },
        ].map((c, i) => (
          <div key={c.label} className="flex items-end gap-2">
            <div className="text-center">
              <div className="text-[9px] tracking-[0.25em] text-white/35 mb-0.5">{c.label}</div>
              <div className="text-2xl md:text-3xl font-black tabular-nums" style={{ color: ACCENT }}>
                {pad(c.v)}
              </div>
            </div>
            {i < 3 && <span className="text-xl text-white/20 pb-1">:</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Shown when the scheduled start time has arrived but the per-team backer
 * cap isn't met yet — the backend is holding the start until conditions
 * are met. We list which teams still need backers.
 */
function WaitingForBackers({ minBackers, teamsBelowCap }) {
  return (
    <div
      className="rounded-sm p-5 md:p-6 border bg-gold/[0.04]"
      style={{ borderColor: "#FFD70055" }}
      data-testid="waiting-for-backers"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-sm flex items-center justify-center bg-gold/15">
          <Clock className="w-4 h-4" style={{ color: "#FFD700" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-1" style={{ color: "#FFD700" }}>
            Waiting for backers
          </div>
          <div className="font-display font-bold text-lg md:text-xl text-white tracking-tight mb-1">
            Start is held until every team reaches {minBackers} backer{minBackers === 1 ? "" : "s"}.
          </div>
          <div className="text-[12px] text-white/55 mb-4">
            Sign-ups are still open below. The wheel auto-fires the moment the
            cap is met.
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {teamsBelowCap.map(({ entry, count }) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 p-2 rounded-sm bg-obsidian-950/60 border border-white/10"
              >
                {entry.image_data_url && (
                  <div className="w-8 h-8 rounded-sm overflow-hidden bg-obsidian-950 shrink-0">
                    <img src={entry.image_data_url} alt={entry.name} className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-xs text-white truncate">{entry.name}</div>
                  <div className="font-mono text-[10px] text-white/55">
                    <span style={{ color: "#FFD700" }}>{count}</span>
                    <span className="text-white/35"> / {minBackers}</span>
                  </div>
                </div>
                <AlertTriangle className="w-3 h-3 text-gold/60 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MyStatusPill({ roll, entry, eliminated, myAddr, xHandle }) {
  const phase = roll.phase;
  const isWinner =
    phase === "resolved" && roll.winner_entry_id && entry?.id === roll.winner_entry_id;
  let label, color, bg;
  if (isWinner) {
    label = "🏆 YOUR TEAM WON";
    color = "#FFD700";
    bg = "#FFD70015";
  } else if (eliminated) {
    label = "💀 Your team was eliminated";
    color = "#888";
    bg = "#ffffff08";
  } else {
    label = "✓ Backing this team";
    color = ACCENT;
    bg = `${ACCENT}15`;
  }
  return (
    <div
      className="rounded-sm px-4 py-3 border flex items-center gap-3 text-sm"
      style={{ borderColor: `${color}55`, backgroundColor: bg }}
      data-testid="my-status"
    >
      {entry?.image_data_url && (
        <div className="w-10 h-10 rounded-sm overflow-hidden bg-obsidian-950 shrink-0">
          <img src={entry.image_data_url} alt={entry.name} className="w-full h-full object-cover" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-widest" style={{ color }}>
          {label}
        </div>
        <div className="text-white truncate">{entry?.name || "—"}</div>
      </div>
      <div className="hidden md:block text-right text-[11px] font-mono text-white/45">
        <div>@{xHandle}</div>
        <div className="text-white/30">{truncWallet(myAddr)}</div>
      </div>
    </div>
  );
}

function TeamGrid({
  roll, phase, entries, supportersByTeam, eliminatedSet, mySignup, onBack,
}) {
  const winnerId = phase === "resolved" ? roll.winner_entry_id : null;
  const canSignup = phase === "scheduled";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4" data-testid="team-grid">
      <AnimatePresence>
        {entries.map((e) => {
          const isEliminated = eliminatedSet.has(e.id);
          const isWinner = winnerId === e.id;
          const isMine = mySignup?.team_entry_id === e.id;
          const supporterCount = supportersByTeam[e.id] ?? 0;
          const borderColor = isWinner ? "#FFD700" : isEliminated ? "#444" : isMine ? ACCENT : "#ffffff15";
          return (
            <motion.div
              key={e.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25 }}
              className="rounded-sm border bg-obsidian-900/60 p-3 flex flex-col gap-3 relative overflow-hidden"
              style={{
                borderColor,
                opacity: isEliminated && !isWinner ? 0.55 : 1,
                boxShadow: isWinner ? "0 0 24px rgba(255,215,0,0.3)" : isMine ? `0 0 14px ${ACCENT}30` : undefined,
              }}
              data-testid={`team-card-${e.id}`}
            >
              {/* Photo */}
              <div className="aspect-square w-full overflow-hidden rounded-sm bg-obsidian-950 relative">
                {e.image_data_url
                  ? <img src={e.image_data_url} alt={e.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white/20">—</div>}
                {isEliminated && !isWinner && (
                  <div className="absolute inset-0 bg-obsidian-950/60 flex items-center justify-center">
                    <X className="w-12 h-12 text-crimson" strokeWidth={3} />
                  </div>
                )}
                {isWinner && (
                  <div className="absolute inset-0 bg-gold/20 flex items-center justify-center">
                    <Trophy className="w-10 h-10" style={{ color: "#FFD700" }} strokeWidth={2.5} />
                  </div>
                )}
              </div>

              {/* Name */}
              <div className="font-display font-bold text-base text-white truncate" title={e.name}>
                {e.name}
              </div>

              {/* Supporter count */}
              <div className="text-[11px] font-mono text-white/55 flex items-center gap-1.5">
                <Users className="w-3 h-3" />
                {supporterCount} backer{supporterCount === 1 ? "" : "s"}
              </div>

              {/* CTA */}
              {canSignup && (
                isMine ? (
                  <div
                    className="text-[11px] uppercase tracking-widest font-mono font-bold py-2 text-center rounded-sm border"
                    style={{ color: ACCENT, borderColor: `${ACCENT}55`, backgroundColor: `${ACCENT}10` }}
                  >
                    <Check className="w-3 h-3 inline -mt-0.5 mr-1" /> You're backing this team
                  </div>
                ) : mySignup ? (
                  <div className="text-[11px] uppercase tracking-widest font-mono py-2 text-center rounded-sm border border-white/10 text-white/30">
                    Locked to your pick
                  </div>
                ) : (
                  <Button
                    onClick={() => onBack(e.id)}
                    className="font-bold uppercase tracking-widest text-[10px] rounded-sm h-9"
                    style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
                    data-testid={`back-team-${e.id}`}
                  >
                    Back this team
                  </Button>
                )
              )}
              {!canSignup && !isWinner && !isEliminated && (
                <div className="text-[10px] uppercase tracking-widest font-mono text-white/35 text-center py-1">
                  Alive · {phase === "spinning" ? "in the wheel" : "—"}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function SignupModal({ open, onClose, roll, teamId, team, wallet, onConnectWallet, onSuccess }) {
  const [handle, setHandle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (open) { setHandle(""); setSubmitting(false); }
  }, [open]);

  if (!open) return null;

  const handleValid = /^[A-Za-z0-9_]{1,15}$/.test(handle.replace(/^@/, "").trim());

  const submit = async () => {
    if (!wallet) { onConnectWallet(); return; }
    if (!handleValid) { toast.error("X handle must be 1–15 chars (letters, digits, _)"); return; }
    setSubmitting(true);
    try {
      await api.post(`/dev/roll/${roll.id}/support`, {
        team_entry_id: teamId,
        wallet,
        x_handle: handle.replace(/^@/, "").trim(),
      });
      onSuccess?.();
    } catch (err) {
      const detail = err?.response?.data?.detail;
      const status = err?.response?.status;
      if (status === 409) {
        toast.error("Already signed up", { description: "This wallet has already backed a team in this roll." });
      } else {
        toast.error("Sign-up failed", { description: detail || err?.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-obsidian-900 border rounded-sm w-full max-w-md p-6"
        style={{ borderColor: `${ACCENT}40` }}
        onClick={(e) => e.stopPropagation()}
        data-testid="signup-modal"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="text-[10px] uppercase tracking-[0.3em] font-mono" style={{ color: ACCENT }}>
            Back this team
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {team && (
          <div className="flex items-center gap-3 mb-5 p-3 rounded-sm bg-obsidian-950/60 border border-white/10">
            {team.image_data_url && (
              <div className="w-14 h-14 rounded-sm overflow-hidden bg-obsidian-950 shrink-0">
                <img src={team.image_data_url} alt={team.name} className="w-full h-full object-cover" />
              </div>
            )}
            <div className="min-w-0">
              <div className="font-display font-bold text-lg text-white truncate">{team.name}</div>
              <div className="text-[11px] font-mono text-white/45">in the {(roll.entries || []).length}-team bracket</div>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/45 mb-1.5">
              <Wallet className="w-3 h-3 inline -mt-0.5 mr-1" /> Wallet
            </div>
            {wallet ? (
              <div className="font-mono text-xs text-white/85 break-all bg-obsidian-950/80 border border-white/10 rounded-sm px-3 py-2.5">
                {wallet}
              </div>
            ) : (
              <Button
                onClick={onConnectWallet}
                className="w-full bg-white text-obsidian-950 hover:bg-white/90 h-10 font-bold uppercase tracking-widest text-[11px] rounded-sm"
              >
                <Wallet className="w-3.5 h-3.5 mr-2" /> Connect Wallet
              </Button>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-widest font-mono text-white/45 mb-1.5">
              <Twitter className="w-3 h-3 inline -mt-0.5 mr-1" /> X handle (so we can credit you)
            </div>
            <Input
              value={handle}
              onChange={(e) => setHandle(e.target.value.slice(0, 16))}
              placeholder="@your_handle"
              className="bg-obsidian-950/80 border-white/10 text-white font-mono h-10 rounded-sm placeholder:text-white/30"
              data-testid="signup-handle"
            />
          </div>

          <div className="text-[11px] font-mono text-white/40 leading-relaxed border border-white/10 rounded-sm p-3 bg-obsidian-950/40">
            One pick per wallet. Locks the moment the wheel starts.
            If your team survives, you share the pot with the other backers.
          </div>

          <Button
            onClick={submit}
            disabled={submitting || !wallet || !handle.trim()}
            className="w-full font-bold uppercase tracking-widest text-xs rounded-sm h-11"
            style={{ backgroundColor: ACCENT, color: "#0A0D0B" }}
            data-testid="signup-submit"
          >
            {submitting ? "Signing up…" : "I'm in"}
          </Button>
        </div>
      </div>
    </div>
  );
}
