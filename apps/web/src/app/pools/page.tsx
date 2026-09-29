import {ConfigGate} from '@/components/ConfigGate';
import {DevnetBanner} from '@/components/DevnetBanner';
import {Footer} from '@/components/Footer';
import {PoolsTable} from '@/components/PoolsTable';

export default function PoolsPage() {
  return (
    <>
      <main className="hero hero--wide">
        <h1 className="hero__title">
          Every pool,
          <br />
          <em>straight from the chain.</em>
        </h1>

        <DevnetBanner />

        <ConfigGate>
          <PoolsTable />
        </ConfigGate>

        <p className="hero__sub">
          Reserves and value locked are read from the pairs themselves. Volume and fees come from the analytics
          indexer when it is reachable.
        </p>
      </main>

      <div className="shell">
        <Footer />
      </div>
    </>
  );
}
