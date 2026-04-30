import { motion } from "framer-motion";
import { ShieldCheck, Link2, Eye } from "lucide-react";
import { SectionLabel } from "./HowItWorks";

export default function Vrf() {
  return (
    <section id="vrf" className="relative py-24 md:py-32 px-6 md:px-12" data-testid="vrf-section">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
        <div className="lg:col-span-5">
          <SectionLabel>Provably Fair</SectionLabel>
          <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter mb-5" data-testid="vrf-headline">
            We can't <span className="crimson-text">cheat.</span><br/>Neither can anyone else.
          </h2>
          <p className="text-white/55 text-base md:text-lg leading-relaxed mb-8">
            Every winner is selected by Switchboard VRF — verifiable randomness generated
            by Solana's native oracle network. The team has zero control over the outcome.
            You can audit the request, the proof, and the SOL transfer on-chain.
          </p>
          <div className="space-y-4">
            <Trust icon={ShieldCheck} title="Cryptographic proof" desc="Every random number ships with a proof verifiable on-chain — no trust required." />
            <Trust icon={Link2} title="Oracle-secured" desc="Backed by Switchboard, Solana's native oracle network for on-chain randomness." />
            <Trust icon={Eye} title="Open audit" desc="The contract source, every spin, every payout — public and indexed forever." />
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="lg:col-span-7"
          data-testid="vrf-code-card"
        >
          <div className="bg-obsidian-900/60 border border-white/10 rounded-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 bg-obsidian-800/60 border-b border-white/5">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-crimson/50" />
                <span className="w-2.5 h-2.5 rounded-full bg-gold/50" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald_neon/50" />
              </div>
              <div className="text-[10px] font-mono text-white/40 uppercase tracking-widest">RollatRoulette.sol</div>
              <div className="text-[10px] font-mono text-emerald_neon">verified</div>
            </div>
            <pre className="p-6 text-[12px] md:text-[13px] font-mono leading-relaxed overflow-auto scrollbar-hidden text-white/80">
{`// SPDX-License-Identifier: MIT
contract RollatRoulette is VRFConsumerBaseV2 {
  uint256 public constant POT_THRESHOLD = 25 ether;
  uint256 public constant MIN_HOLDINGS  = 100_000e9;
  uint256 public constant TICKET_CAP    = 6;

  function requestSpin() external onlyKeeper {
    require(potBalance() >= POT_THRESHOLD, "rollover");
    `}<span className="text-gold">requestRandomWords</span>{`(...);
    emit `}<span className="text-crimson">SpinRequested</span>{`(round, block.timestamp);
  }

  function fulfillRandomWords(uint256, uint256[] memory r)
    internal override
  {
    address winner = `}<span className="text-emerald_neon">selectWeighted</span>{`(r[0]);
    `}<span className="text-gold">_payoutSOL</span>{`(winner, potBalance()); // direct transfer
    halloffame[round] = Win(winner, potBalance(), block.timestamp);
    emit `}<span className="text-gold">Winner</span>{`(round++, winner);
  }
}`}
            </pre>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Trust({ icon: Icon, title, desc }) {
  return (
    <div className="flex gap-4 group">
      <div className="shrink-0 w-10 h-10 rounded-sm border border-white/10 bg-obsidian-900/60 flex items-center justify-center group-hover:border-gold/40 transition-colors">
        <Icon className="w-4 h-4 text-gold" />
      </div>
      <div>
        <div className="font-display font-bold text-base mb-1">{title}</div>
        <div className="text-sm text-white/55">{desc}</div>
      </div>
    </div>
  );
}
