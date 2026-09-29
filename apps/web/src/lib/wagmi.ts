'use client';

import {injected} from '@wagmi/core';
import {http, createConfig, type CreateConnectorFn} from 'wagmi';
import {walletConnect} from 'wagmi/connectors';

import {ARK_RPC_URL, arkConstellation} from '@/config/chain';

/**
 * wagmi configuration for Ark Constellation (llm.txt s39).
 *
 * Injected wallets are always offered; wagmi's EIP-6963 discovery lists each
 * one it finds by name. WalletConnect is added when a project id is
 * configured, which is what lets mobile wallets pair by QR code. The id is
 * public by design and read as a static NEXT_PUBLIC_* expression (see
 * config/chain.ts for why it must not be looked up dynamically).
 *
 * `injected` is imported from `@wagmi/core` rather than the `wagmi/connectors`
 * barrel: that barrel also pulls in the Base Account connector, whose
 * dependency chain has unresolvable imports. next.config.mjs stubs that SDK so
 * the barrel can be used for WalletConnect alone.
 */
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors: CreateConnectorFn[] = [injected()];
if (WALLETCONNECT_PROJECT_ID && WALLETCONNECT_PROJECT_ID.length > 0) {
  connectors.push(
    walletConnect({
      projectId: WALLETCONNECT_PROJECT_ID,
      showQrModal: true,
      metadata: {
        name: 'ArkSwap',
        description: 'Swap and provide liquidity on Ark Constellation.',
        url: typeof window === 'undefined' ? 'https://arkswap.local' : window.location.origin,
        icons: [],
      },
    }),
  );
}

export const wagmiConfig = createConfig({
  chains: [arkConstellation],
  connectors,
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
