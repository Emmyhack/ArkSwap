'use client';

import {useAccount, useWatchAsset} from 'wagmi';

import type {Token} from '@/config/tokens';

/**
 * Asks the connected wallet to track an ERC-20 (EIP-747 `wallet_watchAsset`).
 * Native KASH is already visible, so it is never offered.
 */
export function AddToWallet({token, compact}: {token: Token; compact?: boolean}) {
  const {connector, isConnected} = useAccount();
  const {watchAsset, isPending, isSuccess} = useWatchAsset();

  if (!isConnected || token.isNative || !token.address || !connector) return null;

  const address = token.address;
  return (
    <button
      type="button"
      className={compact ? 'icon-btn icon-btn--sm' : 'link-btn link-btn--sm'}
      title={`Add ${token.symbol} to wallet`}
      aria-label={`Add ${token.symbol} to wallet`}
      disabled={isPending}
      onClick={(e) => {
        e.stopPropagation();
        watchAsset({type: 'ERC20', options: {address, symbol: token.symbol.slice(0, 11), decimals: token.decimals}});
      }}
    >
      {compact ? (
        <PlusIcon />
      ) : isSuccess ? (
        `${token.symbol} added`
      ) : isPending ? (
        'Check your wallet…'
      ) : (
        `Add ${token.symbol} to wallet`
      )}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
