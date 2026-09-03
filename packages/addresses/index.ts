import arkDevnet from './ark-devnet.json';

/**
 * Canonical ArkSwap deployment records.
 *
 * This package is the single source of truth for deployed addresses. apps/web,
 * apps/api and apps/indexer all read it rather than keeping their own copies —
 * the monorepo rules are explicit that canonical addresses must never be
 * duplicated manually.
 *
 * The JSON files are written by the deployment scripts in packages/contracts
 * after a real deployment. Nothing here is hand-edited.
 */
export type Address = `0x${string}`;

export type Deployment = {
  network: string;
  evmChainId: string;
  nativeSymbol: string;
  rpc: string;
  explorer: string;
  wkash: Address;
  factory: Address;
  router02: Address;
  feeToSetter: Address;
  feeTo: Address;
  pairInitCodeHash: Address;
  tokens: Record<string, Address>;
  pairs: Record<string, Address>;
  deployments: Record<string, unknown>;
  compiler: Record<string, unknown>;
  verified: Record<string, unknown>;
  sourceCommit: string;
};

const DEPLOYMENTS: Record<number, Deployment> = {
  9000: arkDevnet as unknown as Deployment,
};

/** Numeric chain ids ArkSwap has a recorded deployment for. */
export const SUPPORTED_CHAIN_IDS = Object.keys(DEPLOYMENTS).map(Number);

/**
 * Deployment record for a chain, or `undefined` when ArkSwap is not deployed
 * there. Callers must handle `undefined` rather than assume a default network —
 * silently falling back to another chain's addresses would point users at
 * contracts that do not exist (llm.txt s3).
 */
export function getDeployment(chainId: number): Deployment | undefined {
  return DEPLOYMENTS[chainId];
}

export const ARK_DEVNET_CHAIN_ID = 9000;
export const arkDevnetDeployment = DEPLOYMENTS[ARK_DEVNET_CHAIN_ID];
