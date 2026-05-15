import { Component } from "react";
import Header from "@/components/site/Header";
import Hero from "@/components/site/Hero";
import PotTicker from "@/components/site/PotTicker";
import PreviousWinner from "@/components/site/PreviousWinner";
import HowItWorks from "@/components/site/HowItWorks";
import RollatCard from "@/components/site/RollatCard";
import RouletteArena from "@/components/site/RouletteArena";
import DevRollArena from "@/components/site/DevRollArena";
import GuestRollArena from "@/components/site/GuestRollArena";
import QualifiedWallets from "@/components/site/QualifiedWallets";
import WalletCheck from "@/components/site/WalletCheck";
import Tokenomics from "@/components/site/Tokenomics";
import HallOfFame from "@/components/site/HallOfFame";
import Vrf from "@/components/site/Vrf";
import Faq from "@/components/site/Faq";
import Footer from "@/components/site/Footer";

class SectionBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "#FF3366", fontFamily: "monospace", background: "#1A0808", margin: 8, borderRadius: 4 }}>
          <strong>[{this.props.name} crashed]</strong>
          <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-all", marginTop: 8 }}>
            {this.state.error.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const S = ({ name, children }) => <SectionBoundary name={name}>{children}</SectionBoundary>;

export default function Landing() {
  return (
    <div className="bg-obsidian-950 min-h-screen" data-testid="landing-page">
      <Header />
      <main>
        <S name="Hero"><Hero /></S>
        <S name="PotTicker"><PotTicker /></S>
        <S name="PreviousWinner"><PreviousWinner /></S>
        <S name="HowItWorks"><HowItWorks /></S>
        <S name="RollatCard">
          <section className="relative py-16 px-6 md:px-12 flex flex-col items-center gap-6" data-testid="rollat-card-section">
            <div className="text-center mb-2">
              <div className="text-[10px] uppercase tracking-[0.35em] font-mono text-gold/50 mb-2">Membership</div>
              <h2 className="font-display font-black text-3xl md:text-4xl tracking-tight text-white">The Rollat Card</h2>
              <p className="mt-3 text-sm text-white/40 font-mono max-w-xs mx-auto">
                Hold. Qualify. Get drawn. Every qualified wallet holds one.
              </p>
            </div>
            <RollatCard />
          </section>
        </S>
        <S name="RouletteArena"><RouletteArena /></S>
        <S name="DevRollArena"><DevRollArena /></S>
        <S name="GuestRollArena"><GuestRollArena /></S>
        <S name="QualifiedWallets"><QualifiedWallets /></S>
        <S name="WalletCheck"><WalletCheck /></S>
        <S name="Tokenomics"><Tokenomics /></S>
        <S name="HallOfFame"><HallOfFame /></S>
        <S name="Vrf"><Vrf /></S>
        <S name="Faq"><Faq /></S>
      </main>
      <Footer />
    </div>
  );
}
