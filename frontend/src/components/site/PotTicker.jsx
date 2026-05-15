import { motion } from "framer-motion";
import { useSpinPhase } from "@/lib/SpinPhaseContext";
import { useCountdown } from "@/lib/useCountdown";
import { TrendingUp, Coins, Users, Trophy, Timer } from "lucide-react";

const fmtSol = (n) =>
  `${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SOL`;

const fmtCompactTime = (t) => {
  if (!t || t.total <= 0 || t.firing) return "Soon…";
  const { h, m, s } = t;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
};

export default function PotTicker() {
  const { stats } = useSpinPhase() || {};
  const t = useCountdown(stats?.next_spin_at);
  const nextSpinValue = fmtCompactTime(t);
  const nextSpinAccent = t?.firing ? "crimson" : "emerald";

  const items = [
    { icon: Coins, label: "Live Pot", value: fmtSol(stats?.current_pot_sol), accent: "gold", testid: "pot-live" },
    { icon: Trophy, label: "Distributed", value: fmtSol(stats?.total_distributed_sol), accent: "emerald", testid: "pot-distributed" },
    { icon: TrendingUp, label: "Biggest Win", value: fmtSol(stats?.biggest_win_sol), accent: "crimson", testid: "pot-biggest" },
    { icon: Users, label: "Qualified", value: stats?.total_qualified_wallets ?? "—", accent: "gold", testid: "pot-qualified" },
    { icon: Timer, label: "Next Spin In", value: nextSpinValue, accent: nextSpinAccent, testid: "pot-next-spin" },
  ];

  return (
    <section className="relative -mt-4 mb-12 px-6 md:px-12" data-testid="pot-ticker-section">
      <div className="max-w-[1400px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="glass rounded-sm grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-white/5 overflow-hidden"
        >
          {items.map((it) => {
            const Icon = it.icon;
            const colorMap = {
              gold: "text-gold",
              crimson: "text-crimson",
              emerald: "text-emerald_neon",
            };
            return (
              <div
                key={it.label}
                className="p-6 md:p-8 flex flex-col gap-3"
                data-testid={it.testid}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${colorMap[it.accent]}`} />
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/45 font-mono">
                    {it.label}
                  </span>
                </div>
                <div className={`font-mono font-bold text-2xl md:text-3xl tracking-tight ${colorMap[it.accent]}`}>
                  {it.value}
                </div>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
