import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { Search, CheckCircle2, AlertCircle, Ticket, Wallet } from "lucide-react";
import { SectionLabel } from "./HowItWorks";
import { toast } from "sonner";
import { useWallet } from "@solana/wallet-adapter-react";
import { isValidSolanaAddress, truncWallet } from "@/lib/walletUtils";

const fmtTokens = (n) => {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
};

export default function WalletCheck() {
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { publicKey } = useWallet();
  const myAddr = publicKey?.toBase58();

  const sample = "6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump";

  const check = async (input) => {
    const target = (input ?? addr).trim();
    if (!target) {
      toast.error("Enter a wallet address");
      return;
    }
    if (!isValidSolanaAddress(target)) {
      toast.error("Invalid Solana address", {
        description: "Must be a valid base58 public key (32–44 chars).",
      });
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.get(`/wallet-check/${encodeURIComponent(target)}`);
      setResult(data);
    } catch (err) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (err?.code === "ECONNABORTED") {
        toast.error("Server is waking up", {
          description: "The backend is starting from cold. Try again in 20–30 seconds.",
        });
      } else if (status === 400) {
        toast.error("Invalid wallet", { description: detail || "Backend rejected the address." });
      } else {
        toast.error("Wallet check failed", {
          description: detail || err?.message || "Network error",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const useMyWallet = () => {
    if (!myAddr) return;
    setAddr(myAddr);
    check(myAddr);
  };

  // Auto-check the connected wallet the first time it appears.
  useEffect(() => {
    if (myAddr && !result && !loading) {
      setAddr(myAddr);
      check(myAddr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAddr]);

  return (
    <section className="relative py-24 md:py-32 px-6 md:px-12" data-testid="wallet-check-section">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-5">
          <SectionLabel>Qualification Check</SectionLabel>
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter mb-5" data-testid="walletcheck-headline">
            Are you in the wheel?
          </h2>
          <p className="text-white/55 text-base md:text-lg leading-relaxed mb-6">
            Drop any Solana wallet address. The contract simulator will run the same
            24-snapshot check used at spin time and tell you exactly how many tickets
            your bag is worth right now.
          </p>
          <div className="space-y-2 text-sm text-white/60 font-mono">
            <TierRow range="< 1M" tickets="0" note="Not qualified" dim />
            <TierRow range="1M – 2M" tickets="1" />
            <TierRow range="2M – 4M" tickets="2" />
            <TierRow range="4M – 6M" tickets="3" />
            <TierRow range="6M – 8M" tickets="4" />
            <TierRow range="8M – 10M" tickets="5" />
            <TierRow range="10M+" tickets="6" note="cap" highlight />
            <div className="pt-2 text-crimson text-xs">→ Recent winners are locked out for 1 round</div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="lg:col-span-7 glass rounded-sm p-7 md:p-10 glow-gold"
          data-testid="wallet-check-card"
        >
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="Paste any Solana wallet address…"
              className="bg-obsidian-950/80 border-white/10 text-white placeholder:text-white/30 font-mono h-12 rounded-sm focus-visible:ring-gold/50 focus-visible:border-gold/40"
              data-testid="wallet-input"
              onKeyDown={(e) => e.key === "Enter" && check()}
            />
            <Button
              onClick={() => check()}
              disabled={loading}
              className="bg-gold text-obsidian-950 hover:bg-gold-hover font-bold uppercase tracking-widest text-xs rounded-sm h-12 px-6"
              data-testid="check-status-btn"
            >
              <Search className="w-4 h-4 mr-2" />
              {loading ? "Checking…" : "Check"}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-6">
            {myAddr && (
              <button
                onClick={useMyWallet}
                className="inline-flex items-center gap-1.5 text-xs text-gold hover:text-gold-hover font-mono"
                data-testid="use-my-wallet-btn"
              >
                <Wallet className="w-3 h-3" />
                use my wallet → {truncWallet(myAddr)}
              </button>
            )}
            <button
              onClick={() => { setAddr(sample); check(sample); }}
              className="text-xs text-white/40 hover:text-gold font-mono"
              data-testid="sample-wallet-btn"
            >
              try sample → {sample.slice(0, 14)}…
            </button>
          </div>

          {result && <ResultPanel r={result} />}
          {!result && <EmptyState />}
        </motion.div>
      </div>
    </section>
  );
}

function TierRow({ range, tickets, note, dim, highlight }) {
  return (
    <div className={`flex items-center justify-between border-b border-white/5 pb-1.5 ${dim ? "opacity-50" : ""}`}>
      <span className={highlight ? "text-gold" : "text-white/70"}>{range}</span>
      <span className="flex items-center gap-2">
        <Ticket className={`w-3 h-3 ${highlight ? "text-gold" : "text-white/40"}`} />
        <span className={`font-bold ${highlight ? "text-gold" : "text-white"}`}>{tickets}</span>
        {note && <span className="text-white/35 text-xs uppercase tracking-widest">· {note}</span>}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-t border-white/5 pt-6">
      <div className="text-white/30 text-xs uppercase tracking-[0.25em] font-mono mb-3">// awaiting input</div>
      <SnapshotTimeline snapshots={Array(24).fill(false)} />
    </div>
  );
}

function ResultPanel({ r }) {
  const ok = r.is_qualified;
  const pct = (r.hours_held / 24) * 100;
  return (
    <div className="border-t border-white/5 pt-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/40 mb-1">Wallet</div>
          <div className="font-mono text-white text-sm break-all" data-testid="result-wallet">{r.wallet}</div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-sm border ${
          ok ? "border-emerald_neon/40 text-emerald_neon bg-emerald_neon/10" :
                "border-crimson/40 text-crimson bg-crimson/5"
        }`} data-testid="result-badge">
          {ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span className="text-[10px] uppercase tracking-[0.2em] font-bold">
            {ok ? "Qualified" : r.is_recent_winner ? "Recent Winner" : "Not Qualified"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Holdings" value={fmtTokens(r.holdings_tokens)} sub="$ROLLAT" testid="stat-holdings" />
        <Stat label="Hours Held" value={`${r.hours_held}/24`} testid="stat-hours" />
        <Stat
          label="Tickets"
          value={r.tickets}
          icon={<Ticket className="w-3.5 h-3.5 text-gold" />}
          testid="stat-tickets"
        />
      </div>

      <div>
        <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] font-mono text-white/45 mb-2">
          <span>24h Snapshot Progress</span>
          <span className={ok ? "text-emerald_neon" : "text-gold"}>{Math.round(pct)}%</span>
        </div>
        <Progress
          value={pct}
          className="h-1.5 bg-white/5 [&>*]:bg-gradient-to-r [&>*]:from-gold [&>*]:to-crimson"
          data-testid="progress-bar"
        />
      </div>

      <SnapshotTimeline snapshots={r.snapshots} />

      {!ok && r.next_qualification_in_hours && !r.is_recent_winner && (
        <div className="text-xs text-white/50 font-mono">
          → Hold for {r.next_qualification_in_hours} more hour(s) to qualify for the next spin.
        </div>
      )}
      {r.is_recent_winner && (
        <div className="text-xs text-crimson font-mono">
          → Recent winner — locked out for 1 round. Spreading the wealth.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, icon, testid }) {
  return (
    <div className="bg-obsidian-950/60 border border-white/5 p-4 rounded-sm" data-testid={testid}>
      <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-white/40 mb-1.5 flex items-center gap-1.5">
        {icon}{label}
      </div>
      <div className="font-mono font-bold text-xl text-white">{value}</div>
      {sub && <div className="text-[10px] text-white/40 font-mono mt-1">{sub}</div>}
    </div>
  );
}

function SnapshotTimeline({ snapshots }) {
  return (
    <div data-testid="snapshot-timeline">
      <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/40 mb-3">
        Hourly Snapshots · last 24 hrs
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hidden pb-2">
        {snapshots.map((s, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
            <div
              className={`w-3 h-3 rounded-full transition-all ${
                s
                  ? "bg-emerald_neon shadow-[0_0_12px_rgba(0,255,163,0.6)]"
                  : "bg-white/10"
              }`}
            />
            {(i % 4 === 0 || i === 23) && (
              <span className="text-[9px] font-mono text-white/30">{i}h</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
