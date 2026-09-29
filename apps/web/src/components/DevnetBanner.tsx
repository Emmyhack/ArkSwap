'use client';

import {useState} from 'react';

import {FAUCET_ENABLED} from '@/config/devnet';

import {FaucetModal} from './FaucetModal';

export function DevnetBanner() {
  const [faucet, setFaucet] = useState(false);
  return (
    <div className="devnet-strip">
      <div>
        <span className="badge badge--devnet">devnet</span>
        Ark Constellation devnet · test tokens have no real value
        {FAUCET_ENABLED && (
          <button type="button" className="devnet-strip__link" onClick={() => setFaucet(true)}>
            Get test tokens
          </button>
        )}
      </div>
      {faucet && <FaucetModal onClose={() => setFaucet(false)} />}
    </div>
  );
}
