import Header from "@/components/site/Header";
import Hero from "@/components/site/Hero";
import PotTicker from "@/components/site/PotTicker";
import PreviousWinner from "@/components/site/PreviousWinner";
import HowItWorks from "@/components/site/HowItWorks";
import RouletteArena from "@/components/site/RouletteArena";
import QualifiedWallets from "@/components/site/QualifiedWallets";
import WalletCheck from "@/components/site/WalletCheck";
import Tokenomics from "@/components/site/Tokenomics";
import HallOfFame from "@/components/site/HallOfFame";
import Vrf from "@/components/site/Vrf";
import Faq from "@/components/site/Faq";
import Footer from "@/components/site/Footer";

export default function Landing() {
  return (
    <div className="bg-obsidian-950 min-h-screen" data-testid="landing-page">
      <Header />
      <main>
        <Hero />
        <PotTicker />
        <PreviousWinner />
        <HowItWorks />
        <RouletteArena />
        <QualifiedWallets />
        <WalletCheck />
        <Tokenomics />
        <HallOfFame />
        <Vrf />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
