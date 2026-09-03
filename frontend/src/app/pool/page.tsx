import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {LiquidityCard} from '@/components/LiquidityCard';

export default function PoolPage() {
  return (
    <main className="page">
      <DevnetBanner />
      <ConfigGate>
        <LiquidityCard />
      </ConfigGate>
    </main>
  );
}
