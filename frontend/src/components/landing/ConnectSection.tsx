import {ARK_BLOCKSCOUT_URL} from '@/config/chain';

const REPO = 'https://github.com/Emmyhack/ArkSwap';

export function ConnectSection() {
  return (
    <section className="section">
      <h2 className="section__title">Connect with us</h2>
      <div className="grid-3">
        <div className="feature" style={{minHeight: 220, '--tint': 'rgba(168,85,247,0.16)', '--pill': '#c48bff'} as React.CSSProperties}>
          <a className="feature__pill" href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            ? Support
          </a>
          <h3 className="feature__headline" style={{fontSize: 20}}>
            Report an issue on GitHub
          </h3>
        </div>

        <div className="feature" style={{minHeight: 220, '--tint': 'rgba(139,92,246,0.16)', '--pill': '#b39cff'} as React.CSSProperties}>
          <a className="feature__pill" href={`${REPO}/tree/main/docs`} target="_blank" rel="noreferrer">
            ▤ Docs
          </a>
          <h3 className="feature__headline" style={{fontSize: 20}}>
            Upstream diff, security review and readiness notes
          </h3>
        </div>

        <div className="feature" style={{minHeight: 220, '--tint': 'rgba(217,70,239,0.16)', '--pill': '#f0a6ff'} as React.CSSProperties}>
          <a
            className="feature__pill"
            href={ARK_BLOCKSCOUT_URL ?? REPO}
            target="_blank"
            rel="noreferrer"
          >
            ◈ Explorer
          </a>
          <h3 className="feature__headline" style={{fontSize: 20}}>
            Every deployed contract, verified on Blockscout
          </h3>
        </div>
      </div>
    </section>
  );
}
