import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { SectionLabel } from "./HowItWorks";

const data = [
  { name: "Prize Pot",          value: 70, color: "#FFD700", sub: "Paid to one holder every 24h" },
  { name: "Development & Infra", value: 15, color: "#00FFA3", sub: "Servers, audits, engineering" },
  { name: "Marketing & Community", value: 10, color: "#FF3366", sub: "Promo, KOLs, contests" },
  { name: "Buyback & Burn",      value: 5,  color: "#FF6B35", sub: "Burns supply on every trade" },
];

export default function Tokenomics() {
  return (
    <section id="tokenomics" className="relative py-24 md:py-32 px-6 md:px-12" data-testid="tokenomics-section">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        <div className="lg:col-span-5">
          <SectionLabel>Tokenomics</SectionLabel>
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter mb-5" data-testid="tokenomics-headline">
            Every trade <span className="gold-text">feeds the wheel.</span>
          </h2>
          <p className="text-white/55 text-base md:text-lg leading-relaxed mb-8">
            A flat 3% transaction fee. 70% pours straight into the prize pot.
            No vesting cliffs, no team allocations sitting on holders' heads — just
            four transparent flows, hardcoded into the contract.
          </p>

          <div className="space-y-3" data-testid="tokenomics-breakdown">
            {data.map((d) => (
              <div key={d.name} className="flex items-center gap-4 p-4 bg-obsidian-900/50 border border-white/5 rounded-sm">
                <div className="w-1 h-10" style={{ backgroundColor: d.color }} />
                <div className="flex-1">
                  <div className="font-display font-bold text-lg leading-tight">{d.name}</div>
                  <div className="text-xs text-white/45 font-mono uppercase tracking-widest">
                    {d.sub}
                  </div>
                </div>
                <div className="font-mono text-2xl font-bold" style={{ color: d.color }}>
                  {d.value}%
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4">
            <Metric label="Total Supply" value="1,000,000,000" sub="$ROLLAT" />
            <Metric label="Pot Threshold" value="5 SOL" sub="rolls over if under" />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="lg:col-span-7 relative"
          data-testid="tokenomics-chart"
        >
          <div className="relative aspect-square max-w-[560px] mx-auto" style={{ minHeight: 320 }}>
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-gold/20 via-crimson/10 to-emerald_neon/10 blur-3xl opacity-60" />
            <ResponsiveContainer width="100%" height="100%" minWidth={280} minHeight={280}>
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="85%"
                  paddingAngle={2}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                >
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-white/40 mb-1">Total Tax</div>
                <div className="font-display font-black text-6xl gold-text">3%</div>
                <div className="text-xs text-white/45 font-mono mt-2">on every buy/sell</div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div className="border border-white/10 p-5 rounded-sm bg-obsidian-900/40">
      <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/40 mb-2">{label}</div>
      <div className="font-mono font-bold text-xl text-white">{value}</div>
      <div className="text-xs text-white/45 mt-1">{sub}</div>
    </div>
  );
}
