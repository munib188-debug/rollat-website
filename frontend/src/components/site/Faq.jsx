import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SectionLabel } from "./HowItWorks";

const faqs = [
  {
    q: "How is a winner actually picked?",
    a: "Every 24 hours a Chainlink VRF call is triggered. The contract weighs all qualified wallets by their ticket count and the VRF proof selects exactly one. The proof is publicly verifiable on Solana.",
  },
  {
    q: "What's the minimum to qualify?",
    a: "100,000 $ROLLAT held continuously for 24 hours. The contract takes hourly snapshots — only wallets present in all 24 consecutive snapshots qualify for the next spin.",
  },
  {
    q: "How do tickets scale?",
    a: "100K – 1M = 1 ticket · 1M – 1.5M = 2 · 1.5M – 2M = 3 · 2M – 2.5M = 4 · 2.5M – 3M = 5 · 3M+ = 6 (cap). Bigger bag, more shots — capped so nobody dominates the wheel.",
  },
  {
    q: "How does the payout work?",
    a: "The pot drops directly into the winner's connected wallet as SOL the moment the spin resolves. No claim portal, no manual approval, no NFT — just an instant on-chain transfer.",
  },
  {
    q: "What happens if the pot is small?",
    a: "If accumulated fees haven't reached the minimum threshold, the round rolls over to the next 24h cycle. This keeps every payout meaningful and builds anticipation during slow periods.",
  },
  {
    q: "Can the team rig the wheel?",
    a: "No. The contract has no admin override on the VRF outcome. The team can update the keeper schedule, but the random draw is sealed by Chainlink's oracle network.",
  },
  {
    q: "What is the recent winner lockout?",
    a: "Anyone who wins is automatically excluded from the next single round. After that they're back in the pool. This spreads the pot across the community instead of concentrating it.",
  },
  {
    q: "Why Solana?",
    a: "Ultra-low fees mean every transaction tax actually reaches the pot instead of getting eaten by gas. Plus Phantom UX is smooth for casual players and SOL payouts are near-instant.",
  },
];

export default function Faq() {
  return (
    <section id="faq" className="relative py-24 md:py-32 px-6 md:px-12" data-testid="faq-section">
      <div className="max-w-[900px] mx-auto">
        <SectionLabel>Frequently Asked</SectionLabel>
        <h2 className="font-display font-black text-4xl md:text-5xl tracking-tighter mb-12" data-testid="faq-headline">
          The fine print, <span className="gold-text">in english.</span>
        </h2>
        <Accordion type="single" collapsible className="space-y-3" data-testid="faq-accordion">
          {faqs.map((f, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="border border-white/5 hover:border-white/15 rounded-sm bg-obsidian-900/40 px-5 transition-colors"
              data-testid={`faq-item-${i}`}
            >
              <AccordionTrigger className="font-display font-bold text-left text-base md:text-lg hover:text-gold hover:no-underline py-5">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-white/60 text-sm md:text-base leading-relaxed pb-5">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
