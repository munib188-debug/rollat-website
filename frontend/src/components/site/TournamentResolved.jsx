import { useEffect, useMemo, useRef } from "react";
import { Trophy, Twitter, Users, Coins, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { launchConfetti } from "@/lib/confetti";
import { toast } from "sonner";

const ACCENT = "#FF3366";

const truncWallet = (w) => (w ? `${w.slice(0, 6)}…${w.slice(-4)}` : "—");
const fmtSol = (n, max = 4) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: max })} SOL`;

/**
 * Last Team Standing reveal: winning team card + supporter list with each
 * person's split. Admin gets a "Copy CSV" button so they can paste the
 * payout list straight into a spreadsheet / their wallet's batch sender.
 */
export default function TournamentResolved({ roll }) {
  const { isAdmin } = useAuth();
  const canvasRef = useRef(null);

  // Confetti once on mount.
  useEffect(() => {
    const cleanup = launchConfetti(canvasRef.current, 5500);
    return () => cleanup?.();
  }, []);

  const winnerEntry = useMemo(() => {
    if (roll.winner_entry_id && roll.entries) {
      return roll.entries.find((e) => e.id === roll.winner_entry_id);
    }
    return null;
  }, [roll]);

  const payout = roll.tournament_payout || null;
  const supporters = payout?.supporters || [];
  const count = payout?.supporter_count ?? supporters.length;
  const share = payout?.share_sol ?? 0;

  const copyCsv = async () => {
    if (supporters.length === 0) {
      toast.error("No supporters to export");
      return;
    }
    const header = "wallet,x_handle,share_sol\n";
    const rows = supporters
      .map((s) => `${s.wallet},${s.x_handle || ""},${s.share_sol ?? share}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(header + rows);
      toast.success(`Copied ${supporters.length} rows to clipboard`);
    } catch {
      toast.error("Clipboard unavailable — long-press the list to select");
    }
  };

  const shareText = winnerEntry
    ? `🏆 ${winnerEntry.name} just won the $ROLLAT Last Team Standing.\n\n${count} backers split ${fmtSol(roll.pot_sol, 2)} (≈ ${fmtSol(share, 4)} each).\n\nrollat.vercel.app/#dev-roll`
    : `🏆 $ROLLAT Last Team Standing — winner locked in. rollat.vercel.app/#dev-roll`;

  return (
    <div
      className="glass rounded-sm p-7 md:p-10 relative overflow-hidden"
      style={{ borderColor: `${ACCENT}40` }}
      data-testid="tournament-resolved"
    >
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{ zIndex: 9999 }}
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(70% 60% at 50% 0%, #FFD70022 0%, transparent 60%)` }}
      />
      <div className="relative">
        {/* Winning team card */}
        <div className="flex flex-col md:flex-row md:items-center gap-6 mb-8">
          {winnerEntry?.image_data_url && (
            <div
              className="w-32 h-32 md:w-40 md:h-40 rounded-sm overflow-hidden shrink-0 border-2"
              style={{ borderColor: "#FFD700", boxShadow: "0 0 36px rgba(255,215,0,0.45)" }}
            >
              <img src={winnerEntry.image_data_url} alt={winnerEntry.name} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: "#FFD700" }}>
              <Trophy className="w-3 h-3 inline -mt-0.5 mr-1.5" />
              Last team standing
            </div>
            <div className="font-display font-black text-3xl md:text-5xl tracking-tighter break-words">
              {winnerEntry?.name || "—"}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-white/65 font-mono">
              <span className="flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-white/40" />
                {count} supporter{count === 1 ? "" : "s"} share the pot
              </span>
              <span className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-white/40" />
                Pot: <span className="text-white">{fmtSol(roll.pot_sol, 2)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                ≈ <span className="text-white">{fmtSol(share, 4)}</span> per wallet
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border text-[10px] uppercase tracking-[0.2em] font-mono"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT }}
                data-testid="tournament-share"
              >
                <Twitter className="w-3 h-3" /> Share on X
              </a>
              {isAdmin && (
                <Button
                  onClick={copyCsv}
                  variant="outline"
                  className="border-gold/30 hover:border-gold text-gold/80 hover:text-gold h-8 px-3 font-mono text-[10px] uppercase tracking-widest rounded-sm"
                  data-testid="tournament-csv"
                >
                  <Download className="w-3 h-3 mr-1.5" />
                  Copy payout CSV
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Supporter list */}
        <div className="border border-white/10 rounded-sm bg-obsidian-950/60 overflow-hidden">
          <div className="px-4 md:px-6 py-3 bg-obsidian-900/60 grid grid-cols-12 gap-3 text-[10px] uppercase tracking-[0.25em] font-mono text-white/40">
            <div className="col-span-1">#</div>
            <div className="col-span-4">X handle</div>
            <div className="col-span-4">Wallet</div>
            <div className="col-span-3 text-right">Share</div>
          </div>
          {supporters.length === 0 ? (
            <div className="px-6 py-10 text-center text-white/40 text-sm">
              No supporters signed up — the pot stays in the team wallet.
            </div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto">
              {supporters.map((s, i) => (
                <div
                  key={s.wallet}
                  className="px-4 md:px-6 py-3 grid grid-cols-12 gap-3 text-sm border-t border-white/5 first:border-t-0 items-center"
                  data-testid={`supporter-${i}`}
                >
                  <div className="col-span-1 font-mono text-white/30 text-xs">{i + 1}</div>
                  <div className="col-span-4 font-mono text-white/85 truncate">
                    @{s.x_handle || "—"}
                    {s.x_handle && (
                      <a
                        href={`https://x.com/${s.x_handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block ml-2 text-white/30 hover:text-white"
                      >
                        <ExternalLink className="w-3 h-3 inline -mt-0.5" />
                      </a>
                    )}
                  </div>
                  <div className="col-span-4 font-mono text-white/65 text-xs truncate" title={s.wallet}>
                    {truncWallet(s.wallet)}
                  </div>
                  <div className="col-span-3 font-mono text-right" style={{ color: ACCENT }}>
                    {fmtSol(s.share_sol ?? share, 4)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
