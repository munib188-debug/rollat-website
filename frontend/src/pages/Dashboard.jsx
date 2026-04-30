import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { api, useStats } from "@/lib/api";
import { useCountdown, pad } from "@/lib/useCountdown";
import { useWallet } from "@solana/wallet-adapter-react";
import WalletPicker from "@/components/site/WalletPicker";
import {
  ArrowLeft, Wallet, Ticket, Trophy, Clock,
  CheckCircle2, AlertCircle, Zap, ExternalLink, Coins
} from "lucide-react";
import { toast } from "sonner";

const DEFAULT_WALLET = "";
const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} SOL`;

const fmtTokens = (n) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
};

function tierLabel(tickets) {
  switch (tickets) {
    case 6: return "Whale tier · cap";
    case 5: return "2.5M+ · 5 tickets";
    case 4: return "2M+ · 4 tickets";
    case 3: return "1.5M+ · 3 tickets";
    case 2: return "1M+ · 2 tickets";
    case 1: return "100K+ · 1 ticket";
    default: return "Need 100K+ to qualify";
  }
}

export default function Dashboard() {
  const { publicKey, disconnect } = useWallet();
  const connectedAddr = publicKey?.toBase58() || "";
  const [wallet, setWallet] = useState(DEFAULT_WALLET);
  const [input, setInput] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const stats = useStats();
  const t = useCountdown(stats?.next_spin_at);

  // Sync the wallet under inspection with the connected wallet, unless the
  // user has explicitly typed a different address into the switch input.
  useEffect(() => {
    if (connectedAddr && !wallet) setWallet(connectedAddr);
  }, [connectedAddr, wallet]);

  const load = async (w) => {
    if (!w) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/dashboard/${encodeURIComponent(w)}`);
      setData(data);
    } catch (err) {
      const detail = err?.response?.data?.detail;
      if (err?.code === "ECONNABORTED") {
        toast.error("Server is waking up", {
          description: "The backend is starting from cold. Try again in 20–30 seconds.",
        });
      } else {
        toast.error("Failed to load wallet", {
          description: detail || err?.message || "Network error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(wallet); /* eslint-disable-next-line */ }, [wallet]);

  const status = data?.status;

  const handleClaim = () => {
    toast.info("Payout is automatic", {
      description: "SOL is sent directly to the winner's wallet the moment the spin resolves — no action needed.",
    });
  };

  const handleSwitch = () => {
    if (!input.trim()) return;
    setWallet(input.trim());
  };

  return (
    <div className="min-h-screen bg-obsidian-950 grain felt-bg" data-testid="dashboard-page">
      <header className="sticky top-0 z-40 glass border-b border-white/5">
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group" data-testid="dashboard-back-link">
            <ArrowLeft className="w-4 h-4 text-white/50 group-hover:text-gold" />
            <div className="w-8 h-8 rounded-full roulette-wheel" />
            <span className="font-display font-black text-xl tracking-tight">$ROLLAT</span>
            <span className="hidden md:inline text-[10px] uppercase tracking-[0.25em] font-mono text-gold border border-gold/30 px-2 py-1 rounded-sm ml-2">DASHBOARD</span>
          </Link>
          <div className="flex items-center gap-2">
            {connectedAddr ? (
              <>
                <span className="hidden md:inline-flex items-center gap-2 px-3 h-9 border border-emerald_neon/30 text-emerald_neon bg-emerald_neon/5 rounded-sm font-mono text-[11px] uppercase tracking-widest">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald_neon animate-flicker" />
                  {connectedAddr.slice(0, 4)}…{connectedAddr.slice(-4)}
                </span>
                <Button
                  onClick={() => { disconnect(); setWallet(""); setData(null); }}
                  variant="outline"
                  className="border-white/15 bg-transparent text-white hover:bg-white/5 hover:border-crimson/40 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
                  data-testid="dashboard-disconnect-btn"
                >
                  Disconnect
                </Button>
              </>
            ) : (
              <Button
                onClick={() => setPickerOpen(true)}
                className="bg-gold text-obsidian-950 hover:bg-gold-hover h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm font-bold"
                data-testid="dashboard-connect-btn"
              >
                <Wallet className="w-3.5 h-3.5 mr-2" /> Connect Wallet
              </Button>
            )}
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSwitch()}
              placeholder="Switch wallet…"
              className="hidden lg:block w-60 bg-obsidian-900/80 border-white/10 text-white font-mono text-xs h-9 rounded-sm"
              data-testid="dashboard-wallet-input"
            />
            <Button
              onClick={handleSwitch}
              variant="outline"
              className="hidden lg:inline-flex border-white/15 bg-transparent text-white hover:bg-white/5 hover:border-gold/40 h-9 px-4 font-mono text-[11px] uppercase tracking-widest rounded-sm"
              data-testid="dashboard-switch-btn"
            >
              Switch
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 md:py-14 relative">
        {!wallet && (
          <div className="glass rounded-sm p-10 md:p-14 mb-10 text-center" data-testid="dashboard-empty">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-3">No wallet selected</div>
            <h2 className="font-display font-black text-3xl md:text-4xl tracking-tighter mb-3">
              Connect a wallet to see your dashboard
            </h2>
            <p className="text-white/55 max-w-xl mx-auto mb-6">
              Once connected, you'll see your $ROLLAT balance, ticket count, 24-hour
              snapshot progress, and any past wins — all live, on-chain.
            </p>
            <Button
              onClick={() => setPickerOpen(true)}
              className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
              data-testid="dashboard-empty-connect-btn"
            >
              <Wallet className="w-4 h-4 mr-2" /> Connect Wallet
            </Button>
          </div>
        )}

        <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-2">Wallet</div>
            <div className="font-display font-black text-3xl md:text-4xl tracking-tighter break-all">
              {wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : "—"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status?.is_qualified ? (
              <span className="inline-flex items-center gap-2 px-3 py-2 border border-emerald_neon/40 text-emerald_neon bg-emerald_neon/10 rounded-sm text-[10px] uppercase tracking-[0.2em] font-bold" data-testid="dashboard-status-badge">
                <CheckCircle2 className="w-4 h-4" /> Qualified for Round #{(stats?.spins_completed ?? 0) + 1}
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 px-3 py-2 border border-crimson/40 text-crimson bg-crimson/10 rounded-sm text-[10px] uppercase tracking-[0.2em] font-bold" data-testid="dashboard-status-badge">
                <AlertCircle className="w-4 h-4" /> {status?.is_recent_winner ? "Recent Winner" : "Not Qualified Yet"}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <KpiCard
            label="Holdings"
            value={status ? fmtTokens(status.holdings_tokens) : "—"}
            sub="$ROLLAT"
            icon={Coins}
            accent="gold"
            testid="kpi-holdings"
          />
          <KpiCard
            label="Tickets"
            value={status?.tickets ?? "—"}
            sub={tierLabel(status?.tickets ?? 0)}
            icon={Ticket}
            accent="crimson"
            testid="kpi-tickets"
          />
          <KpiCard
            label="Hours Held"
            value={status ? `${status.hours_held}/24` : "—"}
            sub={status?.is_qualified ? "Locked in" : `${status?.next_qualification_in_hours ?? "—"}h to go`}
            icon={Clock}
            accent="emerald"
            testid="kpi-hours"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-10">
          <div className="lg:col-span-2 glass rounded-sm p-7 md:p-10 relative overflow-hidden glow-gold" data-testid="dashboard-countdown-card">
            <div className="absolute -top-12 -right-12 w-64 h-64 rounded-full bg-gold/5 blur-3xl" />
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-4">Next Spin In</div>
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
                    <div className="text-4xl md:text-5xl font-black gold-text tabular-nums">{pad(c.v)}</div>
                  </div>
                  {i < 3 && <span className="text-3xl text-white/20 pb-1">:</span>}
                </div>
              ))}
            </div>
            <Progress
              value={Math.min(100, ((status?.hours_held ?? 0) / 24) * 100)}
              className="h-1.5 bg-white/5 [&>*]:bg-gradient-to-r [&>*]:from-gold [&>*]:to-crimson mb-3"
            />
            <div className="text-xs text-white/45 font-mono uppercase tracking-widest">
              Snapshot eligibility · {status?.hours_held ?? 0}/24 hours
            </div>
          </div>

          <div className="glass rounded-sm p-7 md:p-8 flex flex-col justify-between" data-testid="dashboard-pot-card">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-emerald_neon mb-4 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald_neon animate-flicker" /> LIVE POT
              </div>
              <div className="font-mono font-black text-4xl md:text-5xl gold-text tabular-nums tracking-tight">
                {fmtSol(stats?.current_pot_sol)}
              </div>
              <div className="text-xs text-white/45 mt-2 font-mono">
                Threshold: {stats?.pot_threshold_sol ?? 5} SOL · {stats?.rollover_active ? "Rollover ACTIVE" : "Threshold met"}
              </div>
            </div>
            <Button
              onClick={handleClaim}
              disabled={!status?.is_qualified}
              className="w-full mt-6 bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-12 disabled:opacity-40"
              data-testid="dashboard-claim-btn"
            >
              <Zap className="w-4 h-4 mr-2" />
              {status?.is_qualified ? "Qualified — Auto-Payout on Win" : "Locked"}
            </Button>
          </div>
        </div>

        <div className="glass rounded-sm p-7 mb-10" data-testid="dashboard-snapshot-card">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-1">Hourly Snapshots</div>
              <div className="font-display font-bold text-xl">Last 24 hour qualification</div>
            </div>
            <div className="text-xs font-mono text-white/45">
              {status?.snapshots?.filter(Boolean).length ?? 0}/24 passed
            </div>
          </div>
          <div className="grid grid-cols-12 md:grid-cols-24 gap-1.5">
            {(status?.snapshots ?? Array(24).fill(false)).map((s, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div
                  className={`w-full h-12 rounded-sm transition-all ${
                    s
                      ? "bg-emerald_neon/80 shadow-[0_0_12px_rgba(0,255,163,0.5)]"
                      : "bg-white/5"
                  }`}
                  data-testid={`snapshot-${i}`}
                />
                {(i % 4 === 0 || i === 23) && (
                  <span className="text-[9px] font-mono text-white/35">{i}h</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 bg-obsidian-900/40 border border-white/5 rounded-sm" data-testid="dashboard-history-card">
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold">Round Participation</div>
              <span className="text-xs text-white/40 font-mono">last 5 rounds</span>
            </div>
            <div>
              {(data?.participation ?? []).map((p) => (
                <div
                  key={p.round_number}
                  className="grid grid-cols-12 gap-3 px-6 py-4 border-b border-white/5 last:border-b-0 items-center text-sm"
                  data-testid={`participation-row-${p.round_number}`}
                >
                  <div className="col-span-2 font-mono text-white/40">#{p.round_number}</div>
                  <div className="col-span-3 font-mono text-white/70">{p.tickets}× tickets</div>
                  <div className="col-span-4">
                    {p.qualified ? (
                      <span className="text-emerald_neon text-xs font-mono uppercase tracking-widest">Qualified</span>
                    ) : (
                      <span className="text-white/40 text-xs font-mono uppercase tracking-widest">Skipped</span>
                    )}
                  </div>
                  <div className="col-span-3 text-right">
                    {p.won ? (
                      <span className="inline-flex items-center gap-1 text-gold text-xs font-bold uppercase tracking-widest">
                        <Trophy className="w-3 h-3" /> Won
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">—</span>
                    )}
                  </div>
                </div>
              ))}
              {(!data?.participation || data.participation.length === 0) && (
                <div className="px-6 py-10 text-center text-white/40 text-sm">No participation yet.</div>
              )}
            </div>
          </div>

          <div className="bg-obsidian-900/40 border border-white/5 rounded-sm p-6" data-testid="dashboard-payouts-card">
            <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-gold mb-4">Past SOL Payouts</div>
            {data?.win_history?.length ? (
              <div className="space-y-3">
                {data.win_history.map((w) => (
                  <div key={w.id} className="border border-gold/20 bg-gold/5 p-4 rounded-sm">
                    <div className="font-display font-bold text-base text-gold">Round #{w.round_number}</div>
                    <div className="font-mono text-xs text-white/60 mt-1">
                      {fmtSol(w.amount_sol)} · {new Date(w.won_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-white/10 p-6 rounded-sm text-center">
                <Zap className="w-7 h-7 text-white/20 mx-auto mb-2" />
                <div className="text-sm text-white/45">No payouts yet.</div>
                <div className="text-xs text-white/30 font-mono mt-1">Win a round to receive SOL.</div>
              </div>
            )}
            {wallet && (
              <a
                href={`https://solscan.io/account/${wallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 flex items-center gap-2 text-xs font-mono text-white/50 hover:text-gold uppercase tracking-widest"
                data-testid="dashboard-explorer-link"
              >
                View on Solscan <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        {loading && (
          <div className="fixed bottom-6 right-6 px-4 py-2 bg-obsidian-900 border border-gold/30 text-gold text-xs font-mono rounded-sm">
            loading…
          </div>
        )}
      </main>

      <WalletPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

function KpiCard({ label, value, sub, icon: Icon, accent, testid }) {
  const accentMap = {
    gold: "text-gold",
    crimson: "text-crimson",
    emerald: "text-emerald_neon",
  };
  return (
    <div className="glass rounded-sm p-6 relative overflow-hidden" data-testid={testid}>
      <div className="flex items-start justify-between mb-6">
        <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45">{label}</div>
        <Icon className={`w-4 h-4 ${accentMap[accent]}`} />
      </div>
      <div className={`font-mono font-black text-3xl tabular-nums ${accentMap[accent]}`}>{value}</div>
      <div className="text-xs text-white/45 mt-2 font-mono">{sub}</div>
    </div>
  );
}
