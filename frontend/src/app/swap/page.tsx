import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {Footer} from '@/components/Footer';
import {SwapCard} from '@/components/SwapCard';
import {ConnectSection} from '@/components/landing/ConnectSection';
import {FeatureGrid} from '@/components/landing/FeatureGrid';
import {StatsSection} from '@/components/landing/StatsSection';

export default function SwapPage() {
  return (
    <>
      <main className="hero">
        <h1 className="hero__title">
          Swap anytime,
          <br />
          <em>anywhere on Ark.</em>
        </h1>

        <DevnetBanner />

        <ConfigGate>
          <SwapCard />
        </ConfigGate>

        <p className="hero__sub">
          A constant-product AMM on Ark Constellation. Trade KASH and EVM assets, or provide
          liquidity and earn the 0.30% fee.
        </p>

        <div className="hero__scroll">
          <a href="#learn" style={{color: 'inherit'}}>
            Scroll to learn more
            <span aria-hidden>⌄</span>
          </a>
        </div>
      </main>

      <div className="shell">
        <FeatureGrid />
        <StatsSection />
        <ConnectSection />
        <Footer />
      </div>
    </>
  );
}
