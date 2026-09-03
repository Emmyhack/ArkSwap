'use client';

import {injected} from '@wagmi/core';
import {http, createConfig} from 'wagmi';

import {ARK_RPC_URL, arkConstellation} from '@/config/chain';

/**
 * wagmi configuration for Ark Constellation (llm.txt s39).
 *
 * Injected (MetaMask and compatible) is the initial connector. WalletConnect can
 * be added once Ark network support is confirmed for the wallets in question.
 *
 * `injected` is imported from `@wagmi/core` rather than the `wagmi/connectors`
 * barrel: that barrel eagerly pulls in the Base Account connector, whose
 * dependency chain (@base-org/account -> @coinbase/cdp-sdk -> @x402/evm) has an
 * unresolvable import and breaks `next build`. ArkSwap only needs the injected
 * connector, and @wagmi/core exports it directly.
 */
export const wagmiConfig = createConfig({
  chains: [arkConstellation],
  connectors: [injected()],
  transports: {
    [arkConstellation.id]: http(ARK_RPC_URL ?? ''),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
