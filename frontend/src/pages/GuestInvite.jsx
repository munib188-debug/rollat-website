import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Trophy, Eye, Coins, Send, CheckCircle2, ChevronDown, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { api } from "@/lib/api";
import LogoUpload from "@/components/site/LogoUpload";

const ACCENT = "#A855F7";

export default function GuestInvite() {
  const [searchParams] = useSearchParams();
  const initialTicker = (searchParams.get("t") || "").replace(/^\$/, "").toUpperCase();

  return (
    <div className="bg-obsidian-950 min-h-screen text-white">
      <TopBar />
      <main className="max-w-[1100px] mx-auto px-6 md:px-12 pt-28 pb-24">
        <Hero ticker={initialTicker} />
        <PitchBullets />
        <HowItWorks />
        <Prize />
        <ApplicationForm initialTicker={initialTicker} />
        <FAQ />
      </main>
      <Footer />
    </div>
  );
}

function TopBar() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 glass border-b border-white/5">
      <div className="max-w-[1400px] mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 group">
          <img src="/logo.svg" alt="" className="w-8 h-8 transition-transform duration-700 group-hover:rotate-180" />
          <span className="font-display font-black text-xl tracking-tight">$ROLLAT</span>
        </Link>
        <Link to="/" className="inline-flex items-center gap-1.5 text-white/55 hover:text-white text-sm font-mono uppercase tracking-widest">
          <ArrowLeft className="w-4 h-4" /> Home
        </Link>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 py-10 px-6 md:px-12">
      <div className="max-w-[1100px] mx-auto text-center text-white/40 font-mono text-xs uppercase tracking-widest">
        $ROLLAT · The On-Chain Roulette · CA: 6nkpP9ZZL2M3S9AFERydn3wxhzTMC2Dto72N6yK3pump
      </div>
    </footer>
  );
}

function Hero({ ticker }) {
  return (
    <section className="text-center mb-16 md:mb-24">
      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border mb-6 font-mono text-[10px] uppercase tracking-[0.3em]"
           style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: ACCENT }} />
        Invite-only · Guest Roll
      </div>
      <h1 className="font-display font-black text-5xl md:text-7xl tracking-tighter mb-6 leading-[0.95]">
        {ticker ? (
          <>
            <span style={{ color: ACCENT }}>${ticker}</span>,
            <br />
            you're up.
          </>
        ) : (
          <>
            You've been
            <br />
            <span style={{ color: ACCENT }}>invited.</span>
          </>
        )}
      </h1>
      <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
        $ROLLAT is hosting <span className="text-white font-bold">10 hand-picked Solana communities</span> for one
        live spin. The wheel picks one winner — that community walks away with the prize.
      </p>
      <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
        <a href="#apply" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm font-bold uppercase tracking-widest text-xs"
           style={{ backgroundColor: ACCENT, color: "#fff" }}>
          Accept the invite
        </a>
        <a href="/#guest-roll" className="inline-flex items-center gap-2 px-5 py-3 rounded-sm border border-white/15 text-white/80 hover:text-white hover:border-white/40 font-bold uppercase tracking-widest text-xs">
          Watch the wheel <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </section>
  );
}

