import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {Footer} from '@/components/Footer';
import {LiquidityCard} from '@/components/LiquidityCard';

export default function PoolPage() {
  return (
    <>
      <main className="hero">
      <h1 className="hero__title">
        Provide liquidity,
        <br />
        <em>earn the fee.</em>
      </h1>

      <DevnetBanner />

      <ConfigGate>
        <LiquidityCard />
      </ConfigGate>

      <p className="hero__sub">
        Liquidity providers earn the full 0.30% trade fee, split pro rata by pool share. The protocol
        fee is disabled.
      </p>
      </main>

      <div className="shell">
        <Footer />
      </div>
    </>
  );
}
