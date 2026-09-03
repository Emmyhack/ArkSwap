import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {SwapCard} from '@/components/SwapCard';

export default function SwapPage() {
  return (
    <main className="page">
      <DevnetBanner />
      <ConfigGate>
        <SwapCard />
      </ConfigGate>
    </main>
  );
}
