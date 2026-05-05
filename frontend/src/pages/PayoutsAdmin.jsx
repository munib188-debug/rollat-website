import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Wallet, Pen, ShieldAlert, ShieldCheck, Save, ExternalLink, Trophy, Hash } from "lucide-react";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAuth } from "@/lib/AuthContext";
import { api } from "@/lib/api";
import { truncWallet } from "@/lib/walletUtils";
import WalletPicker from "@/components/site/WalletPicker";

const ACCENT = "#FFD700";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
};

export default function PayoutsAdmin() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const { isAuthenticated, isAdmin, signIn, signingIn, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [winners, setWinners] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState({});
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const r = await api.get("/winners", { params: { limit: 50 } });
      const list = Array.isArray(r.data) ? r.data : [];
      setWinners(list);
      const next = {};
      for (const w of list) next[w.round_number] = w.payout_tx || "";
      setDrafts(next);
    } catch (err) {
      toast.error("Could not load winners", { description: err?.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) refresh();
  }, [isAdmin]);

  const handleSignIn = async () => {
    try { await signIn(); } catch (err) { toast.error("Sign-in failed", { description: err?.message }); }
  };

  const renumber = async (round) => {
    const input = window.prompt(`Renumber round #${round} to which new number?`, String(round));
    if (input == null) return;
    const next = parseInt(input.trim(), 10);
    if (!Number.isFinite(next) || next < 1) {
      toast.error("Invalid round number");
      return;
    }
    if (next === round) return;
    try {
      const r = await api.patch(`/admin/winners/${round}/renumber`, { new_round_number: next });
      toast.success(`Renumbered #${round} → #${next}`);
      setWinners((ws) =>
        ws
          .map((w) => (w.round_number === round ? r.data : w))
          .sort((a, b) => b.round_number - a.round_number)
      );
      setDrafts((d) => {
        const copy = { ...d };
        copy[next] = copy[round] ?? "";
        delete copy[round];
        return copy;
      });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error("Renumber failed", { description: detail || err?.message });
    }
  };

  const saveTx = async (round) => {
    const v = (drafts[round] || "").trim();
    setSaving((s) => ({ ...s, [round]: true }));
    try {
      const r = await api.patch(`/admin/winners/${round}/tx`, { tx: v || null });
      toast.success(v ? "Tx saved" : "Tx cleared");
      setWinners((ws) => ws.map((w) => (w.round_number === round ? r.data : w)));
    } catch (err) {
      const detail = err?.response?.data?.detail;
      toast.error("Save failed", { description: detail || err?.message });
    } finally {
      setSaving((s) => ({ ...s, [round]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-obsidian-950 grain felt-bg" data-testid="payouts-admin-page">
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <ArrowLeft className="w-4 h-4 text-white/50 group-hover:text-gold" />
            <div className="w-8 h-8 rounded-full roulette-wheel" />
            <span className="font-display font-black text-xl tracking-tight">$ROLLAT</span>
            <span
              className="hidden md:inline text-[10px] uppercase tracking-[0.25em] font-mono border px-2 py-1 rounded-sm ml-2"
              style={{ color: ACCENT, borderColor: `${ACCENT}55` }}
            >
              PAYOUTS · ADMIN
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {connectedAddr && (
              <span className="hidden md:inline-flex items-center gap-2 px-3 h-9 border border-white/10 text-white/70 rounded-sm font-mono text-[11px] uppercase tracking-widest">
                {truncWallet(connectedAddr)}
                {isAdmin && <ShieldCheck className="w-3.5 h-3.5" style={{ color: ACCENT }} />}
              </span>
            )}
            {connectedAddr ? (
              <Button
                onClick={() => { disconnect(); signOut(); }}
                variant="outline"
                className="border-white/15 bg-transparent text-white hover:bg-white/5 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              >
                Disconnect
              </Button>
            ) : (
              <Button
                onClick={() => setPickerOpen(true)}
                className="bg-white text-obsidian-950 hover:bg-white/90 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
              >
                <Wallet className="w-3.5 h-3.5 mr-2" /> Connect
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-6 md:px-12 py-10 md:py-14">
        {!connectedAddr && (
          <Gate
            title="Connect a wallet to continue"
            description="Payout admin is gated by the on-chain admin allowlist."
            action={<Button onClick={() => setPickerOpen(true)} className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"><Wallet className="w-4 h-4 mr-2" /> Connect Wallet</Button>}
          />
        )}

        {connectedAddr && !isAuthenticated && (
          <Gate
            title="Sign a message to verify ownership"
            description="Sign-in proves you control this wallet. No transaction is broadcast."
            action={
              <Button onClick={handleSignIn} disabled={signingIn} className="bg-white text-obsidian-950 font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6">
                <Pen className="w-4 h-4 mr-2" /> {signingIn ? "Signing…" : "Sign In"}
              </Button>
            }
          />
        )}

        {connectedAddr && isAuthenticated && !isAdmin && (
          <Gate
            danger
            title="Admin only"
            description={`This wallet (${truncWallet(connectedAddr)}) is not on the admin allowlist.`}
          />
        )}

        {connectedAddr && isAuthenticated && isAdmin && (
          <>
            <div className="mb-8">
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono mb-2" style={{ color: ACCENT }}>
                Daily Spin Payouts
              </div>
              <h1 className="font-display font-black text-3xl md:text-4xl tracking-tighter mb-2">
                Attach the payout tx to each winner.
              </h1>
              <p className="text-white/55 max-w-2xl">
                After you send the SOL, paste the transaction signature here. It shows
                up publicly under the winner as a Solscan link so anyone can verify the
                payout.
              </p>
            </div>

            {loading && winners.length === 0 && (
              <div className="text-white/40 font-mono text-sm">Loading…</div>
            )}

            {!loading && winners.length === 0 && (
              <div className="border border-white/5 rounded-sm bg-obsidian-900/40 p-10 text-center text-white/45 font-mono text-sm">
                No winners yet. Once the first daily spin resolves, it'll show up here.
              </div>
            )}

            <div className="space-y-3">
              {winners.map((w) => {
                const draft = drafts[w.round_number] ?? "";
                const dirty = draft.trim() !== (w.payout_tx || "");
                const isSaving = !!saving[w.round_number];
                return (
                  <div
                    key={w.round_number}
                    className="border border-white/5 hover:border-white/15 transition-colors rounded-sm bg-obsidian-900/40 p-4 md:p-5"
                    data-testid={`payout-row-${w.round_number}`}
                  >
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
                      <div className="flex items-center gap-2">
                        <Trophy className="w-3.5 h-3.5 text-gold" />
                        <span className="font-display font-bold text-base">Round #{w.round_number}</span>
                      </div>
                      <span className="font-mono text-xs text-white/50">{fmtDate(w.won_at)}</span>
                      <span className="font-mono text-xs text-white/70">{truncWallet(w.wallet)}</span>
                      <span className="font-mono text-sm font-bold text-gold ml-auto tabular-nums">{fmtSol(w.amount_sol)}</span>
                    </div>
                    <div className="flex flex-col md:flex-row gap-2">
                      <Input
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [w.round_number]: e.target.value }))}
                        placeholder="Solana transaction signature (base58, ~88 chars)"
                        className="bg-obsidian-950/60 border-white/10 font-mono text-xs"
                        data-testid={`payout-input-${w.round_number}`}
                      />
                      <div className="flex gap-2">
                        <Button
                          onClick={() => saveTx(w.round_number)}
                          disabled={!dirty || isSaving}
                          className="bg-gold text-obsidian-950 hover:bg-gold/90 disabled:opacity-40 h-10 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
                        >
                          <Save className="w-3.5 h-3.5 mr-1.5" /> {isSaving ? "Saving…" : "Save"}
                        </Button>
                        {w.payout_tx && (
                          <a
                            href={`https://solscan.io/tx/${w.payout_tx}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center px-3 h-10 border border-white/10 hover:border-white/30 text-white/60 hover:text-white rounded-sm font-mono text-[11px] uppercase tracking-widest"
                          >
                            <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Solscan
                          </a>
                        )}
                        <Button
                          onClick={() => renumber(w.round_number)}
                          variant="outline"
                          className="border-white/15 bg-transparent text-white/70 hover:text-white hover:bg-white/5 h-10 px-3 font-mono text-[11px] uppercase tracking-widest rounded-sm"
                          title="Change this winner's round number"
                          data-testid={`payout-renumber-${w.round_number}`}
                        >
                          <Hash className="w-3.5 h-3.5 mr-1.5" /> Renumber
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function Gate({ title, description, action, danger }) {
  return (
    <div className="glass rounded-sm p-10 md:p-14 text-center" data-testid="payouts-admin-gate">
      <div className="mx-auto w-12 h-12 rounded-sm flex items-center justify-center mb-5"
        style={{ backgroundColor: danger ? "#FF336622" : "#ffffff10" }}
      >
        {danger
          ? <ShieldAlert className="w-6 h-6" style={{ color: "#FF3366" }} />
          : <ShieldCheck className="w-6 h-6 text-white/70" />}
      </div>
      <h2 className="font-display font-black text-2xl md:text-3xl tracking-tighter mb-3">{title}</h2>
      <p className="text-white/55 max-w-xl mx-auto mb-6">{description}</p>
      {action && <div className="flex justify-center">{action}</div>}
    </div>
  );
}
