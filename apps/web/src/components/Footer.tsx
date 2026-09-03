import Link from 'next/link';

import {ARK_BLOCKSCOUT_URL} from '@/config/chain';

const REPO = 'https://github.com/Emmyhack/ArkSwap';

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__top">
        <div>
          <div className="nav__brand" style={{marginBottom: 18}}>
            <span className="nav__mark" aria-hidden>
              <svg width="15" height="15" viewBox="0 0 32 32" fill="none">
                <path d="M16 5 L26 27 H20 L16 18 L12 27 H6 Z" fill="white" />
              </svg>
            </span>
            ArkSwap
          </div>
          <div className="footer__social">
            <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.26 5.69.41.36.78 1.06.78 2.15v3.19c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
              </svg>
            </a>
            {ARK_BLOCKSCOUT_URL && (
              <a href={ARK_BLOCKSCOUT_URL} target="_blank" rel="noreferrer" aria-label="Explorer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                </svg>
              </a>
            )}
          </div>
        </div>

        <div className="footer__cols">
          <div className="footer__col">
            <h4>App</h4>
            <Link href="/swap">Trade</Link>
            <Link href="/pool">Pool</Link>
          </div>
          <div className="footer__col">
            <h4>Protocol</h4>
            <a href={`${REPO}/tree/main/contracts`} target="_blank" rel="noreferrer">
              Contracts
            </a>
            <a href={`${REPO}/blob/main/deployments/ark-devnet.json`} target="_blank" rel="noreferrer">
              Deployments
            </a>
            <a href={`${REPO}/blob/main/docs/UPSTREAM-DIFF.md`} target="_blank" rel="noreferrer">
              Upstream diff
            </a>
          </div>
          <div className="footer__col">
            <h4>Security</h4>
            <a href={`${REPO}/blob/main/docs/SECURITY-REVIEW.md`} target="_blank" rel="noreferrer">
              Static analysis
            </a>
            <a href={`${REPO}/blob/main/docs/PRODUCTION-READINESS.md`} target="_blank" rel="noreferrer">
              Readiness
            </a>
          </div>
          <div className="footer__col">
            <h4>Need help?</h4>
            <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
              Report an issue
            </a>
            <a href={`${REPO}/blob/main/LICENSING.md`} target="_blank" rel="noreferrer">
              Licensing
            </a>
          </div>
        </div>
      </div>

      <div className="footer__base">
        <span>
          ArkSwap · devnet deployment, not audited. Adapted from Uniswap V2 (GPL-3.0-or-later); not
          affiliated with Uniswap.
        </span>
        <span>Test tokens have no real value.</span>
      </div>
    </footer>
  );
}
