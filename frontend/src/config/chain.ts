import {defineChain} from 'viem';

/**
 * Ark Constellation devnet chain definition (llm.txt s39).
 *
 * EVERY VALUE HERE MUST COME FROM ARK CONSTELLATION INTERNAL DOCUMENTATION.
 * llm.txt s3 and s57 forbid inventing network values, so nothing is hardcoded:
 * the config is read from environment variables and `assertChainConfigured()`
 * throws a specific, actionable error if anything is missing.
 *
 * Set these in `frontend/.env.local`:
 *
 *   NEXT_PUBLIC_ARK_EVM_CHAIN_ID=
 *   NEXT_PUBLIC_ARK_RPC_URL=
 *   NEXT_PUBLIC_ARK_WS_URL=
 *   NEXT_PUBLIC_ARK_BLOCKSCOUT_URL=
 */

/**
 * IMPORTANT: every `process.env.NEXT_PUBLIC_*` read must be a STATIC member
 * expression written out in full.
 *
 * Next/webpack substitutes these at build time by textually matching
 * `process.env.NEXT_PUBLIC_FOO`. A computed read -- `process.env[key]` -- is not
 * matched, so it silently resolves to `undefined` in the browser bundle while
 * still working on the server. That produces a server/client divergence: the
 * server renders the app, the client renders the "Configuration required"
 * screen, React throws a hydration error, and the app is permanently
 * unconfigurable in production. Do not refactor these into a helper that takes
 * a key.
 */
function clean(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export const ARK_CHAIN_ID = Number(clean(process.env.NEXT_PUBLIC_ARK_EVM_CHAIN_ID) ?? 0);
export const ARK_RPC_URL = clean(process.env.NEXT_PUBLIC_ARK_RPC_URL);
export const ARK_WS_URL = clean(process.env.NEXT_PUBLIC_ARK_WS_URL);
export const ARK_BLOCKSCOUT_URL = clean(process.env.NEXT_PUBLIC_ARK_BLOCKSCOUT_URL);

/** Native asset of Ark Constellation. Users always see KASH, never ETH (llm.txt s41). */
export const NATIVE_CURRENCY = {
  name: 'KASH',
  symbol: 'KASH',
  decimals: 18,
} as const;

export const arkConstellation = defineChain({
  id: ARK_CHAIN_ID,
  name: 'Ark Constellation Devnet',
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

/**
 * Returns everything the app still needs before it can talk to Ark.
 * The UI renders this as a blocking setup screen rather than silently
 * connecting to the wrong network.
 */
export function chainConfigProblems(): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (!ARK_CHAIN_ID) {
    problems.push({
      key: 'NEXT_PUBLIC_ARK_EVM_CHAIN_ID',
      hint: 'Numeric EVM chain id from Ark Constellation devnet documentation.',
    });
  }
  if (!ARK_RPC_URL) {
    problems.push({key: 'NEXT_PUBLIC_ARK_RPC_URL', hint: 'HTTPS JSON-RPC endpoint.'});
  }
  if (!ARK_BLOCKSCOUT_URL) {
    problems.push({
      key: 'NEXT_PUBLIC_ARK_BLOCKSCOUT_URL',
      hint: 'Explorer base URL, used for transaction and address links.',
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