function PitchBullets() {
  const items = [
    {
      icon: Eye,
      title: "Free exposure for your community",
      body: "Your name and logo go up on rollat.vercel.app for the entire run-up to the spin. Your community watches live, screenshots, and gets a free moment of hype.",
    },
    {
      icon: Trophy,
      title: "A real prize if you win",
      body: "One of the 10 communities wins a DexScreener boost — instant visibility on the most-watched Solana coin tracker. Even at 1/10 odds, expected value is positive.",
    },
    {
      icon: Coins,
      title: "Zero cost. Zero catch.",
      body: "No buy-in, no token swap, no commitment. We pick 10 projects, build the wheel, run the spin. You just send a logo and a link.",
    },
  ];
  return (
    <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16 md:mb-24">
      {items.map((item, i) => (
        <motion.div
          key={item.title}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.08 }}
          className="glass rounded-sm p-6 md:p-7"
        >
          <div className="w-10 h-10 rounded-sm mb-4 flex items-center justify-center border"
               style={{ borderColor: `${ACCENT}40`, backgroundColor: `${ACCENT}10` }}>
            <item.icon className="w-5 h-5" style={{ color: ACCENT }} />
          </div>
          <div className="font-display font-bold text-lg mb-2">{item.title}</div>
          <div className="text-sm text-white/60 leading-relaxed">{item.body}</div>
        </motion.div>
      ))}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: "01", title: "We invite you", body: "We send a personalized invite with your slot number (e.g. 4 of 10) and the spin date." },
    { n: "02", title: "You accept", body: "Send us your project name, ticker, logo (PNG/JPG URL), and one community link. Done in 60 seconds." },
    { n: "03", title: "The wheel goes live", body: "Your slot lights up on rollat.vercel.app. Your community watches the countdown, you get to share the page." },
    { n: "04", title: "One winner is picked", body: "At spin time, the wheel runs live. One ticker is highlighted. The winner gets the prize within 24 hours." },
  ];
  return (
    <section className="mb-16 md:mb-24">
      <SectionHeader eyebrow="Process" title="How it works" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {steps.map((s) => (
          <div key={s.n} className="glass rounded-sm p-6 flex gap-5">
            <div className="font-mono font-black text-3xl tabular-nums shrink-0" style={{ color: ACCENT }}>
              {s.n}
            </div>
            <div>
              <div className="font-display font-bold text-lg mb-1">{s.title}</div>
              <div className="text-sm text-white/60 leading-relaxed">{s.body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Prize() {
  return (
    <section className="mb-16 md:mb-24">
      <SectionHeader eyebrow="The Prize" title="One community walks." />
      <div className="glass rounded-sm p-8 md:p-12 relative overflow-hidden">
        <div className="absolute -top-12 -right-12 w-72 h-72 rounded-full blur-3xl pointer-events-none"
             style={{ backgroundColor: `${ACCENT}25` }} />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] mb-3" style={{ color: ACCENT }}>
              Default Prize
            </div>
            <div className="font-display font-black text-4xl md:text-5xl mb-3 leading-tight">
              DexScreener Boost
            </div>
            <div className="text-white/65 text-base md:text-lg leading-relaxed">
              24 hours of front-page DexScreener exposure for the winning ticker.
              The single highest-leverage moment a Solana micro-cap gets — your token in front
              of every trader watching new launches.
            </div>
            <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-xs uppercase tracking-widest"
                 style={{ borderColor: `${ACCENT}40`, color: ACCENT }}>
              <Trophy className="w-3.5 h-3.5" />
              ~$300 value · 24h window
            </div>
          </div>
          <div className="font-mono text-sm text-white/55">
            <div className="border border-white/5 rounded-sm p-5 bg-obsidian-900/40">
              <div className="text-[10px] uppercase tracking-[0.3em] mb-2 text-white/35">Future cycles</div>
              <ul className="space-y-2 text-white/70">
                <li>· DexScreener boost (default)</li>
                <li>· Telegram pinned post in the $ROLLAT group</li>
                <li>· Co-marketing X thread</li>
                <li>· Custom prizes per cycle (DM to suggest)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ApplicationForm({ initialTicker }) {
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState(initialTicker || "");
  const [logoUrl, setLogoUrl] = useState("");
  const [communityLink, setCommunityLink] = useState("");
  const [contact, setContact] = useState("");
  const [contractAddress, setContractAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (initialTicker && !ticker) setTicker(initialTicker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker]);

  const submit = async () => {
    const cleanTicker = ticker.trim().replace(/^\$/, "").toUpperCase();
    if (!name.trim()) { toast.error("Project name is required"); return; }
    if (!cleanTicker) { toast.error("Ticker is required"); return; }
    if (!communityLink.trim()) { toast.error("Community link is required"); return; }
    if (!contact.trim()) { toast.error("Contact handle is required"); return; }

    setSubmitting(true);
    try {
      await api.post("/guest/apply", {
        name: name.trim(),
        ticker: cleanTicker,
        logo_url: logoUrl.trim() || undefined,
        community_link: communityLink.trim(),
        contact: contact.trim(),
        contract_address: contractAddress.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setSubmitted(true);
      toast.success("Application received", { description: "We'll be in touch within 48h." });
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || "Try again in a moment.";
      toast.error("Submission failed", { description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <section id="apply" className="mb-16 md:mb-24">
        <div className="glass rounded-sm p-10 md:p-14 text-center" style={{ borderColor: `${ACCENT}40` }}>
          <CheckCircle2 className="w-14 h-14 mx-auto mb-5" style={{ color: ACCENT }} />
          <div className="font-display font-black text-3xl md:text-4xl mb-3">You're on the list.</div>
          <div className="text-white/65 max-w-xl mx-auto leading-relaxed">
            Application received. We review every submission and reach out within 48 hours via the
            contact you provided. If you're picked for the next cycle, we'll send the lineup details
            and quote-tweet your acceptance.
          </div>
          <div className="mt-6 font-mono text-xs uppercase tracking-widest text-white/40">
            See you on the wheel 💜
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="apply" className="mb-16 md:mb-24">
      <SectionHeader eyebrow="Apply" title="Join the next cycle" />
      <div className="glass rounded-sm p-6 md:p-8">
        <div className="text-sm text-white/55 mb-6">
          Two minutes. One reply. We do the rest.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Project name *">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bonk" maxLength={40} />
          </Field>
          <Field label="Ticker *">
            <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="$BONK" maxLength={16} />
          </Field>
          <Field label="Logo (upload or paste URL)">
            <LogoUpload value={logoUrl} onChange={(v) => setLogoUrl(v || "")} />
          </Field>
          <Field label="Community link *">
            <Input value={communityLink} onChange={(e) => setCommunityLink(e.target.value)} placeholder="https://t.me/… or https://x.com/…" />
          </Field>
          <Field label="Contact (X / TG / Discord) *">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="@yourhandle" maxLength={80} />
          </Field>
          <Field label="Contract address (optional)">
            <Input value={contractAddress} onChange={(e) => setContractAddress(e.target.value)} placeholder="Solana CA" maxLength={80} />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Anything we should know?">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — preferred date, prize idea, partnership notes…"
              maxLength={500}
              rows={3}
              className="w-full rounded-sm bg-white/5 border border-white/10 focus:border-white/30 outline-none px-3 py-2 text-sm text-white placeholder:text-white/30"
            />
          </Field>
        </div>
        <Button
          onClick={submit}
          disabled={submitting}
          className="w-full mt-6 font-bold uppercase tracking-widest text-xs h-11"
          style={{ backgroundColor: ACCENT, color: "#fff" }}
        >
          {submitting ? "Sending…" : <><Send className="w-4 h-4 mr-2" /> Submit application</>}
        </Button>
        <div className="mt-4 text-[10px] uppercase tracking-widest font-mono text-white/35 text-center">
          We review every submission. No fees, no token swaps, no DM spam.
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const items = [
    {
      q: "Is there a catch?",
      a: "No. We don't ask for fees, token swaps, or any financial commitment. We pick 10 projects, run a live spin, and one wins a prize. That's the whole thing.",
    },
    {
      q: "What does my community have to do?",
      a: "Nothing required. They can just watch the spin live on rollat.vercel.app. Most communities choose to share the lineup screenshot — it's free content.",
    },
    {
      q: "Can we promote it on our side?",
      a: "Please do. We'll quote-tweet your acceptance and tag every community in the lineup post. Cross-promo is the whole point — every project gets exposure to 9 other communities.",
    },
    {
      q: "How is the winner picked?",
      a: "Uniform random. Each of the 10 entries has exactly 1/10 odds. The wheel animation is visual; the random pick happens server-side at spin time.",
    },
    {
      q: "What if we win?",
      a: "We deliver the prize within 24 hours. For a DexScreener boost, we book the slot under your ticker — you don't have to do anything except hold on for the traffic.",
    },
    {
      q: "Can we pick our prize?",
      a: "The default is a DexScreener boost. If you have a different idea (custom co-marketing, pinned post in our TG, etc.) mention it in the application notes.",
    },
    {
      q: "How often do you run these?",
      a: "Roughly once per cycle — frequency scales with $ROLLAT volume and partner interest. Apply once, you're in the pool for future rounds.",
    },
  ];
  return (
    <section className="mb-8">
      <SectionHeader eyebrow="FAQ" title="Frequently asked" />
      <div className="space-y-2">
        {items.map((item) => (
          <FAQItem key={item.q} q={item.q} a={item.a} />
        ))}
      </div>
    </section>
  );
}

function FAQItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass rounded-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-white/[0.02]"
      >
        <span className="font-bold">{q}</span>
        <ChevronDown className={`w-4 h-4 transition-transform shrink-0 ${open ? "rotate-180" : ""}`} style={{ color: ACCENT }} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-sm text-white/65 leading-relaxed">{a}</div>
      )}
    </div>
  );
}

function SectionHeader({ eyebrow, title }) {
  return (
    <div className="mb-6 md:mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-8 h-px" style={{ backgroundColor: ACCENT }} />
        <span className="text-[10px] uppercase tracking-[0.3em] font-mono font-bold" style={{ color: ACCENT }}>
          {eyebrow}
        </span>
      </div>
      <h2 className="font-display font-black text-3xl md:text-4xl tracking-tighter">{title}</h2>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] font-mono text-white/45 mb-2">{label}</div>
      {children}
    </label>
  );
}
