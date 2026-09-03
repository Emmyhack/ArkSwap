import {ARK_DEVNET_CHAIN_ID, getDeployment} from '@arkswap/addresses';
import {chainConfig} from '@arkswap/config';
import {defineChain} from 'viem';

/**
 * Ark Constellation chain configuration for the web app.
 *
 * WHERE VALUES COME FROM
 * ----------------------
 *  - Chain id, name, explorer, and every contract address: @arkswap/addresses,
 *    the committed deployment manifest. Canonical addresses are never duplicated
 *    by hand (monorepo rules).
 *  - RPC / WebSocket endpoints: environment, because they are deployment-specific
 *    and may be private. Never invented (llm.txt s3).
 *
 * IMPORTANT: every `process.env.NEXT_PUBLIC_*` read must be a STATIC member
 * expression written out in full. Next/webpack substitutes these by textually
 * matching `process.env.NEXT_PUBLIC_FOO`; a computed read — `process.env[key]` —
 * silently becomes `undefined` in the browser bundle while still working on the
 * server, which breaks hydration and leaves the app permanently unconfigurable.
 * Do not refactor these into a helper that takes a key, and do not move them
 * into a workspace package.
 */
function clean(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

/** Chain id override exists so the app can be pointed at a local anvil preview. */
export const ARK_CHAIN_ID =
  Number(clean(process.env.NEXT_PUBLIC_ARK_EVM_CHAIN_ID) ?? 0) || ARK_DEVNET_CHAIN_ID;

export const ARK_RPC_URL = clean(process.env.NEXT_PUBLIC_ARK_RPC_URL);
export const ARK_WS_URL = clean(process.env.NEXT_PUBLIC_ARK_WS_URL);

const deployment = getDeployment(ARK_CHAIN_ID);

export const ARK_BLOCKSCOUT_URL =
  clean(process.env.NEXT_PUBLIC_ARK_BLOCKSCOUT_URL) ?? deployment?.explorer;

/** Analytics API base, e.g. http://localhost:8080/api/v1. Optional by design. */
export const ARKSWAP_API_URL = clean(process.env.NEXT_PUBLIC_ARKSWAP_API_URL);

const meta = chainConfig(ARK_CHAIN_ID);

export const NATIVE_CURRENCY = meta?.nativeCurrency ?? {
  name: 'KASH',
  symbol: 'KASH',
  decimals: 18,
};

export const arkConstellation = defineChain({
  id: ARK_CHAIN_ID,
  name: meta?.name ?? 'Ark Constellation',
  nativeCurrency: NATIVE_CURRENCY,
  rpcUrls: {
    default: {
      http: ARK_RPC_URL ? [ARK_RPC_URL] : [],
      webSocket: ARK_WS_URL ? [ARK_WS_URL] : undefined,
    },
  },
  blockExplorers: ARK_BLOCKSCOUT_URL
    ? {default: {name: 'Ark Blockscout', url: ARK_BLOCKSCOUT_URL}}
    : undefined,
  testnet: true,
});

export type ConfigProblem = {key: string; hint: string};

/** What the app still needs before it can talk to Ark. */
export function chainConfigProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (!ARK_RPC_URL) {
    problems.push({key: 'NEXT_PUBLIC_ARK_RPC_URL', hint: 'HTTPS JSON-RPC endpoint for Ark Constellation.'});
  }
  if (!deployment) {
    problems.push({
      key: 'NEXT_PUBLIC_ARK_EVM_CHAIN_ID',
      hint: `No deployment recorded for chain ${ARK_CHAIN_ID} in packages/addresses.`,
    });
  }
  return problems;
}

export function explorerTxUrl(hash: string): string | undefined {
  return ARK_BLOCKSCOUT_URL ? `${ARK_BLOCKSCOUT_URL}/tx/${hash}` : undefined;
}

export function explorerAddressUrl(address: string): string | undefined {
  return ARK_BLOCKSCOUT_URL ? `${ARK_BLOCKSCOUT_URL}/address/${address}` : undefined;
}
