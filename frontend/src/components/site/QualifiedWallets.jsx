import { useState } from "react";
import { motion } from "framer-motion";
import { Users, Search, LayoutGrid, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useQualifiedWallets } from "@/lib/api";
import { SectionLabel } from "./HowItWorks";

const TICKET_STYLES = {
  1: "text-white/50",
  2: "text-white",
  3: "text-emerald_neon",
  4: "text-sol_purple",
  5: "text-crimson",
  6: "text-gold",
};

const TICKET_BG = {
  1: "bg-white/5",
  2: "bg-white/10",
  3: "bg-emerald_neon/10",
  4: "bg-sol_purple/10",
  5: "bg-crimson/10",
  6: "bg-gold/10",
};

const truncWallet = (w) =>
  w ? `${w.slice(0, 6)}...${w.slice(-4)}` : "—";

const fmtTokens = (n) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
    ? `${(n / 1_000).toFixed(0)}K`
    : String(n);

export default function QualifiedWallets() {
  const [view, setView] = useState("grid");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);

  const { wallets, total, total_tickets, loading } = useQualifiedWallets(page, 48, search);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  return (
    <section id="qualified" className="relative py-24 md:py-28 px-6 md:px-12" data-testid="qualified-wallets-section">
      <div className="max-w-[1400px] mx-auto">
        <SectionLabel>In the Wheel</SectionLabel>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-10">
          <div>
            <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter">
              Qualified <span className="text-white/40">Wallets.</span>
            </h2>
            <div className="flex items-center gap-3 mt-3 font-mono text-sm">
              <span className="text-white/50">{(total ?? 0).toLocaleString()} wallets</span>
              <span className="text-white/20">·</span>
              <span className="text-white/50">{(total_tickets ?? 0).toLocaleString()} total tickets</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search wallet..."
                  className="pl-8 h-9 w-44 bg-obsidian-900/60 border-white/10 text-white text-xs font-mono placeholder:text-white/25 rounded-sm"
                />
              </div>
            </form>

            {/* View toggle */}
            <div className="flex border border-white/10 rounded-sm overflow-hidden">
              <button
                onClick={() => setView("grid")}
                className={`p-2 transition-colors ${view === "grid" ? "bg-gold/15 text-gold" : "text-white/30 hover:text-white/60"}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`p-2 transition-colors ${view === "list" ? "bg-gold/15 text-gold" : "text-white/30 hover:text-white/60"}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-white/30 font-mono text-sm">Loading wallets...</div>
        ) : view === "grid" ? (
          <GridView wallets={wallets} totalTickets={total_tickets} />
        ) : (
          <ListView wallets={wallets} totalTickets={total_tickets} />
        )}

        {/* Pagination */}
        {total > 48 && (
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-white/10 rounded-sm hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <span className="text-white/40 font-mono text-xs">
              Page {page} of {Math.ceil(total / 48)}
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= Math.ceil(total / 48)}
              className="px-4 py-2 text-xs font-mono uppercase tracking-widest border border-white/10 rounded-sm hover:border-white/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function GridView({ wallets, totalTickets }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {wallets.map((w, i) => (
        <motion.div
          key={w.wallet}
          initial={{ opacity: 0, scale: 0.95 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.2, delay: Math.min(i * 0.01, 0.3) }}
          className="p-3 bg-obsidian-900/60 border border-white/5 hover:border-white/15 rounded-sm transition-colors group"
        >
          <div className="flex items-center justify-between mb-2">
            <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm ${TICKET_STYLES[w.tickets]} ${TICKET_BG[w.tickets]}`}>
              {w.tickets}×
            </span>
          </div>
          <div className="font-mono text-xs text-white/60 group-hover:text-white/90 transition-colors truncate">
            {truncWallet(w.wallet)}
          </div>
          <div className="mt-1.5 font-mono text-[10px] text-white/30">
            {fmtTokens(w.holdings_tokens)}
          </div>
          {/* Probability bar */}
          <div className="mt-2 h-0.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${w.tickets >= 6 ? "bg-gold" : w.tickets >= 4 ? "bg-crimson" : "bg-white/20"}`}
              style={{ width: `${Math.min(100, (w.tickets / 6) * 100)}%` }}
            />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function ListView({ wallets, totalTickets }) {
  return (
    <div className="border border-white/5 rounded-sm overflow-hidden bg-obsidian-900/40">
      <div className="hidden md:grid grid-cols-12 gap-4 px-6 py-4 bg-obsidian-800/50 text-[10px] uppercase tracking-[0.2em] font-mono text-white/45">
        <div className="col-span-1">#</div>
        <div className="col-span-5">Wallet</div>
        <div className="col-span-2">Holdings</div>
        <div className="col-span-2">Tickets</div>
        <div className="col-span-2 text-right">Win Chance</div>
      </div>
      {wallets.map((w, i) => (
        <motion.div
          key={w.wallet}
          initial={{ opacity: 0, x: -8 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.4) }}
          className="grid grid-cols-2 md:grid-cols-12 gap-2 md:gap-4 px-4 md:px-6 py-4 border-t border-white/5 hover:bg-white/[0.02] transition-colors text-sm"
        >
          <div className="col-span-1 font-mono text-white/30 text-xs">{i + 1}</div>
          <div className="md:col-span-5 font-mono text-white/80 truncate">{w.wallet}</div>
          <div className="md:col-span-2 font-mono text-white/50 text-xs">{fmtTokens(w.holdings_tokens)}</div>
          <div className="md:col-span-2">
            <span className={`font-mono font-bold text-sm ${TICKET_STYLES[w.tickets]}`}>
              {w.tickets}×
            </span>
          </div>
          <div className="md:col-span-2 font-mono text-white/50 text-xs md:text-right">
            {w.win_probability?.toFixed(2)}%
          </div>
        </motion.div>
      ))}
    </div>
  );
}
